-- ============================================================
-- INYECCIONES DE CAPITAL DE SOCIOS
-- Tabla para registrar inversiones/aportes de los dueños
-- ============================================================

create table if not exists public.capital_injections (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  month_id uuid not null references public.months(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  description text,
  created_by uuid not null references public.profiles(id),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.capital_injections enable row level security;

create policy "authenticated_read_capital_injections_own_branch"
  on public.capital_injections for select
  using (
    exists (
      select 1 from admin_branches ub
      where ub.admin_id = auth.uid()
        and ub.branch_id = capital_injections.branch_id
    )
  );

create policy "authenticated_insert_capital_injections"
  on public.capital_injections for insert
  with check (
    exists (
      select 1 from admin_branches ub
      where ub.admin_id = auth.uid()
        and ub.branch_id = capital_injections.branch_id
    )
  );

create policy "authenticated_update_capital_injections"
  on public.capital_injections for update
  using (
    exists (
      select 1 from admin_branches ub
      where ub.admin_id = auth.uid()
        and ub.branch_id = capital_injections.branch_id
    )
  );

create policy "authenticated_delete_capital_injections"
  on public.capital_injections for delete
  using (
    exists (
      select 1 from admin_branches ub
      where ub.admin_id = auth.uid()
        and ub.branch_id = capital_injections.branch_id
    )
  );

create index idx_capital_injections_branch_month on public.capital_injections(branch_id, month_id);
create index idx_capital_injections_created_by on public.capital_injections(created_by);

-- ============================================================
-- Actualizar month_financials para incluir inyecciones
-- ============================================================

drop function if exists public.month_financials(uuid, uuid);

create or replace function public.month_financials(p_branch_id uuid, p_month_id uuid)
returns table(
  branch_share_cuts double precision,
  box_rent_total    double precision,
  branch_income     double precision,
  capital_injections double precision,
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
  inj as (
    select coalesce(sum(ci.amount), 0)::float8 as capital_injections
    from capital_injections ci
    where ci.branch_id = p_branch_id and ci.month_id = p_month_id
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
    (cuts.branch_share_cuts + box.box_rent_total)                                          as branch_income,
    inj.capital_injections,
    exp.total_expenses,
    coalesce((select initial_balance from bal), 0)                                         as initial_balance,
    coalesce((select initial_balance from bal), 0)
      + cuts.branch_share_cuts + box.box_rent_total + inj.capital_injections - exp.total_expenses as net_profit
  from cuts, box, inj, exp;
$function$;

revoke all on function public.month_financials(uuid, uuid) from public, anon;
grant execute on function public.month_financials(uuid, uuid) to authenticated;
