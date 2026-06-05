-- ============================================================
-- SALDO INICIAL DEL MES (revenue_balances)
-- Capital con el que arranca el mes una sucursal. Un registro por
-- (branch_id, month_id). Editable por admin. Puede ser negativo (deuda inicial).
-- Se usa para calcular la Ganancia neta: saldo_inicial + ingresos - gastos.
-- RLS: mismo patrón que expenses (admin con acceso a la sucursal).
-- ============================================================

create table if not exists public.revenue_balances (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id) on delete cascade,
  month_id        uuid not null references public.months(id) on delete cascade,
  initial_balance numeric(12,2) not null default 0,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (branch_id, month_id)
);

create index if not exists idx_revenue_balances_branch_month
  on public.revenue_balances(branch_id, month_id);

alter table public.revenue_balances enable row level security;

drop policy if exists revenue_balances_admin_all on public.revenue_balances;
create policy revenue_balances_admin_all on public.revenue_balances
  for all
  using ((select current_user_role()) = 'admin'::user_role and current_admin_has_branch(branch_id))
  with check ((select current_user_role()) = 'admin'::user_role and current_admin_has_branch(branch_id));

comment on table public.revenue_balances is
  'Saldo inicial del mes por sucursal. Usado en la Ganancia neta = saldo_inicial + ingresos - gastos.';
