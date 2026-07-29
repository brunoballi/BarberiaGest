-- 041: el reporte principal (Reportes → ganancia por sucursal) toma SOLO las
-- liquidaciones en estado 'paid'.
--
-- Problema: report_by_period mezclaba borradores, confirmadas y pagadas. La
-- semana en curso (que todavía se está cargando) entraba al reporte y el
-- administrador veía montos que no correspondían a plata cerrada.
--
-- Además, el filtro anterior (`settled_weeks`) tomaba la semana ENTERA si
-- cualquier barbero tenía liquidación: contaba transacciones de barberos que ni
-- siquiera tenían liquidación generada, inflando los ingresos. Ahora se filtra
-- por el par (semana, barbero), que es la granularidad real de una liquidación:
-- en una misma semana puede haber un barbero pagado y otro aún en borrador.
--
-- Los gastos NO se filtran por estado: son del mes y se imputan igual.
--
-- Nota: branch_share / barber_share que devuelve este RPC quedan como estaban
-- (amount * 0.5). El frontend los ignora: recalcula Total barbería como
-- total_income − barber_total (ver getReportByPeriod en supabase.client.ts).

create or replace function public.report_by_period(
  p_branch_ids uuid[],
  p_start date,
  p_end date
)
returns table(
  branch_id uuid,
  cut_count integer,
  total_income double precision,
  branch_share double precision,
  barber_share double precision,
  total_expenses double precision,
  partner_withdrawals double precision,
  expenses_by_category jsonb,
  barber_total double precision,
  barbers jsonb
)
language sql
as $function$
  with target_weeks as (
    select w.id as week_id, w.branch_id
    from weeks w
    join months m on m.id = w.month_id
    where m.branch_id = any(p_branch_ids)
      and m.year  = extract(year from p_start)::int
      and m.month = extract(month from p_start)::int
  ),
  -- Solo liquidaciones PAGADAS, al nivel (semana, barbero).
  paid_settlements as (
    select s.week_id, s.barber_id, s.branch_id, s.total_earned
    from settlements s
    join target_weeks tw on tw.week_id = s.week_id
    where s.status = 'paid'
  ),
  tx as (
    select t.branch_id,
           count(*)::int                              as cut_count,
           coalesce(sum(t.amount),0)::float8           as total_income,
           (coalesce(sum(t.amount),0) * 0.5)::float8   as branch_share,
           (coalesce(sum(t.amount),0) * 0.5)::float8   as barber_share
    from transactions t
    join paid_settlements ps
      on ps.week_id = t.week_id and ps.barber_id = t.barber_id
    group by t.branch_id
  ),
  exp as (
    select branch_id,
           coalesce(sum(amount) filter (where category is distinct from 'retiro_socio'),0)::float8 as total_expenses,
           coalesce(sum(amount) filter (where category = 'retiro_socio'),0)::float8               as partner_withdrawals
    from expenses
    where branch_id = any(p_branch_ids)
      and expense_date between p_start and p_end
    group by branch_id
  ),
  exp_cat as (
    select branch_id,
           coalesce(jsonb_object_agg(category, cat_sum), '{}'::jsonb) as expenses_by_category
    from (
      select branch_id, category, sum(amount)::float8 as cat_sum
      from expenses
      where branch_id = any(p_branch_ids)
        and expense_date between p_start and p_end
        and category is distinct from 'retiro_socio'
        and category is not null
      group by branch_id, category
    ) ec
    group by branch_id
  ),
  barber_settle as (
    select ps.branch_id, ps.barber_id,
           coalesce(sum(ps.total_earned),0)::float8 as take
    from paid_settlements ps
    group by ps.branch_id, ps.barber_id
  ),
  barber_agg as (
    select bs.branch_id,
           coalesce(sum(bs.take),0)::float8 as barber_total,
           jsonb_agg(
             jsonb_build_object('barber_id', bs.barber_id, 'full_name', p.full_name, 'total', bs.take)
             order by bs.take desc
           ) as barbers
    from barber_settle bs
    join profiles p on p.id = bs.barber_id
    group by bs.branch_id
  )
  select b.id,
         coalesce(tx.cut_count, 0),
         coalesce(tx.total_income, 0),
         coalesce(tx.branch_share, 0),
         coalesce(tx.barber_share, 0),
         coalesce(exp.total_expenses, 0),
         coalesce(exp.partner_withdrawals, 0),
         coalesce(exp_cat.expenses_by_category, '{}'::jsonb),
         coalesce(barber_agg.barber_total, 0),
         coalesce(barber_agg.barbers, '[]'::jsonb)
  from unnest(p_branch_ids) as b(id)
  left join tx         on tx.branch_id = b.id
  left join exp        on exp.branch_id = b.id
  left join exp_cat    on exp_cat.branch_id = b.id
  left join barber_agg on barber_agg.branch_id = b.id;
$function$;
