-- ============================================================
-- 095 — Turnero: el barbero no ve el teléfono del cliente
-- ============================================================
-- Hasta ahora cualquier barbero de la sucursal podía leer el teléfono (y mail)
-- de los clientes de turnos: directo de la tabla appointment_clients (la política
-- de lectura abarcaba a todos los de la sucursal) y desde get_admin_agenda /
-- get_barber_agenda. Eso deja que un barbero se lleve la cartera de clientes del
-- dueño. Esta migración lo cierra:
--   1. appointment_clients: solo la leen los admins de la sucursal.
--   2. get_admin_agenda: solo admins (antes también la ejecutaba un barbero de
--      la sucursal y recibía los teléfonos).
--   3. get_barber_agenda: devuelve el nombre del cliente, sin teléfono.
-- El barbero seguirá pudiendo escribirle al cliente por un envío del servidor
-- (etapa siguiente), sin que el número llegue nunca a su pantalla.
--
-- Reversión: supabase/pendientes/REVERTIR_095.sql
-- ============================================================

-- 1. Solo admins leen los clientes de turnos.
drop policy if exists "appointment_clients_read" on appointment_clients;
create policy "appointment_clients_read" on appointment_clients
  for select to authenticated
  using (public._admin_can_manage_branch(branch_id));

-- 2. get_admin_agenda: solo admins con acceso a la sucursal.
create or replace function public.get_admin_agenda(p_branch_id uuid, p_date date)
returns table (
  id uuid, barber_id uuid, barber_name text, client_name text, client_phone text,
  starts_at timestamptz, ends_at timestamptz, status appointment_status,
  source appointment_source, reference text, notes text, total_price numeric,
  services jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce(public._admin_can_manage_branch(p_branch_id), false) then
    raise exception 'Sin acceso a esta sucursal';
  end if;

  return query
    select
      a.id, a.barber_id, p.full_name, c.full_name, c.phone,
      a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes,
      coalesce(sum(s.price), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'service_id', s.service_id,
        'name', s.service_name,
        'price', s.price,
        'duration_min', s.duration_min
      ) order by s.created_at), '[]'::jsonb)
    from appointments a
    join profiles p            on p.id = a.barber_id
    join appointment_clients c on c.id = a.client_id
    left join appointment_services s on s.appointment_id = a.id
   where a.branch_id = p_branch_id
     and (a.starts_at at time zone 'America/Argentina/Buenos_Aires')::date = p_date
   group by a.id, a.barber_id, p.full_name, c.full_name, c.phone,
            a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes
   order by a.starts_at;
end;
$function$;

-- 3. get_barber_agenda sin teléfono (cambia el tipo de retorno: hay que recrearla).
drop function if exists public.get_barber_agenda(date);
create function public.get_barber_agenda(p_date date)
returns table (
  id uuid, client_name text, starts_at timestamptz, ends_at timestamptz,
  status appointment_status, source appointment_source, reference text,
  notes text, total_price numeric, services jsonb, transaction_id uuid
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_barber uuid := auth.uid();
begin
  if not exists (
    select 1 from profiles
     where profiles.id = v_barber and (profiles.role = 'barber' or profiles.is_barber)
  ) then
    raise exception 'Solo barberos pueden ver su propia agenda';
  end if;

  return query
    select
      a.id, c.full_name,
      a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes,
      coalesce(sum(s.price), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'service_id', s.service_id,
        'name', s.service_name,
        'price', s.price,
        'duration_min', s.duration_min
      ) order by s.created_at), '[]'::jsonb),
      a.transaction_id
    from appointments a
    join appointment_clients c on c.id = a.client_id
    left join appointment_services s on s.appointment_id = a.id
   where a.barber_id = v_barber
     and (a.starts_at at time zone 'America/Argentina/Buenos_Aires')::date = p_date
   group by a.id, c.full_name, a.starts_at, a.ends_at, a.status,
            a.source, a.reference, a.notes, a.transaction_id
   order by a.starts_at;
end;
$function$;

-- Permisos: igual que antes (solo usuarios logueados; anon fuera).
revoke execute on function public.get_barber_agenda(date) from public, anon;
grant  execute on function public.get_barber_agenda(date) to authenticated, service_role;
revoke execute on function public.get_admin_agenda(uuid, date) from public, anon;
grant  execute on function public.get_admin_agenda(uuid, date) to authenticated, service_role;
