-- ============================================================
-- 096 — Turnero: un horario bloqueado no admite turnos cargados a mano
-- ============================================================
-- Un bloqueo (schedule_exceptions: franco, médico, comida, feriado) solo escondía
-- los horarios de la reserva pública. El admin podía agendar encima desde su
-- panel, y el barbero desde el suyo, porque create_appointment_admin,
-- create_appointment_barber y move_appointment solo verificaban que no se pisara
-- con otro TURNO. Ahora también verifican que no caiga en un bloqueo del barbero
-- (o de toda la sucursal: barber_id nulo, como un feriado).
-- Quien quiera agendar igual en ese horario tiene que borrar el bloqueo primero.
--
-- Reversión: supabase/pendientes/REVERTIR_096.sql
-- ============================================================

-- Devuelve el motivo del primer bloqueo que se superpone con [p_starts, p_ends),
-- o NULL si no hay ninguno. Interna: solo la llaman las funciones de abajo.
create or replace function public._bloqueo_en_horario(
  p_branch_id uuid, p_barber_id uuid, p_starts timestamptz, p_ends timestamptz
) returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(nullif(btrim(e.reason), ''), 'sin motivo')
    from schedule_exceptions e
   where e.branch_id = p_branch_id
     and (e.barber_id is null or e.barber_id = p_barber_id)
     and p_starts < case when e.closed_all_day
                         then ((e.exception_date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
                         else ((e.exception_date + e.end_time) at time zone 'America/Argentina/Buenos_Aires') end
     and p_ends   > case when e.closed_all_day
                         then (e.exception_date::timestamp at time zone 'America/Argentina/Buenos_Aires')
                         else ((e.exception_date + e.start_time) at time zone 'America/Argentina/Buenos_Aires') end
   order by e.created_at
   limit 1;
$function$;

revoke execute on function public._bloqueo_en_horario(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public._bloqueo_en_horario(uuid, uuid, timestamptz, timestamptz) to service_role;

-- ── create_appointment_admin ────────────────────────────────
create or replace function public.create_appointment_admin(p_branch_id uuid, p_barber_id uuid, p_client_name text, p_client_phone text, p_starts_at timestamp with time zone, p_service_ids uuid[], p_client_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 returns table(id uuid, reference text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_client_id   uuid;
  v_total_min   integer;
  v_ends_at     timestamptz;
  v_appt_id     uuid;
  v_reference   text;
  v_intentos    integer := 0;
  v_svc_count   integer;
  v_bloqueo     text;
begin
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para agendar en esta sucursal';
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
     and branch_id = p_branch_id
     and is_active
     and duration_min is not null;

  if v_svc_count <> array_length(p_service_ids, 1) then
    raise exception 'Algún servicio elegido no existe, está inactivo o no tiene duración configurada';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_total_min);

  v_bloqueo := public._bloqueo_en_horario(p_branch_id, p_barber_id, p_starts_at, v_ends_at);
  if v_bloqueo is not null then
    raise exception 'Ese horario está bloqueado para este barbero (%). Borrá el bloqueo si querés agendar igual.', v_bloqueo;
  end if;

  insert into appointment_clients (branch_id, full_name, phone, email)
  values (p_branch_id, btrim(p_client_name), btrim(p_client_phone), p_client_email)
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
      values (p_branch_id, p_barber_id, v_client_id, p_starts_at, v_ends_at,
              'admin', v_reference, p_notes, auth.uid())
      returning appointments.id into v_appt_id;
      exit;
    exception
      when unique_violation then
        if v_intentos >= 5 then
          raise exception 'No se pudo generar un código de referencia único, reintentá';
        end if;
      when exclusion_violation then
        raise exception 'Ese horario ya no está libre para este barbero';
    end;
  end loop;

  insert into appointment_services (appointment_id, service_id, service_name, price, duration_min)
  select v_appt_id, sc.id, sc.name, sc.base_price, sc.duration_min
    from service_catalog sc
   where sc.id = any(p_service_ids);

  return query select v_appt_id, v_reference;
end;
$function$;

-- ── create_appointment_barber ───────────────────────────────
create or replace function public.create_appointment_barber(p_client_name text, p_client_phone text, p_starts_at timestamp with time zone, p_service_ids uuid[], p_client_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 returns table(id uuid, reference text)
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
  v_bloqueo     text;
begin
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

  v_bloqueo := public._bloqueo_en_horario(v_branch, v_barber, p_starts_at, v_ends_at);
  if v_bloqueo is not null then
    raise exception 'Ese horario está bloqueado (%). Borrá el bloqueo si querés agendar igual.', v_bloqueo;
  end if;

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

-- ── move_appointment ────────────────────────────────────────
create or replace function public.move_appointment(p_appointment_id uuid, p_new_starts_at timestamp with time zone, p_new_barber_id uuid DEFAULT NULL::uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_branch    uuid;
  v_barber    uuid;
  v_status    appointment_status;
  v_total_min integer;
  v_new_ends  timestamptz;
  v_bloqueo   text;
begin
  select branch_id, barber_id, status
    into v_branch, v_barber, v_status
    from appointments where id = p_appointment_id;

  if v_branch is null then
    raise exception 'El turno no existe';
  end if;
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;
  if v_status in ('cancelado') then
    raise exception 'Un turno cancelado no se puede mover';
  end if;

  select coalesce(sum(duration_min), 0) into v_total_min
    from appointment_services where appointment_id = p_appointment_id;

  v_new_ends := p_new_starts_at + make_interval(mins => v_total_min);

  v_bloqueo := public._bloqueo_en_horario(v_branch, coalesce(p_new_barber_id, v_barber), p_new_starts_at, v_new_ends);
  if v_bloqueo is not null then
    raise exception 'Ese horario está bloqueado para este barbero (%). Borrá el bloqueo si querés mover el turno ahí.', v_bloqueo;
  end if;

  begin
    update appointments
       set starts_at = p_new_starts_at,
           ends_at   = v_new_ends,
           barber_id = coalesce(p_new_barber_id, v_barber)
     where id = p_appointment_id;
  exception
    when exclusion_violation then
      raise exception 'Ese horario ya no está libre para este barbero';
  end;
end;
$function$;
