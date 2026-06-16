-- ============================================================
-- DEUDAS DE BARBEROS — Registro de devoluciones / pagos de deuda
-- ------------------------------------------------------------
-- Cuando una liquidación es negativa (net_payable < 0) el barbero le DEBE a la
-- barbería. Marcarla como 'paid' cierra la liquidación pero no reflejaba si el
-- barbero efectivamente devolvió esa plata. Esta tabla registra esos pagos para
-- llevar un saldo deudor acumulado por barbero.
--
--   saldo deudor = Σ(-net_payable de liquidaciones 'paid' con net_payable<0)
--                  − Σ(pagos registrados en barber_debt_payments)
--
-- NOTA: el pago de deuda NO suma a la Ganancia neta (esa plata ya está contada
-- por devengado: comisión vía branch_share o alquiler vía box_rent). Es solo
-- seguimiento de cobranza / caja.
-- ============================================================

create table if not exists public.barber_debt_payments (
  id             uuid primary key default gen_random_uuid(),
  barber_id      uuid not null references public.profiles(id) on delete cascade,
  branch_id      uuid not null references public.branches(id) on delete cascade,
  amount         numeric not null check (amount > 0),
  payment_method text   not null default 'cash',
  payment_date   date   not null default current_date,
  notes          text,
  registered_by  uuid   not null references public.profiles(id),
  created_at     timestamptz not null default now()
);

create index if not exists idx_barber_debt_payments_barber
  on public.barber_debt_payments(barber_id, branch_id);

alter table public.barber_debt_payments enable row level security;

-- Admin de la sucursal: acceso total (igual patrón que expenses/advances).
drop policy if exists debt_payments_admin_all on public.barber_debt_payments;
create policy debt_payments_admin_all on public.barber_debt_payments
  for all to authenticated
  using ((select current_user_role()) = 'admin'::user_role and current_admin_has_branch(branch_id))
  with check ((select current_user_role()) = 'admin'::user_role and current_admin_has_branch(branch_id));

-- ── Resumen de saldo deudor por barbero (para la sección "Saldo deudor") ──
create or replace function public.get_barber_debt_summary(p_branch_id uuid)
returns table(
  barber_id        uuid,
  full_name        text,
  total_debt       numeric,
  total_paid       numeric,
  outstanding_debt numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with debts as (
    select s.barber_id, coalesce(sum(-s.net_payable), 0) as total_debt
    from settlements s
    where s.branch_id = p_branch_id and s.status = 'paid' and s.net_payable < 0
    group by s.barber_id
  ),
  pays as (
    select dp.barber_id, coalesce(sum(dp.amount), 0) as total_paid
    from barber_debt_payments dp
    where dp.branch_id = p_branch_id
    group by dp.barber_id
  )
  select
    p.id,
    p.full_name,
    coalesce(d.total_debt, 0),
    coalesce(pp.total_paid, 0),
    coalesce(d.total_debt, 0) - coalesce(pp.total_paid, 0)
  from profiles p
  left join debts d  on d.barber_id  = p.id
  left join pays  pp on pp.barber_id = p.id
  where coalesce(d.total_debt, 0) <> 0 or coalesce(pp.total_paid, 0) <> 0
  order by (coalesce(d.total_debt, 0) - coalesce(pp.total_paid, 0)) desc;
$function$;

grant execute on function public.get_barber_debt_summary(uuid) to anon, authenticated, service_role;
