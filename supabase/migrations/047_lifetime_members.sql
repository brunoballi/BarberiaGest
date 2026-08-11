-- ============================================================
-- BENEFICIO "SOCIO VITALICIO"
-- ============================================================
-- Lista GLOBAL de socios vitalicios (no por sucursal: un socio
-- vitalicio vale en cualquier sucursal de la barberia).
--
-- Al registrar un corte con un beneficio marcado como
-- requires_member_document, el barbero tiene que ingresar el DNI y
-- el sistema lo valida contra esta lista. Si no esta, NO se guarda
-- el corte.

create table if not exists public.lifetime_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  document_number text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.lifetime_members enable row level security;

-- Lectura: cualquier usuario autenticado. La necesitan los dos roles —
-- el admin para administrar la lista, y el barbero para validar el DNI
-- al registrar el corte (desde cualquier sucursal).
create policy lifetime_members_read on public.lifetime_members
  for select
  to authenticated
  using (true);

-- Escritura: solo admins.
create policy lifetime_members_admin_write on public.lifetime_members
  for all
  to authenticated
  using ((select auth_role()) = 'admin'::user_role)
  with check ((select auth_role()) = 'admin'::user_role);

-- ── Que beneficio exige documento ─────────────────────────────
-- Flag generico: sirve para cualquier beneficio futuro que necesite
-- validar contra la lista, no solo "socio vitalicio". Evita hardcodear
-- el nombre del beneficio en el frontend.
alter table public.benefits
  add column if not exists requires_member_document boolean not null default false;

-- ── Trazabilidad en la transaccion ────────────────────────────
-- Se guarda la referencia al socio, no el DNI suelto: al momento del
-- insert ya sabemos que existe en la lista (la validacion es bloqueante).
alter table public.transactions
  add column if not exists lifetime_member_id uuid references public.lifetime_members(id);

create index if not exists idx_transactions_lifetime_member
  on public.transactions(lifetime_member_id);
