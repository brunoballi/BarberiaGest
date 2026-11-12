-- 108 — Turnero: blindaje de concurrencia
--
-- Salió de una prueba de carga (barberos de una sucursal y de dos sucursales pidiendo,
-- cancelando y moviendo turnos a la vez). La garantía central (dos turnos del mismo
-- barbero no se solapan) aguantó; esto cierra lo que no:
--
--   1. "Sin preferencia": con varios clientes pidiendo el mismo horario, ~3% recibía
--      "deadlock detected". Ahora hay un candado por (sucursal, horario) y, por las dudas,
--      un deadlock se trata como "probá con el siguiente barbero".
--   2. Tope de 3 turnos por teléfono: se contaba y después se insertaba, así que pedidos
--      simultáneos del mismo teléfono lo pasaban (12 de 12 en la prueba). Ahora hay un
--      candado por (sucursal, teléfono) antes de contar.
--   3. Un turno cancelado se podía volver a "llegó"/"atendido", y si su horario ya lo
--      había tomado otro el admin veía el error técnico de la restricción. Ahora
--      set_appointment_status lo rechaza con un mensaje claro y bloquea la fila.
--   4. Cancelar dos veces a la vez (doble clic, barbero + cliente) aceptaba las dos y
--      repetía el motivo en las notas. Las cuatro vías de cancelar bloquean la fila
--      antes de mirar el estado: la segunda ve "ya cancelado".
--
-- Mismas firmas y mismos nombres: los permisos de 091/099 se conservan.
-- Todas son create or replace: idempotente.

CREATE OR REPLACE FUNCTION public.set_appointment_status(p_appointment_id uuid, p_status appointment_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch    uuid;
  v_barber    uuid;
  v_role      text;
  v_is_barber boolean;
  v_status    appointment_status;
begin
  if p_status = 'reservado' then
    raise exception 'No se puede volver un turno a "reservado" manualmente';
  end if;

  select branch_id, barber_id, status into v_branch, v_barber, v_status
    from appointments where id = p_appointment_id
   for update;
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

  -- Un turno cancelado no se revive: su horario ya pudo tomarlo otro cliente.
  -- Si el cliente vuelve, se carga un turno nuevo.
  if v_status = 'cancelado' then
    raise exception 'Este turno está cancelado: no se puede cambiar su estado. Cargá un turno nuevo.';
  end if;

  update appointments set status = p_status where id = p_appointment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_appointment(p_appointment_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch uuid;
  v_status appointment_status;
begin
  select branch_id, status into v_branch, v_status
    from appointments where id = p_appointment_id
   for update;
  if v_branch is null then
    raise exception 'El turno no existe';
  end if;
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;

  -- Ya cancelado (doble clic, dos pantallas): no hace nada, no repite el motivo.
  if v_status = 'cancelado' then
    return;
  end if;

  update appointments
     set status = 'cancelado',
         notes  = case when p_reason is not null and btrim(p_reason) <> ''
                        then coalesce(notes || ' — ', '') || 'Cancelado: ' || p_reason
                        else notes end
   where id = p_appointment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_appointment_public(p_reference text, p_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id     uuid;
  v_starts timestamptz;
begin
  select a.id, a.starts_at into v_id, v_starts
    from appointments a
    join appointment_clients c on c.id = a.client_id
   where a.reference = upper(btrim(p_reference))
     and c.phone = btrim(p_phone)
     and a.status = 'reservado'
   for update of a;

  if v_id is null then
    -- Mensaje deliberadamente vago: distinguir "no existe" de "el teléfono no
    -- coincide" le confirmaría a un curioso que ese código es válido.
    raise exception 'No encontramos una reserva activa con esos datos';
  end if;

  if v_starts <= now() then
    raise exception 'Ese turno ya pasó, no se puede cancelar desde acá';
  end if;

  update appointments set status = 'cancelado' where id = v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_appointment_barber(p_appointment_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me     uuid := auth.uid();
  v_barber uuid;
  v_status appointment_status;
  v_tx     uuid;
begin
  if not exists (
    select 1 from profiles
     where profiles.id = v_me and (profiles.role = 'barber' or profiles.is_barber)
  ) then
    raise exception 'Solo barberos pueden cancelar sus turnos';
  end if;

  select barber_id, status, transaction_id
    into v_barber, v_status, v_tx
    from appointments where id = p_appointment_id
   for update;

  if v_barber is null then
    raise exception 'El turno no existe';
  end if;
  if v_barber is distinct from v_me then
    raise exception 'Solo podés cancelar tus propios turnos';
  end if;
  if v_status = 'cancelado' then
    raise exception 'El turno ya estaba cancelado';
  end if;
  if v_status in ('atendido', 'no_vino') or v_tx is not null then
    raise exception 'Este turno ya fue atendido: no se puede cancelar';
  end if;

  update appointments
     set status = 'cancelado',
         notes  = case when p_reason is not null and btrim(p_reason) <> ''
                        then coalesce(notes || ' — ', '') || 'Cancelado: ' || p_reason
                        else notes end
   where id = p_appointment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_appointment_public(p_branch_id uuid, p_barber_id uuid, p_client_name text, p_client_phone text, p_starts_at timestamp with time zone, p_service_ids uuid[], p_client_email text DEFAULT NULL::text)
 RETURNS TABLE(reference text, starts_at timestamp with time zone, ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz         text := flowi_tz();
  v_total_min  integer;
  v_svc_count  integer;
  v_ends_at    timestamptz;
  v_date       date;
  v_client_id  uuid;
  v_appt_id    uuid;
  v_reference  text;
  v_intentos   integer := 0;
  v_activos    integer;
  v_name       text := btrim(coalesce(p_client_name, ''));
  v_phone      text := btrim(coalesce(p_client_phone, ''));
begin
  if v_name = '' then
    raise exception 'Necesitamos tu nombre para agendar el turno';
  end if;
  if length(v_phone) < 6 then
    raise exception 'Necesitamos un teléfono válido para confirmarte el turno';
  end if;
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Elegí al menos un servicio';
  end if;

  select count(*), coalesce(sum(sc.duration_min), 0)
    into v_svc_count, v_total_min
    from service_catalog sc
   where sc.id = any(p_service_ids)
     and sc.branch_id = p_branch_id
     and sc.is_active
     and sc.is_bookable
     and sc.duration_min is not null;

  if v_svc_count <> array_length(p_service_ids, 1) then
    raise exception 'Alguno de los servicios elegidos ya no está disponible';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_total_min);
  v_date    := (p_starts_at at time zone v_tz)::date;

  if p_starts_at <= now() then
    raise exception 'Ese horario ya pasó. Elegí uno futuro.';
  end if;

  -- El horario tiene que ser uno de los que la propia base considera
  -- disponible. Esto cubre de una sola vez: franja inexistente, modo orden de
  -- llegada, feriado, excepción parcial y turno ya tomado. Sin esta
  -- verificación, un POST a mano podría agendar a las 4 de la mañana.
  if not exists (
    select 1 from get_available_slots(p_branch_id, p_barber_id, v_date, p_service_ids) s
     where s.slot_at = p_starts_at
  ) then
    raise exception 'Ese horario ya no está disponible. Elegí otro.';
  end if;

  -- Freno de abuso: un teléfono no puede acumular turnos futuros sin límite,
  -- que es la forma más fácil de dejar la agenda inutilizable desde afuera.
  -- Candado por (sucursal, teléfono): sin él, varios pedidos simultáneos del
  -- mismo teléfono pasan todos el conteo antes de que alguno inserte.
  perform pg_advisory_xact_lock(hashtextextended('tel:' || p_branch_id::text || ':' || v_phone, 0));

  select count(*) into v_activos
    from appointments a
    join appointment_clients c on c.id = a.client_id
   where c.branch_id = p_branch_id
     and c.phone = v_phone
     and a.status = 'reservado'
     and a.starts_at > now();

  if v_activos >= 3 then
    raise exception 'Ya tenés 3 turnos reservados. Cancelá alguno antes de sacar otro.';
  end if;

  insert into appointment_clients (branch_id, full_name, phone, email)
  values (p_branch_id, v_name, v_phone, nullif(btrim(coalesce(p_client_email, '')), ''))
  on conflict (branch_id, phone) do update
    set full_name = excluded.full_name,
        email     = coalesce(excluded.email, appointment_clients.email)
  returning appointment_clients.id into v_client_id;

  loop
    v_intentos := v_intentos + 1;
    v_reference := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into appointments (branch_id, barber_id, client_id, starts_at, ends_at,
                                source, reference)
      values (p_branch_id, p_barber_id, v_client_id, p_starts_at, v_ends_at,
              'publico', v_reference)
      returning appointments.id into v_appt_id;
      exit;
    exception
      when unique_violation then
        if v_intentos >= 5 then
          raise exception 'No pudimos generar el código de la reserva, probá de nuevo';
        end if;
      when exclusion_violation then
        -- Alguien tomó el mismo horario entre que se mostró y se confirmó.
        raise exception 'Ese horario acaba de ser tomado. Elegí otro.';
    end;
  end loop;

  insert into appointment_services (appointment_id, service_id, service_name, price, duration_min)
  select v_appt_id, sc.id, sc.name, sc.base_price, sc.duration_min
    from service_catalog sc
   where sc.id = any(p_service_ids);

  return query select v_reference, p_starts_at, v_ends_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_appointment_public_rl(p_ip_hash text, p_branch_id uuid, p_barber_id uuid, p_client_name text, p_client_phone text, p_starts_at timestamp with time zone, p_service_ids uuid[], p_client_email text DEFAULT NULL::text)
 RETURNS TABLE(reference text, starts_at timestamp with time zone, ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_tope constant integer := 20;
  v_day  date := (now() at time zone flowi_tz())::date;
  v_n    integer;
  v_cand uuid;
  v_ref  text;
  v_ini  timestamptz;
  v_fin  timestamptz;
  v_ok   boolean := false;
begin
  if coalesce(p_ip_hash, '') = '' then
    raise exception 'No pudimos identificar tu conexión. Probá de nuevo.';
  end if;

  -- Limpieza al pasar: el contador solo sirve para el día en curso.
  delete from booking_rate_limits where day < v_day - 1;

  insert into booking_rate_limits (ip_hash, day) values (p_ip_hash, v_day)
  on conflict do nothing;

  select bookings into v_n
  from booking_rate_limits
  where ip_hash = p_ip_hash and day = v_day
  for update;

  if v_n >= c_tope then
    raise exception 'Se hicieron muchas reservas hoy desde esta conexión. Si necesitás otro turno, escribinos por WhatsApp.';
  end if;

  if p_barber_id is not null then
    select r.reference, r.starts_at, r.ends_at into v_ref, v_ini, v_fin
    from create_appointment_public(
      p_branch_id, p_barber_id, p_client_name, p_client_phone,
      p_starts_at, p_service_ids, p_client_email
    ) r;
  else
    -- Un solo "sin preferencia" por horario a la vez: cada pedido probaba los
    -- barberos en un orden distinto y dos pedidos simultáneos se trababan
    -- entre sí ("deadlock detected" llegaba hasta la pantalla del cliente).
    perform pg_advisory_xact_lock(hashtextextended('slot:' || p_branch_id::text || ':' || p_starts_at::text, 0));

    for v_cand in
      select f.barber_id from _barbers_free_for_slot(p_branch_id, p_starts_at, p_service_ids) f
    loop
      begin
        select r.reference, r.starts_at, r.ends_at into v_ref, v_ini, v_fin
        from create_appointment_public(
          p_branch_id, v_cand, p_client_name, p_client_phone,
          p_starts_at, p_service_ids, p_client_email
        ) r;
        v_ok := true;
        exit;
      exception
        -- Red de seguridad: si igual hubiera un deadlock, se prueba el siguiente barbero.
        when deadlock_detected then
          null;
        when others then
        if sqlerrm not like 'Ese horario%' then
          raise;
        end if;
      end;
    end loop;

    if not v_ok then
      raise exception 'Ese horario ya no está disponible. Elegí otro.';
    end if;
  end if;

  update booking_rate_limits
  set bookings = bookings + 1
  where ip_hash = p_ip_hash and day = v_day;

  return query select v_ref, v_ini, v_fin;
end;
$function$;
