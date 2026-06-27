-- ============================================================
-- CAMBIO DE MODELO EN REPORTES: split fijo 50/50 (réplica del Excel)
--
-- Decisión de negocio: el reporte financiero (solapa "Reportes")
-- debe replicar literalmente la solapa "TOTAL" del Excel del cliente,
-- que reparte la facturación 50% empresa / 50% barbero de forma FIJA,
-- sin importar si el barbero cumplió o no los bonos de presentismo/objetivo.
--
-- Antes (migración 025): "Total Barberos" = comisión real por corte
-- (40%) + bonos efectivamente cumplidos. Eso es más preciso, pero NO
-- coincide con el Excel cuando algún bono no se cumple (la empresa
-- retenía ese 5%/5% y la ganancia daba más alta que el Excel).
--
-- Ahora: cada barbero "se lleva" el 50% de SU facturación. Por lo tanto:
--   barber_total (Total Barberos) = facturación_total × 0.5
--   branch_share (Total Barbería) = facturación_total × 0.5   (= Ingresos − barber_total, calculado en el TS)
--   ganancia_neta                 = facturación_total × 0.5 − gastos
-- replicando F2 = B3 − GASTOS!C25 del Excel.
--
-- IMPORTANTE: esto cambia SOLO el reporte. Las liquidaciones
-- (settlements) siguen pagando al barbero su 40% + bonos cumplidos;
-- el split 50/50 es una vista contable simplificada, no lo que se paga.
--
-- Golden test (Junín, semanas 1-3 jun-2026):
--   facturación 4.661.000 → empresa 2.330.500 − gastos 510.500 = 1.820.000
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
           count(*)::int                              as cut_count,
           coalesce(sum(t.amount),0)::float8           as total_income,
           -- Split fijo 50/50 (réplica Excel), no el 60/40 por corte:
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
  -- Cada barbero se lleva el 50% de SU facturación (no 40% + bonos).
  barber_tx as (
    select t.branch_id, t.barber_id,
           (coalesce(sum(t.amount),0) * 0.5)::float8 as take
    from transactions t
    join target_weeks tw on tw.week_id = t.week_id
    group by t.branch_id, t.barber_id
  ),
  barber_agg as (
    select bt.branch_id,
           coalesce(sum(bt.take),0)::float8 as barber_total,
           jsonb_agg(
             jsonb_build_object('barber_id', bt.barber_id, 'full_name', p.full_name, 'total', bt.take)
             order by bt.take desc
           ) as barbers
    from barber_tx bt
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
