-- ============================================================
-- PERFORMANCE — Reportes agregados del lado servidor
-- Antes: el cliente traía TODAS las filas de transactions y expenses del rango
-- y agregaba en el browser. Ahora un RPC devuelve solo los agregados por sucursal.
-- Reduce transferencia y cómputo en el cliente.
-- security INVOKER: respeta RLS (el admin solo ve sus sucursales). search_path fijo.
-- Lógica idéntica a getReportByPeriod (retiro_socio se reporta aparte y no
-- entra en total_expenses ni en el desglose por categoría).
-- ============================================================

create or replace function public.report_by_period(
  p_branch_ids uuid[],
  p_start date,
  p_end   date
)
returns table (
  branch_id            uuid,
  cut_count            int,
  total_income         float8,
  branch_share         float8,
  barber_share         float8,
  total_expenses       float8,
  partner_withdrawals  float8,
  expenses_by_category jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with tx as (
    select branch_id,
           count(*)::int                       as cut_count,
           coalesce(sum(amount),0)::float8      as total_income,
           coalesce(sum(branch_share),0)::float8 as branch_share,
           coalesce(sum(barber_share),0)::float8 as barber_share
    from transactions
    where branch_id = any(p_branch_ids)
      and transaction_date between p_start and p_end
    group by branch_id
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
  )
  select b.id,
         coalesce(tx.cut_count, 0),
         coalesce(tx.total_income, 0),
         coalesce(tx.branch_share, 0),
         coalesce(tx.barber_share, 0),
         coalesce(exp.total_expenses, 0),
         coalesce(exp.partner_withdrawals, 0),
         coalesce(exp_cat.expenses_by_category, '{}'::jsonb)
  from unnest(p_branch_ids) as b(id)
  left join tx      on tx.branch_id = b.id
  left join exp     on exp.branch_id = b.id
  left join exp_cat on exp_cat.branch_id = b.id;
$$;

revoke all on function public.report_by_period(uuid[], date, date) from public, anon;
grant execute on function public.report_by_period(uuid[], date, date) to authenticated;
