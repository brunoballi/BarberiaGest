-- ============================================================
-- 090 — PORT de Flowi.estudio 114_detalle_del_turno_con_cancelacion.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 114 — Detalle completo del turno en "Gestionar mi turno"
-- ============================================================
-- La pantalla pública de gestión (código + teléfono) mostraba muy poco de un
-- turno ya cancelado: sin etiqueta de estado, sin dirección, sin código y sin
-- saber cuándo se canceló. Referencia: la ficha de una reserva cancelada de
-- WeiBook (decisión de Bruno, 2026-10-15).
--
-- Qué hace:
--   1. appointments.cancelled_at: cuándo pasó a "cancelado". Lo llena un
--      trigger, así vale para TODOS los caminos (el cliente desde el link, el
--      admin, el barbero, set_appointment_status). Los turnos ya cancelados
--      antes de esta migración quedan en null: no se inventa una fecha.
--   2. get_appointment_by_reference devuelve además la sucursal (nombre,
--      dirección y coordenadas, para "Cómo llegar"), la fecha de creación, la
--      de cancelación y la duración de cada servicio.
--
-- Sigue exigiendo código + teléfono juntos y sin distinguir "no existe" de
-- "teléfono distinto". No suma ningún dato del cliente: la dirección y el
-- nombre de la sucursal ya son públicos (list_public_branches).
-- ============================================================

alter table public.appointments
  add column if not exists cancelled_at timestamptz;

-- ------------------------------------------------------------
-- Trigger: cancelled_at sigue al estado
-- ------------------------------------------------------------
create or replace function public.set_appointment_cancelled_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    new.cancelled_at := now();
  elsif new.status <> 'cancelado' and old.status = 'cancelado' then
    -- Si alguien reabre un turno cancelado, la fecha de cancelación deja de valer.
    new.cancelled_at := null;
  end if;
  return new;
end;
$function$;

-- Función de trigger: nadie la llama a mano. Supabase le da su propio grant a
-- anon/authenticated a toda función nueva (ver el caveat de 068 y 109).
revoke execute on function public.set_appointment_cancelled_at()
  from public, anon, authenticated;

drop trigger if exists appointments_cancelled_at on public.appointments;
create trigger appointments_cancelled_at
  before update of status on public.appointments
  for each row execute function public.set_appointment_cancelled_at();

-- ------------------------------------------------------------
-- Consulta pública del turno, con más datos
-- ------------------------------------------------------------
-- El drop es obligatorio: create or replace no puede cambiar el RETURNS TABLE
-- de una función existente (mismo gotcha de 062/065/078).
drop function if exists public.get_appointment_by_reference(text, text);

create or replace function public.get_appointment_by_reference(
  p_reference text,
  p_phone     text
)
returns table (
  reference         text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            appointment_status,
  barber_name       text,
  client_name       text,
  total_price       numeric,
  services          jsonb,
  branch_name       text,
  branch_address    text,
  branch_latitude   numeric,
  branch_longitude  numeric,
  created_at        timestamptz,
  cancelled_at      timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.reference, a.starts_at, a.ends_at, a.status,
         p.full_name, c.full_name,
         coalesce(sum(s.price), 0),
         coalesce(jsonb_agg(jsonb_build_object('name', s.service_name,
                                               'price', s.price,
                                               'duration_min', s.duration_min)
                            order by s.created_at) filter (where s.id is not null), '[]'::jsonb),
         b.name, b.address, b.latitude, b.longitude,
         a.created_at, a.cancelled_at
    from appointments a
    join profiles p            on p.id = a.barber_id
    join appointment_clients c on c.id = a.client_id
    join branches b            on b.id = a.branch_id
    left join appointment_services s on s.appointment_id = a.id
   where upper(btrim(p_reference)) = a.reference
     and c.phone = btrim(p_phone)
   group by a.reference, a.starts_at, a.ends_at, a.status, p.full_name, c.full_name,
            b.name, b.address, b.latitude, b.longitude, a.created_at, a.cancelled_at;
$function$;

revoke execute on function public.get_appointment_by_reference(text, text) from public;
grant execute on function public.get_appointment_by_reference(text, text) to anon, authenticated, service_role;
