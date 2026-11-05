-- ============================================================
-- 104 — Listas de personas habilitadas, una por beneficio (Mejora 3, opción B)
-- ============================================================
-- Hoy hay UNA lista global (lifetime_members = "Socios vitalicios"). Pasa a haber
-- varias listas ("member_lists"); cada beneficio que exige DNI apunta a la suya
-- (benefits.member_list_id) y el DNI se valida contra esa lista.
--
--   * Una lista vale para TODAS las sucursales (branch_id null) o para UNA sola.
--   * lifetime_members se conserva (mismos ids, mismo historial en transactions):
--     solo gana la columna list_id. "Socio Vitalicio" queda como una lista más.
--   * Es compatible hacia atrás: list_id tiene un default (la lista Socio
--     Vitalicio) y member_list_id puede ser null, así la versión vieja de la app
--     que siga abierta no se rompe mientras se despliega la nueva.
-- ============================================================

create table if not exists public.member_lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- null = vale en todas las sucursales
  branch_id   uuid references public.branches(id) on delete cascade,
  is_active   boolean not null default true,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.member_lists enable row level security;
revoke all on public.member_lists from public, anon;
grant select, insert, update, delete on public.member_lists to authenticated;

-- Lectura: todos los autenticados (el barbero la necesita para validar el DNI).
drop policy if exists member_lists_read on public.member_lists;
create policy member_lists_read on public.member_lists
  for select to authenticated using (true);

-- Escritura: solo admins.
drop policy if exists member_lists_admin_write on public.member_lists;
create policy member_lists_admin_write on public.member_lists
  for all to authenticated
  using ((select auth_role()) = 'admin'::user_role)
  with check ((select auth_role()) = 'admin'::user_role);

-- ── La lista "Socio Vitalicio" (la que ya existía) ───────────────────────
do $$
declare
  v_list uuid;
begin
  select id into v_list from public.member_lists where name = 'Socio Vitalicio' and branch_id is null limit 1;
  if v_list is null then
    insert into public.member_lists (name, branch_id) values ('Socio Vitalicio', null)
    returning id into v_list;
  end if;

  alter table public.lifetime_members add column if not exists list_id uuid references public.member_lists(id);
  update public.lifetime_members set list_id = v_list where list_id is null;
  alter table public.lifetime_members alter column list_id set not null;
  -- Default para que la app vieja (que inserta sin list_id) siga funcionando.
  execute format('alter table public.lifetime_members alter column list_id set default %L', v_list);

  alter table public.benefits add column if not exists member_list_id uuid references public.member_lists(id);
  update public.benefits set member_list_id = v_list
   where requires_member_document and member_list_id is null;
end $$;

-- El DNI ya no es único en todo el sistema: es único DENTRO de cada lista
-- (la misma persona puede estar en varias listas).
drop index if exists public.lifetime_members_documento_no_archivados;
create unique index if not exists lifetime_members_lista_documento_no_archivados
  on public.lifetime_members (list_id, document_number)
  where archived_at is null;

create index if not exists idx_lifetime_members_list on public.lifetime_members(list_id);
create index if not exists idx_benefits_member_list on public.benefits(member_list_id);

-- ── Validación en la base ────────────────────────────────────────────────
-- Igual que la 064, pero además la persona tiene que ser de LA lista del
-- beneficio, y la lista tiene que estar activa y valer en la sucursal del corte.
create or replace function public.transactions_require_lifetime_member()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_requires boolean;
  v_list     uuid;
  v_ok       boolean;
begin
  if new.benefit_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.benefit_id is not distinct from old.benefit_id
     and new.lifetime_member_id is not distinct from old.lifetime_member_id then
    return new;
  end if;

  select b.requires_member_document, b.member_list_id into v_requires, v_list
  from benefits b
  where b.id = new.benefit_id;

  if coalesce(v_requires, false) = false then
    return new;
  end if;

  if new.lifetime_member_id is null then
    raise exception 'Este beneficio exige el DNI de una persona habilitada. Si ves este mensaje, cerrá la app y volvé a abrirla para actualizarla.'
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1
    from lifetime_members m
    where m.id = new.lifetime_member_id
      and m.is_active
      and m.archived_at is null
      -- Beneficio con lista: la persona tiene que ser de esa lista, que debe
      -- estar activa y valer en esta sucursal. Sin lista (viejo): cualquiera.
      and (
        v_list is null
        or (
          m.list_id = v_list
          and exists (
            select 1 from member_lists l
            where l.id = v_list
              and l.is_active
              and l.archived_at is null
              and (l.branch_id is null or l.branch_id = new.branch_id)
          )
        )
      )
  ) into v_ok;

  if not v_ok then
    raise exception 'La persona no está habilitada para este beneficio (no figura activa en su lista). Comunicate con el administrador.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- ── Eliminar una lista ──────────────────────────────────────────────────
-- Solo si ningún beneficio la usa y ninguna de sus personas tiene cortes
-- registrados; si no, el admin la desactiva. Devuelve el nombre borrado.
create or replace function public.admin_delete_member_list(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_n      integer;
begin
  if (select auth_role()) <> 'admin' then
    raise exception 'Solo administradores pueden eliminar listas';
  end if;

  select name into v_nombre from member_lists where id = p_id;
  if v_nombre is null then raise exception 'Lista no encontrada'; end if;

  select count(*) into v_n from benefits where member_list_id = p_id;
  if v_n > 0 then
    raise exception 'No se puede eliminar "%": % beneficio(s) la usan. Desvinculala o desactivala.', v_nombre, v_n;
  end if;

  select count(*) into v_n
  from transactions t join lifetime_members m on m.id = t.lifetime_member_id
  where m.list_id = p_id;
  if v_n > 0 then
    raise exception 'No se puede eliminar "%": sus personas tienen % corte(s) registrados. Desactivala para conservar el historial.', v_nombre, v_n;
  end if;

  delete from lifetime_members where list_id = p_id;
  delete from member_lists where id = p_id;
  return v_nombre;
end;
$$;

revoke all on function public.admin_delete_member_list(uuid) from public, anon;
grant execute on function public.admin_delete_member_list(uuid) to authenticated;
