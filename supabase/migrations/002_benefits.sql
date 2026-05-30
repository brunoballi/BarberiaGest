-- ============================================================
-- MEJORA 1 — BENEFICIOS PREDEFINIDOS
-- Beneficios configurables por sucursal (admin). Al registrar un
-- corte, el barbero/admin elige un beneficio que pre-rellena el
-- descuento. La matemática del descuento NO cambia (sigue 50/50).
-- benefit_id queda como FK opcional en transactions para reporting.
-- Idempotente.
-- ============================================================

create table if not exists benefits (
  id             uuid          primary key default gen_random_uuid(),
  branch_id      uuid          not null references branches(id),
  name           text          not null,
  description    text,
  discount_type  text          not null check (discount_type in ('fixed', 'percentage')),
  discount_value numeric(12,2) not null check (discount_value >= 0),
  is_active      boolean       not null default true,
  created_at     timestamptz   not null default now(),
  constraint benefits_branch_name_unique unique (branch_id, name)
);

create index if not exists idx_benefits_branch on benefits(branch_id);

-- FK opcional en transactions (no rompe datos existentes)
alter table transactions add column if not exists benefit_id uuid references benefits(id);
create index if not exists idx_transactions_benefit on transactions(benefit_id);

-- ============================================================
-- RLS — espejo de service_catalog
-- ============================================================
alter table benefits enable row level security;

drop policy if exists "benefits_read"        on benefits;
drop policy if exists "benefits_admin_write" on benefits;

create policy "benefits_read" on benefits
  for select to authenticated using (true);

create policy "benefits_admin_write" on benefits
  for all to authenticated
  using      (current_user_role() = 'admin' and branch_id = current_user_branch())
  with check (current_user_role() = 'admin' and branch_id = current_user_branch());
