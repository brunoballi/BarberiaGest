-- ============================================================
-- 070 — PORT de Flowi.estudio 060_agenda_barbero.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — Fase 3: agenda del barbero + precarga del corte
-- ============================================================
-- Ver docs/turnero_plan.md secciones 2 y 5. El barbero necesita ver su propia
-- agenda, cambiar el estado de sus turnos, cargar uno a mano para el cliente
-- que llamó por teléfono, bloquear un horario puntual ("hoy me voy antes"),
-- y — al marcar un turno "atendido" — precargar el corte en el gestor sin
-- que eso pase nunca automático.
--
-- Gotcha importante: la "capacidad de barbero" en este proyecto NO es solo
-- role = 'barber'. Hay admins que también atienden (dual role), marcados con
-- profiles.is_barber = true — el mismo criterio que ya usa BARBER_OR_DUAL en
-- lib/supabase/supabase.client.ts. Cada chequeo de permiso de acá abajo lo
-- replica como (role = 'barber' or is_barber = true); chequear solo el role
-- dejaría afuera a un admin que también corta pelo.
-- ============================================================

-- ------------------------------------------------------------
-- a) set_appointment_status: extendida para el barbero dueño del turno.
-- Admin-only hasta ahora; el comentario original ya anticipaba esta fase.
-- ------------------------------------------------------------
create or replace function public.set_appointment_status(
  p_appointment_id uuid,
  p_status         appointment_status
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch    uuid;
  v_barber    uuid;
  v_role      text;
  v_is_barber boolean;
begin
  if p_status = 'reservado' then
    raise exception 'No se puede volver un turno a "reservado" manualmente';
  end if;

  select branch_id, barber_id into v_branch, v_barber
    from appointments where id = p_appointment_id;
  if v_branch is null then
    raise exception 'El turno no existe';
  end if;

  select role, is_barber into v_role, v_is_barber
    from profiles where id = auth.uid();

  if v_role = 'admin' then
    if not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
      raise exception 'Sin permisos sobre esta sucursal';
    end if;
  elsif v_role = 'barber' or v_is_barber then
    if auth.uid() <> v_barber then
      raise exception 'Solo podés cambiar el estado de tus propios turnos';
    end if;
  else
    raise exception 'Sin permisos sobre este turno';
  end if;

  update appointments set status = p_status where id = p_appointment_id;
end;
$function$;

-- ------------------------------------------------------------
-- b) get_barber_agenda: la agenda del día del barbero autenticado. No recibe
-- barber_id -- sale de auth.uid(), así no hay forma de pedir la agenda ajena.
-- Incluye transaction_id: el frontend lo usa para no ofrecer la precarga dos
-- veces (sección 5 del plan).
-- ------------------------------------------------------------
create or replace function public.get_barber_agenda(p_date date)
returns table (
  id             uuid,
  client_name    text,
  client_phone   text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         appointment_status,
  source         appointment_source,
  reference      text,
  notes          text,
  total_price    numeric,
  services       jsonb,
  transaction_id uuid
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_barber uuid := auth.uid();
begin
  -- profiles.id calificado por el mismo motivo que en create_appointment_barber
  -- más abajo: RETURNS TABLE(id uuid, ...) crea una variable "id" implícita.
  if not exists (
    select 1 from profiles
     where profiles.id = v_barber and (profiles.role = 'barber' or profiles.is_barber)
  ) then
    raise exception 'Solo barberos pueden ver su propia agenda';
  end if;

  return query
    select
      a.id, c.full_name, c.phone,
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
     -- América/Argentina, no la zona horaria de la sesión — mismo criterio
     -- que get_admin_agenda.
     and (a.starts_at at time zone 'America/Argentina/Buenos_Aires')::date = p_date
   group by a.id, c.full_name, c.phone, a.starts_at, a.ends_at, a.status,
            a.source, a.reference, a.notes, a.transaction_id
   order by a.starts_at;
end;
$function$;

-- ------------------------------------------------------------
-- c) create_appointment_barber: el barbero agenda a mano para el cliente que
-- llamó por teléfono. Mismo cuerpo que create_appointment_admin, pero
-- barber_id/branch_id salen de la sesión, no de parámetros, y source es
-- 'barbero'.
-- ------------------------------------------------------------
create or replace function public.create_appointment_barber(
  p_client_name  text,
  p_client_phone text,
  p_starts_at    timestamptz,
  p_service_ids  uuid[],
  p_client_email text default null,
  p_notes        text default null
)
returns table (id uuid, reference text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_barber      uuid := auth.uid();
  v_branch      uuid;
  v_client_id   uuid;
  v_total_min   integer;
  v_ends_at     timestamptz;
  v_appt_id     uuid;
  v_reference   text;
  v_intentos    integer := 0;
  v_svc_count   integer;
begin
  -- profiles.id calificado a propósito: RETURNS TABLE(id uuid, ...) crea una
  -- variable "id" implícita en el cuerpo (mismo gotcha ya documentado en
  -- create_appointment_admin, 056_appointments.sql) -- un "id" sin calificar
  -- acá quedaría ambiguo entre esa variable y la columna de profiles.
  if not exists (
    select 1 from profiles
     where profiles.id = v_barber and (profiles.role = 'barber' or profiles.is_barber)
  ) then
    raise exception 'Solo barberos pueden agendar turnos propios';
  end if;

  v_branch := current_user_branch();
  if v_branch is null then
    raise exception 'No tenés una sucursal asignada';
  end if;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Elegí al menos un servicio';
  end if;

  if btrim(coalesce(p_client_name, '')) = '' then
    raise exception 'El nombre del cliente es obligatorio';
  end if;
  if btrim(coalesce(p_client_phone, '')) = '' then
    raise exception 'El teléfono del cliente es obligatorio';
  end if;

  select count(*), coalesce(sum(duration_min), 0)
    into v_svc_count, v_total_min
    from service_catalog
   where service_catalog.id = any(p_service_ids)
     and branch_id = v_branch
     and is_active
     and duration_min is not null;

  if v_svc_count <> array_length(p_service_ids, 1) then
    raise exception 'Algún servicio elegido no existe, está inactivo o no tiene duración configurada';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_total_min);

  insert into appointment_clients (branch_id, full_name, phone, email)
  values (v_branch, btrim(p_client_name), btrim(p_client_phone), p_client_email)
  on conflict (branch_id, phone) do update
    set full_name = excluded.full_name,
        email     = coalesce(excluded.email, appointment_clients.email)
  returning appointment_clients.id into v_client_id;

  loop
    v_intentos := v_intentos + 1;
    v_reference := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into appointments (branch_id, barber_id, client_id, starts_at, ends_at,
                                source, reference, notes, created_by)
      values (v_branch, v_barber, v_client_id, p_starts_at, v_ends_at,
              'barbero', v_reference, p_notes, auth.uid())
      returning appointments.id into v_appt_id;
      exit;
    exception
      when unique_violation then
        if v_intentos >= 5 then
          raise exception 'No se pudo generar un código de referencia único, reintentá';
        end if;
      when exclusion_violation then
        raise exception 'Ese horario ya no está libre';
    end;
  end loop;

  insert into appointment_services (appointment_id, service_id, service_name, price, duration_min)
  select v_appt_id, sc.id, sc.name, sc.base_price, sc.duration_min
    from service_catalog sc
   where sc.id = any(p_service_ids);

  return query select v_appt_id, v_reference;
end;
$function$;

-- ------------------------------------------------------------
-- d) create_schedule_exception_barber: el barbero bloquea su propio horario
-- ("hoy me voy antes", "salgo a comer", franco puntual). Siempre barber_id =
-- auth.uid() -- no puede tocar el horario de otro ni el de toda la sucursal
-- (eso sigue siendo exclusivo del admin vía create_schedule_exception).
-- ------------------------------------------------------------
create or replace function public.create_schedule_exception_barber(
  p_exception_date date,
  p_closed_all_day boolean default true,
  p_start_time     time    default null,
  p_end_time       time    default null,
  p_reason         text    default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_barber uuid := auth.uid();
  v_branch uuid;
  v_id     uuid;
begin
  if not exists (
    select 1 from profiles
     where id = v_barber and (role = 'barber' or is_barber)
  ) then
    raise exception 'Solo barberos pueden bloquear su propio horario';
  end if;

  v_branch := current_user_branch();
  if v_branch is null then
    raise exception 'No tenés una sucursal asignada';
  end if;

  insert into schedule_exceptions (branch_id, barber_id, exception_date, closed_all_day,
                                   start_time, end_time, reason, created_by)
  values (v_branch, v_barber, p_exception_date, p_closed_all_day,
          p_start_time, p_end_time, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

-- ------------------------------------------------------------
-- e) link_appointment_transaction: el puente de la sección 5 del plan. Se
-- llama SOLO cuando el barbero confirma la precarga del corte -- nunca
-- automático. Blindado en tres frentes: el turno tiene que ser suyo (o del
-- admin de su sucursal), no puede tener ya un corte vinculado (no se ofrece
-- la precarga dos veces), y el corte que se vincula tiene que ser del mismo
-- barbero (no se puede pegar un corte ajeno a un turno).
-- ------------------------------------------------------------
create or replace function public.link_appointment_transaction(
  p_appointment_id uuid,
  p_transaction_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_appt_branch uuid;
  v_appt_barber uuid;
  v_existing    uuid;
  v_tx_barber   uuid;
  v_role        text;
  v_is_barber   boolean;
begin
  select branch_id, barber_id, transaction_id
    into v_appt_branch, v_appt_barber, v_existing
    from appointments where id = p_appointment_id;
  if v_appt_branch is null then
    raise exception 'El turno no existe';
  end if;

  select role, is_barber into v_role, v_is_barber from profiles where id = auth.uid();

  if v_role = 'admin' then
    if not coalesce(current_admin_has_branch(v_appt_branch) or v_appt_branch = current_user_branch(), false) then
      raise exception 'Sin permisos sobre esta sucursal';
    end if;
  elsif v_role = 'barber' or v_is_barber then
    if auth.uid() <> v_appt_barber then
      raise exception 'Ese turno no es tuyo';
    end if;
  else
    raise exception 'Sin permisos sobre este turno';
  end if;

  if v_existing is not null then
    raise exception 'Este turno ya tiene un corte cargado';
  end if;

  select barber_id into v_tx_barber from transactions where id = p_transaction_id;
  if v_tx_barber is null or v_tx_barber <> v_appt_barber then
    raise exception 'Ese corte no corresponde a este turno';
  end if;

  update appointments set transaction_id = p_transaction_id where id = p_appointment_id;
end;
$function$;

grant execute on function public.set_appointment_status(uuid, appointment_status) to authenticated;
grant execute on function public.get_barber_agenda(date) to authenticated;
grant execute on function public.create_appointment_barber(text, text, timestamptz, uuid[], text, text) to authenticated;
grant execute on function public.create_schedule_exception_barber(date, boolean, time, time, text) to authenticated;
grant execute on function public.link_appointment_transaction(uuid, uuid) to authenticated;
