-- ============================================================
-- 103 — Participación de los socios en cada sucursal (Mejora 1)
-- ============================================================
-- Es INFORMATIVO: guarda el valor total en que está valuada la sucursal y el
-- porcentaje de cada socio. No toca retiros, liquidaciones ni reportes
-- (month_financials y compañía no leen estas tablas).
--
-- Los socios son los administradores de la sucursal (admin_branches), los mismos
-- que aparecen en "Retiros de socios". El valor se guarda en pesos.
--
-- Que los porcentajes sumen 100 NO se exige en la base: la pantalla avisa si se
-- pasan de 100 y cuánto falta asignar, pero deja guardar (puede haber una parte
-- sin asignar todavía).
--
-- Permisos: solo el admin de ESA sucursal (_admin_can_manage_branch, de la 065).
-- anon no tiene acceso a nada.
-- ============================================================

create table if not exists public.branch_valuations (
  branch_id  uuid primary key references public.branches(id) on delete cascade,
  valuation  numeric(16, 2) not null default 0 check (valuation >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.branch_partner_shares (
  branch_id  uuid not null references public.branches(id) on delete cascade,
  partner_id uuid not null references public.profiles(id) on delete cascade,
  pct        numeric(5, 2) not null check (pct >= 0 and pct <= 100),
  updated_at timestamptz not null default now(),
  primary key (branch_id, partner_id)
);

create index if not exists idx_branch_partner_shares_partner
  on public.branch_partner_shares(partner_id);

alter table public.branch_valuations     enable row level security;
alter table public.branch_partner_shares enable row level security;

revoke all on public.branch_valuations     from public, anon;
revoke all on public.branch_partner_shares from public, anon;
grant select, insert, update, delete on public.branch_valuations     to authenticated;
grant select, insert, update, delete on public.branch_partner_shares to authenticated;

drop policy if exists "branch_valuations_admin_all" on public.branch_valuations;
create policy "branch_valuations_admin_all"
  on public.branch_valuations for all to authenticated
  using      (public._admin_can_manage_branch(branch_id))
  with check (public._admin_can_manage_branch(branch_id));

drop policy if exists "branch_partner_shares_admin_all" on public.branch_partner_shares;
create policy "branch_partner_shares_admin_all"
  on public.branch_partner_shares for all to authenticated
  using      (public._admin_can_manage_branch(branch_id))
  with check (public._admin_can_manage_branch(branch_id));

-- ── Guardado atómico ────────────────────────────────────────────────────
-- p_shares: [{ "partner_id": "<uuid>", "pct": 40 }, ...]. Reemplaza el reparto
-- completo de la sucursal. Cada socio tiene que ser admin de esa sucursal; un
-- socio con pct 0 simplemente no se guarda.
create or replace function public.save_branch_partner_shares(
  p_branch_id uuid,
  p_valuation numeric,
  p_shares    jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  if not public._admin_can_manage_branch(p_branch_id) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;
  if p_valuation is null or p_valuation < 0 then
    raise exception 'El valor de la sucursal no puede ser negativo';
  end if;

  insert into branch_valuations (branch_id, valuation, updated_at, updated_by)
  values (p_branch_id, p_valuation, now(), auth.uid())
  on conflict (branch_id) do update
    set valuation = excluded.valuation,
        updated_at = now(),
        updated_by = auth.uid();

  delete from branch_partner_shares where branch_id = p_branch_id;

  for r in
    select (e->>'partner_id')::uuid as partner_id, (e->>'pct')::numeric as pct
    from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) e
  loop
    if r.pct is null or r.pct < 0 or r.pct > 100 then
      raise exception 'El porcentaje de un socio tiene que estar entre 0 y 100';
    end if;
    if r.pct = 0 then continue; end if;
    if not exists (
      select 1 from admin_branches ab
      where ab.branch_id = p_branch_id and ab.admin_id = r.partner_id
    ) then
      raise exception 'Uno de los socios no administra esta sucursal';
    end if;
    insert into branch_partner_shares (branch_id, partner_id, pct)
    values (p_branch_id, r.partner_id, r.pct);
  end loop;
end;
$$;

revoke execute on function public.save_branch_partner_shares(uuid, numeric, jsonb) from public, anon;
grant  execute on function public.save_branch_partner_shares(uuid, numeric, jsonb) to authenticated;
