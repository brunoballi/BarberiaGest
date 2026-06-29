-- ============================================================
-- FIX reporte por período: el total por barbero debe salir de la LIQUIDACIÓN
-- real (settlements.total_earned), no de un split plano amount*0.5.
--
-- Bug: el split 50% asumía que cada barbero cobraba el 100% de sus bonos
-- (presentismo + objetivo). Cuando un bono NO se cumplía (objetivo_met=false /
-- presentismo_met=false), el reporte lo seguía sumando, sobre-contando el monto.
-- settlements.total_earned = comisión por la tasa del barbero + bonos SOLO si
-- met=true (bonus_* = 0 cuando met=false), así que refleja lo realmente liquidado.
-- ============================================================
create or replace function public.report_by_period(p_branch_ids uuid[], p_start date, p_end date)
 returns table(branch_id uuid, cut_count integer, total_income double precision, branch_share double precision, barber_share double precision, total_expenses double precision, partner_withdrawals double precision, expenses_by_category jsonb, barber_total double precision, barbers jsonb)
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
           count(*)::int                              as cut_count,
           coalesce(sum(t.amount),0)::float8           as total_income,
           (coalesce(sum(t.amount),0) * 0.5)::float8   as branch_share,
           (coalesce(sum(t.amount),0) * 0.5)::float8   as barber_share
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
  -- Total por barbero = lo realmente LIQUIDADO (total_earned), respeta met flags.
  barber_settle as (
    select s.branch_id, s.barber_id,
           coalesce(sum(s.total_earned),0)::float8 as take
    from settlements s
    join target_weeks tw on tw.week_id = s.week_id
    group by s.branch_id, s.barber_id
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
