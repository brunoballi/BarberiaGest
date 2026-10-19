-- ============================================================
-- 087 — PORT de Flowi.estudio 111_base_de_clientes.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 111 — Base de clientes del turnero (lista para el admin)
-- ============================================================
-- Cada persona que reserva queda guardada en `appointment_clients` desde la
-- Fase 1, pero nada la mostraba. Esta función arma la lista con lo que la
-- barbería necesita para decidir a quién escribirle: cuántas veces vino,
-- cuándo fue la última, si tiene un turno por delante y cuántas veces faltó.
--
-- Es `security invoker`: las políticas RLS de appointment_clients y
-- appointments siguen aplicando, y además se chequea a mano que quien llama
-- sea ADMIN de la sucursal (esas políticas dejan leer también al barbero, y
-- la lista completa de teléfonos no es para él).
--
-- RETURNS TABLE crea variables implícitas con el nombre de cada columna
-- (full_name, phone, ...): todas las referencias van calificadas con alias
-- para que no queden ambiguas (mismo gotcha de create_appointment_admin).
-- ============================================================

create or replace function public.list_appointment_clients(p_branch_id uuid)
returns table (
  client_id     uuid,
  full_name     text,
  phone         text,
  email         text,
  created_at    timestamptz,
  total_turnos  integer,
  atendidos     integer,
  no_vino       integer,
  cancelados    integer,
  ultimo_turno  timestamptz,
  proximo_turno timestamptz
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
begin
  if not public._admin_can_manage_branch(p_branch_id) then
    raise exception 'Sin permiso sobre esta sucursal';
  end if;

  return query
    select
      c.id,
      c.full_name,
      c.phone,
      c.email,
      c.created_at,
      count(a.id)::integer,
      (count(a.id) filter (where a.status = 'atendido'))::integer,
      (count(a.id) filter (where a.status = 'no_vino'))::integer,
      (count(a.id) filter (where a.status = 'cancelado'))::integer,
      -- Última vez que vino de verdad (atendido o llegó), no la última reserva.
      max(a.starts_at) filter (where a.status in ('atendido', 'llego')),
      min(a.starts_at) filter (where a.status = 'reservado' and a.starts_at > now())
    from appointment_clients c
    left join appointments a on a.client_id = c.id
    where c.branch_id = p_branch_id
    group by c.id, c.full_name, c.phone, c.email, c.created_at
    order by 10 desc nulls last, 2;
end;
$$;

revoke execute on function public.list_appointment_clients(uuid) from public, anon;
grant  execute on function public.list_appointment_clients(uuid) to authenticated;
