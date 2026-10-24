-- ============================================================
-- 089 — PORT de Flowi.estudio 113_reserva_sin_preferencia_de_barbero.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 113 — Reserva "sin preferencia de barbero" + servicio más elegido
-- ============================================================
-- El cliente nuevo no conoce a los barberos. En vez de obligarlo a elegir,
-- puede dejar que el sistema asigne uno. Decisiones de Bruno (2026-10-15):
--
--   · El cliente elige servicio, día y horario viendo TODOS los horarios
--     libres de la sucursal (la unión de los de cada barbero), no los de un
--     barbero sorteado de antemano: sortear primero le escondería horarios
--     que otros barberos sí tienen libres.
--   · Al confirmar, la base asigna entre los barberos libres en ese horario:
--       1. el que menos cortes tiene en la semana del turno,
--       2. si empatan (ej. arranca la semana y todos están en cero), el que
--          menos tuvo la semana anterior,
--       3. si siguen empatados, al azar.
--   · "Cortes" = lo cargado en caja (transactions) + los turnos de la app de
--     esa semana que todavía no pasaron a caja. Un turno ya vinculado a una
--     transacción (appointments.transaction_id) se cuenta UNA sola vez, por
--     la transacción: sin esto se duplicaba.
--   · Semana = lunes a domingo, en la hora de Argentina.
--   · Servicio "más elegido": el más pedido de la sucursal en los últimos 30
--     días (turnos + caja), con un mínimo de 3 para no etiquetar por azar.
--
-- La asignación la hace la base y no la pantalla: un cálculo hecho en el
-- navegador se manipula (mismo criterio que get_available_slots).
--
-- Lo que NO cambia: el turno se guarda con un barbero real (barber_id), así
-- que agenda, recordatorios, cancelación y avisos funcionan igual que antes.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Carga de un barbero en un rango [desde, hasta)
-- ------------------------------------------------------------
create or replace function public._barber_load(
  p_branch_id uuid,
  p_barber_id uuid,
  p_from      date,
  p_to        date
)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (
    select count(*) from transactions t
     where t.branch_id = p_branch_id
       and t.barber_id = p_barber_id
       and t.transaction_date >= p_from
       and t.transaction_date <  p_to
  )::integer + (
    select count(*) from appointments a
     where a.branch_id = p_branch_id
       and a.barber_id = p_barber_id
       and a.transaction_id is null
       and a.status in ('reservado', 'llego', 'atendido')
       and (a.starts_at at time zone flowi_tz())::date >= p_from
       and (a.starts_at at time zone flowi_tz())::date <  p_to
  )::integer;
$function$;

-- ------------------------------------------------------------
-- 2. Barberos libres en un horario, en orden de prioridad
-- ------------------------------------------------------------
-- Volátil a propósito (usa random() para el último desempate).
create or replace function public._barbers_free_for_slot(
  p_branch_id   uuid,
  p_starts_at   timestamptz,
  p_service_ids uuid[]
)
returns table (barber_id uuid)
language sql
security definer
set search_path to 'public'
as $function$
  with ctx as (
    select (p_starts_at at time zone flowi_tz())::date as d
  ), wk as (
    select date_trunc('week', ctx.d::timestamp)::date as w0 from ctx
  )
  select b.id
    from get_public_barbers(p_branch_id) b
   cross join ctx
   cross join wk
   where exists (
           select 1
             from get_available_slots(p_branch_id, b.id, ctx.d, p_service_ids) s
            where s.slot_at = p_starts_at
         )
   order by _barber_load(p_branch_id, b.id, wk.w0,     wk.w0 + 7),
            _barber_load(p_branch_id, b.id, wk.w0 - 7, wk.w0),
            random();
$function$;

-- ------------------------------------------------------------
-- 3. Horarios libres de cualquier barbero (lo que ve el cliente)
-- ------------------------------------------------------------
create or replace function public.get_available_slots_any(
  p_branch_id   uuid,
  p_date        date,
  p_service_ids uuid[]
)
returns table (slot_at timestamptz, period text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct s.slot_at, s.period
    from get_public_barbers(p_branch_id) b
   cross join lateral get_available_slots(p_branch_id, b.id, p_date, p_service_ids) s
   order by s.slot_at;
$function$;

-- ------------------------------------------------------------
-- 4. Servicio más elegido de la sucursal
-- ------------------------------------------------------------
-- Devuelve null si ninguno llega a 3 pedidos en 30 días (sin historial no
-- se muestra la etiqueta).
create or replace function public.get_popular_service(p_branch_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.service_id
    from (
      select aps.service_id, count(*) as n
        from appointment_services aps
        join appointments a on a.id = aps.appointment_id
       where a.branch_id = p_branch_id
         and a.transaction_id is null
         and a.status in ('reservado', 'llego', 'atendido')
         and a.starts_at >= now() - interval '30 days'
         and aps.service_id is not null
       group by aps.service_id
      union all
      select t.service_id, count(*)
        from transactions t
       where t.branch_id = p_branch_id
         and t.transaction_date >= (now() at time zone flowi_tz())::date - 30
         and t.service_id is not null
       group by t.service_id
    ) u
    join service_catalog sc on sc.id = u.service_id
   where sc.branch_id = p_branch_id
     and sc.is_active
     and sc.is_bookable
     and sc.duration_min is not null
   group by u.service_id, sc.name
  having sum(u.n) >= 3
   order by sum(u.n) desc, sc.name
   limit 1;
$function$;

-- ------------------------------------------------------------
-- 5. Reserva pública con tope por IP: ahora acepta barbero null
-- ------------------------------------------------------------
-- Misma firma y mismo comportamiento que en 109 cuando viene un barbero. Con
-- p_barber_id null prueba los barberos libres en orden de prioridad hasta que
-- uno la acepta: si dos clientes toman el mismo horario a la vez, el segundo
-- pasa al siguiente barbero libre en vez de fallar. Solo se reintenta ante los
-- mensajes de "horario no disponible"; cualquier otro error (nombre vacío,
-- tope de 3 turnos por teléfono, etc.) se propaga tal cual.
create or replace function public.create_appointment_public_rl(
  p_ip_hash      text,
  p_branch_id    uuid,
  p_barber_id    uuid,
  p_client_name  text,
  p_client_phone text,
  p_starts_at    timestamptz,
  p_service_ids  uuid[],
  p_client_email text default null
)
returns table(reference text, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
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
      exception when others then
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
$$;

-- ------------------------------------------------------------
-- PERMISOS
-- ------------------------------------------------------------
-- Las dos de ayuda son internas: solo las llaman otras funciones security
-- definer (que corren con el dueño), así que ningún rol necesita ejecutarlas.
-- Revoke explícito: Supabase le da su propio grant a anon/authenticated a
-- toda función nueva (ver el caveat de 068 y 109).
revoke execute on function public._barber_load(uuid, uuid, date, date)
  from public, anon, authenticated;
revoke execute on function public._barbers_free_for_slot(uuid, timestamptz, uuid[])
  from public, anon, authenticated;
grant execute on function public._barber_load(uuid, uuid, date, date) to service_role;
grant execute on function public._barbers_free_for_slot(uuid, timestamptz, uuid[]) to service_role;

-- Las dos nuevas de lectura pública, igual que get_available_slots.
revoke execute on function public.get_available_slots_any(uuid, date, uuid[]) from public;
revoke execute on function public.get_popular_service(uuid) from public;
grant execute on function public.get_available_slots_any(uuid, date, uuid[]) to anon, authenticated, service_role;
grant execute on function public.get_popular_service(uuid) to anon, authenticated, service_role;

-- create or replace conserva los permisos de 109; se repite por claridad.
revoke execute on function public.create_appointment_public_rl(text, uuid, uuid, text, text, timestamptz, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.create_appointment_public_rl(text, uuid, uuid, text, text, timestamptz, uuid[], text)
  to service_role;
