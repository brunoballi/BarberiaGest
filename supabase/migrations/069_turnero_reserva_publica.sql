-- ============================================================
-- 069 — PORT de Flowi.estudio 059_reserva_publica.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — Fase 2: reserva pública (sin login)
-- ============================================================
-- Es la primera superficie del sistema que se usa SIN sesión. Todas las
-- políticas RLS del proyecto asumen un `auth.uid()`, así que el enfoque acá
-- es distinto y deliberado:
--
--   AL ROL `anon` NO SE LE DA ACCESO A NINGUNA TABLA. Ni de lectura.
--   Solo se le otorgan estas cinco funciones, que devuelven exactamente lo
--   que la pantalla de reserva necesita mostrar y nada más.
--
-- Por qué importa: si se abriera `appointment_clients` a lectura anónima,
-- cualquiera con la clave pública (que viaja en el JavaScript del navegador)
-- se baja la lista completa de clientes con sus teléfonos. Con RPC acotadas,
-- ese dato no sale nunca — ninguna de estas funciones devuelve datos de otros
-- clientes.
--
-- Ver también 058_revocar_anon_rpc_sensibles.sql: antes de esta fase había
-- cuatro RPC administrativas otorgadas a `anon` por error.
-- ============================================================

-- Huso fijo del negocio. Las franjas se guardan como `time` (hora de pared) y
-- los turnos como `timestamptz` (instante absoluto); esta es la bisagra entre
-- las dos representaciones. Con el huso de la sesión, un turno de las 20:00
-- podría calcularse para otra hora según desde dónde se conecte el cliente.
create or replace function public.flowi_tz()
returns text language sql immutable set search_path to 'public' as $function$
  select 'America/Argentina/Buenos_Aires'
$function$;

-- ------------------------------------------------------------
-- 1. Datos de la sucursal para la portada pública
-- ------------------------------------------------------------
-- Devuelve solo lo que se muestra en pantalla. Nada de datos internos.
create or replace function public.get_public_branch(p_branch_id uuid default null)
returns table (id uuid, name text, address text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address
    from branches b
   where b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by b.name
   limit 1;
$function$;

-- ------------------------------------------------------------
-- 2. Servicios reservables
-- ------------------------------------------------------------
create or replace function public.get_bookable_services(p_branch_id uuid)
returns table (
  id           uuid,
  name         text,
  description  text,
  base_price   numeric,
  duration_min integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id, s.name, s.description, s.base_price, s.duration_min
    from service_catalog s
   where s.branch_id = p_branch_id
     and s.is_active
     and s.is_bookable
     and s.duration_min is not null
   order by s.name;
$function$;

-- ------------------------------------------------------------
-- 3. Barberos que toman turnos
-- ------------------------------------------------------------
-- Solo los que tienen al menos una franja en modo 'turno'. Un barbero que
-- únicamente atiende por orden de llegada no aparece para reservar — no
-- tendría ningún horario que ofrecer.
--
-- Devuelve `full_name` y nada más: ni email, ni DNI, ni condiciones de
-- liquidación. El nombre ya es público (está en la puerta del local).
create or replace function public.get_public_barbers(p_branch_id uuid)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct p.id, p.full_name
    from profiles p
    join barber_schedules bs on bs.barber_id = p.id and bs.mode = 'turno'
   where p.branch_id = p_branch_id
     and p.is_active
   order by p.full_name;
$function$;

-- ------------------------------------------------------------
-- 4. Franjas por orden de llegada
-- ------------------------------------------------------------
-- El caso de Valhalla: "de 9:30 a 13:30 es por orden de llegada, después con
-- turno". Esas franjas NO generan horarios reservables, pero el cliente tiene
-- que verlas o va a creer que la barbería está cerrada a la mañana.
create or replace function public.get_walkin_windows(p_branch_id uuid, p_date date)
returns table (barber_id uuid, barber_name text, start_time time, end_time time)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select bs.barber_id, p.full_name, bs.start_time, bs.end_time
    from barber_schedules bs
    join profiles p on p.id = bs.barber_id
   where bs.branch_id = p_branch_id
     and bs.mode = 'orden_llegada'
     and bs.weekday = extract(dow from p_date)::smallint
     and p.is_active
     -- Un feriado tapa también la franja de orden de llegada.
     and not exists (
       select 1 from schedule_exceptions e
        where e.branch_id = p_branch_id
          and e.exception_date = p_date
          and e.closed_all_day
          and (e.barber_id is null or e.barber_id = bs.barber_id)
     )
   order by p.full_name, bs.start_time;
$function$;

-- ------------------------------------------------------------
-- 5. Horarios disponibles — el corazón de la reserva
-- ------------------------------------------------------------
-- Toma las franjas 'turno' del barbero para ese día, les resta las
-- excepciones y los turnos ya tomados, y devuelve los huecos donde entra la
-- duración TOTAL de los servicios elegidos.
--
-- Se calcula en el servidor a propósito: un cálculo de disponibilidad hecho
-- en el navegador se manipula cambiando el JavaScript.
create or replace function public.get_available_slots(
  p_branch_id   uuid,
  p_barber_id   uuid,
  p_date        date,
  p_service_ids uuid[]
)
returns table (slot_at timestamptz, period text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tz          text := flowi_tz();
  v_total_min   integer;
  v_svc_count   integer;
  v_weekday     smallint := extract(dow from p_date)::smallint;
  v_franja      record;
  v_ex_start    time;
  v_ex_end      time;
  v_win_start   timestamptz;
  v_win_end     timestamptz;
  v_cursor      timestamptz;
  v_slot_end    timestamptz;
  v_hour        integer;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    return;
  end if;

  select count(*), coalesce(sum(sc.duration_min), 0)
    into v_svc_count, v_total_min
    from service_catalog sc
   where sc.id = any(p_service_ids)
     and sc.branch_id = p_branch_id
     and sc.is_active
     and sc.is_bookable
     and sc.duration_min is not null;

  -- Si alguno no pasó el filtro, no se devuelve nada: mejor una pantalla sin
  -- horarios que ofrecer un turno que después la reserva va a rechazar.
  if v_svc_count is null or v_svc_count <> array_length(p_service_ids, 1) or v_total_min <= 0 then
    return;
  end if;

  -- Feriado / franco de día completo: no hay nada que ofrecer.
  if exists (
    select 1 from schedule_exceptions e
     where e.branch_id = p_branch_id
       and e.exception_date = p_date
       and e.closed_all_day
       and (e.barber_id is null or e.barber_id = p_barber_id)
  ) then
    return;
  end if;

  -- Excepción parcial ("hoy atiendo 14 a 18"): recorta la franja habitual.
  select e.start_time, e.end_time into v_ex_start, v_ex_end
    from schedule_exceptions e
   where e.branch_id = p_branch_id
     and e.exception_date = p_date
     and not e.closed_all_day
     and (e.barber_id is null or e.barber_id = p_barber_id)
   order by (e.barber_id is not null) desc  -- la del barbero pisa a la de la sucursal
   limit 1;

  for v_franja in
    select bs.start_time, bs.end_time, bs.slot_minutes
      from barber_schedules bs
     where bs.branch_id = p_branch_id
       and bs.barber_id = p_barber_id
       and bs.weekday = v_weekday
       and bs.mode = 'turno'
     order by bs.start_time
  loop
    v_win_start := (p_date + v_franja.start_time) at time zone v_tz;
    v_win_end   := (p_date + v_franja.end_time)   at time zone v_tz;

    if v_ex_start is not null then
      v_win_start := greatest(v_win_start, (p_date + v_ex_start) at time zone v_tz);
      v_win_end   := least(v_win_end,   (p_date + v_ex_end)   at time zone v_tz);
    end if;

    v_cursor := v_win_start;
    while v_cursor + make_interval(mins => v_total_min) <= v_win_end loop
      v_slot_end := v_cursor + make_interval(mins => v_total_min);

      -- No se ofrece un horario pasado. Vale también para hoy a media tarde:
      -- los turnos de la mañana ya no se pueden reservar.
      if v_cursor > now()
         and not exists (
           select 1 from appointments a
            where a.barber_id = p_barber_id
              and a.status not in ('cancelado', 'no_vino')
              and tstzrange(a.starts_at, a.ends_at) && tstzrange(v_cursor, v_slot_end)
         )
      then
        v_hour := extract(hour from (v_cursor at time zone v_tz))::integer;
        slot_at := v_cursor;
        period  := case when v_hour < 12 then 'manana'
                        when v_hour < 18 then 'tarde'
                        else 'noche' end;
        return next;
      end if;

      v_cursor := v_cursor + make_interval(mins => v_franja.slot_minutes);
    end loop;
  end loop;
end;
$function$;

-- ------------------------------------------------------------
-- 6. Crear la reserva
-- ------------------------------------------------------------
-- Revalida TODO del lado del servidor. Que la pantalla haya ofrecido un
-- horario no alcanza: entre que se mostró y se confirmó pudo tomarlo otro, y
-- además un POST hecho a mano puede mandar cualquier hora.
create or replace function public.create_appointment_public(
  p_branch_id    uuid,
  p_barber_id    uuid,
  p_client_name  text,
  p_client_phone text,
  p_starts_at    timestamptz,
  p_service_ids  uuid[],
  p_client_email text default null
)
returns table (reference text, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
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

-- ------------------------------------------------------------
-- 7. Consultar / cancelar con el código de referencia
-- ------------------------------------------------------------
-- El cliente no tiene cuenta, así que el código corto es su única credencial.
-- Se exige código + teléfono juntos: con el código solo, alguien podría
-- probar combinaciones hasta cancelarle el turno a otro.
create or replace function public.get_appointment_by_reference(
  p_reference text,
  p_phone     text
)
returns table (
  reference   text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  status      appointment_status,
  barber_name text,
  client_name text,
  total_price numeric,
  services    jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.reference, a.starts_at, a.ends_at, a.status,
         p.full_name, c.full_name,
         coalesce(sum(s.price), 0),
         coalesce(jsonb_agg(jsonb_build_object('name', s.service_name, 'price', s.price)
                            order by s.created_at), '[]'::jsonb)
    from appointments a
    join profiles p            on p.id = a.barber_id
    join appointment_clients c on c.id = a.client_id
    left join appointment_services s on s.appointment_id = a.id
   where upper(btrim(p_reference)) = a.reference
     and c.phone = btrim(p_phone)
   group by a.reference, a.starts_at, a.ends_at, a.status, p.full_name, c.full_name;
$function$;

create or replace function public.cancel_appointment_public(
  p_reference text,
  p_phone     text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id     uuid;
  v_starts timestamptz;
begin
  select a.id, a.starts_at into v_id, v_starts
    from appointments a
    join appointment_clients c on c.id = a.client_id
   where a.reference = upper(btrim(p_reference))
     and c.phone = btrim(p_phone)
     and a.status = 'reservado';

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

-- ============================================================
-- PERMISOS
-- ============================================================
-- Solo estas funciones, y solo ellas. `anon` no recibe acceso a ninguna tabla:
-- las políticas RLS del turnero son todas `to authenticated`, así que una
-- consulta directa desde el rol anónimo no devuelve ni una fila.
grant execute on function public.flowi_tz()                                              to anon, authenticated;
grant execute on function public.get_public_branch(uuid)                                 to anon, authenticated;
grant execute on function public.get_bookable_services(uuid)                             to anon, authenticated;
grant execute on function public.get_public_barbers(uuid)                                to anon, authenticated;
grant execute on function public.get_walkin_windows(uuid, date)                          to anon, authenticated;
grant execute on function public.get_available_slots(uuid, uuid, date, uuid[])           to anon, authenticated;
grant execute on function public.create_appointment_public(uuid, uuid, text, text, timestamptz, uuid[], text) to anon, authenticated;
grant execute on function public.get_appointment_by_reference(text, text)                to anon, authenticated;
grant execute on function public.cancel_appointment_public(text, text)                   to anon, authenticated;
