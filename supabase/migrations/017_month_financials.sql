-- ============================================================
-- GANANCIA NETA DEL MES (month_financials)
-- Devuelve, para una sucursal y un mes:
--   branch_share_cuts = comisión de la barbería en cortes (branch_share)
--   box_rent_total    = alquileres de box cobrados (settlements.box_rent)
--   branch_income     = branch_share_cuts + box_rent_total
--   total_expenses    = gastos del mes (excluye retiro_socio)
--   initial_balance   = saldo inicial cargado para el mes
--   net_profit        = initial_balance + branch_income - total_expenses
-- Cortes y box_rent se agregan por week.month_id (preciso al mes).
-- Gastos por rango de fechas del mes (captura gastos sin week_id).
-- security definer; ejecutable solo por authenticated.
-- ============================================================

create or replace function public.month_financials(p_branch_id uuid, p_month_id uuid)
returns table(
  branch_share_cuts double precision,
  box_rent_total    double precision,
  branch_income     double precision,
  total_expenses    double precision,
  initial_balance   double precision,
  net_profit        double precision
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mr as (
    select min(start_date) as d0, max(end_date) as d1
    from weeks where month_id = p_month_id and branch_id = p_branch_id
  ),
  cuts as (
    select coalesce(sum(t.branch_share), 0)::float8 as branch_share_cuts
    from transactions t
    join weeks w on w.id = t.week_id
    where w.month_id = p_month_id and t.branch_id = p_branch_id
  ),
  box as (
    select coalesce(sum(s.box_rent), 0)::float8 as box_rent_total
    from settlements s
    join weeks w on w.id = s.week_id
    where w.month_id = p_month_id and s.branch_id = p_branch_id
  ),
  exp as (
    select coalesce(sum(e.amount) filter (where e.category is distinct from 'retiro_socio'), 0)::float8 as total_expenses
    from expenses e, mr
    where e.branch_id = p_branch_id
      and mr.d0 is not null
      and e.expense_date between mr.d0 and mr.d1
  ),
  bal as (
    select coalesce(initial_balance, 0)::float8 as initial_balance
    from revenue_balances
    where branch_id = p_branch_id and month_id = p_month_id
  )
  select
    cuts.branch_share_cuts,
    box.box_rent_total,
    (cuts.branch_share_cuts + box.box_rent_total)                         as branch_income,
    exp.total_expenses,
    coalesce((select initial_balance from bal), 0)                        as initial_balance,
    coalesce((select initial_balance from bal), 0)
      + cuts.branch_share_cuts + box.box_rent_total - exp.total_expenses  as net_profit
  from cuts, box, exp;
$function$;

revoke all on function public.month_financials(uuid, uuid) from public, anon;
grant execute on function public.month_financials(uuid, uuid) to authenticated;
