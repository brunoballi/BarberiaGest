-- ============================================================
-- FIX: alinear "Total Barberos" (comisión + bonos) con "Ingresos/cortes"
-- al mismo mes de negocio (weeks.month_id), en vez de filtrar
-- transacciones por transaction_date y bonos por week.start_date
-- por separado.
--
-- Antes: una semana de liquidación que cruza el límite del mes
-- calendario (ej. empieza el 28 y termina el 3 del mes siguiente)
-- quedaba con sus cortes de los días 1-3 contados como ingreso del
-- mes siguiente, pero su bono completo (presentismo/objetivo) se
-- contaba entero en el mes anterior (por w.start_date). Esto
-- desalineaba "Total Barberos" contra "Ingresos" dentro de cada
-- reporte mensual.
--
-- Ahora: transacciones y bonos se agregan por las semanas que
-- pertenecen al mes de negocio (weeks.month_id -> months.year/month),
-- el mismo criterio con el que se cerraron esas semanas/liquidaciones.
-- Los gastos (expenses) siguen filtrados por expense_date, ya que no
-- siempre están atados a una semana (week_id nullable).
-- ============================================================

drop function if exists public.report_by_period(uuid[], date, date);

create or replace function public.report_by_period(p_branch_ids uuid[], p_start date, p_end date)
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
stable
set search_path to 'public'
as $function$
  with target_weeks as (
    select w.id as week_id, w.branch_id
    from weeks w
    join months m on m.id = w.month_id
    where m.branch_id = any(p_branch_ids)
      and m.year  = extract(year from p_start)::int
      and m.month = extract(month from p_start)::int
  ),
  tx as (
    select t.branch_id,
           count(*)::int                          as cut_count,
           coalesce(sum(t.amount),0)::float8       as total_income,
           coalesce(sum(t.branch_share),0)::float8 as branch_share,
           coalesce(sum(t.barber_share),0)::float8 as barber_share
    from transactions t
    join target_weeks tw on tw.week_id = t.week_id
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
  -- Comisión por corte de cada barbero (transacciones de las semanas del mes)
  barber_tx as (
    select t.branch_id, t.barber_id, coalesce(sum(t.barber_share),0)::float8 as bshare
    from transactions t
    join target_weeks tw on tw.week_id = t.week_id
    group by t.branch_id, t.barber_id
  ),
  -- Bonos de cada barbero (liquidaciones de las semanas del mes)
  barber_bonus as (
    select s.branch_id, s.barber_id,
           coalesce(sum(s.bonus_presentismo + s.bonus_objetivo),0)::float8 as bonus
    from settlements s
    join target_weeks tw on tw.week_id = s.week_id
    group by s.branch_id, s.barber_id
  ),
  barber_take as (
    select coalesce(tx.branch_id, bo.branch_id) as branch_id,
           coalesce(tx.barber_id, bo.barber_id) as barber_id,
           coalesce(tx.bshare,0) + coalesce(bo.bonus,0) as take
    from barber_tx tx
    full outer join barber_bonus bo
      on bo.branch_id = tx.branch_id and bo.barber_id = tx.barber_id
  ),
  barber_agg as (
    select bt.branch_id,
           coalesce(sum(bt.take),0)::float8 as barber_total,
           jsonb_agg(
             jsonb_build_object('barber_id', bt.barber_id, 'full_name', p.full_name, 'total', bt.take)
             order by bt.take desc
           ) as barbers
    from barber_take bt
    join profiles p on p.id = bt.barber_id
    group by bt.branch_id
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

revoke all on function public.report_by_period(uuid[], date, date) from public, anon;
grant execute on function public.report_by_period(uuid[], date, date) to authenticated;
