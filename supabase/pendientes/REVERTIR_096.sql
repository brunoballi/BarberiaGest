-- Revierte la 096: los turnos cargados a mano vuelven a poder pisar un bloqueo.
-- (Solo para emergencias.)

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

drop function if exists public._bloqueo_en_horario(uuid, uuid, timestamptz, timestamptz);
