-- 101 — Un turno no puede quedar fuera del horario de atención de la sucursal
--
-- El horario de atención (branches.business_hours, cargado en /admin/marca) hasta
-- ahora solo se mostraba. Nada impedía agendar a las 8:00 en una sucursal que
-- abre a las 9:30, ni a las 21:30 en una que cierra a las 21:00.
--
-- Ahora:
--   * _sucursal_cerrada_en(): dice si un rango [inicio, fin) cae fuera del horario
--     de la sucursal ese día (antes de abrir, después de cerrar, o día cerrado).
--   * Un trigger en appointments lo exige en TODOS los caminos que crean o mueven
--     un turno (admin, barbero, reserva pública, editar, mover). Solo se evalúa
--     cuando cambian el horario o el barbero: marcar atendido, cancelar, etc. no
--     se ven afectados, y los turnos viejos que ya estaban afuera no molestan.
--   * get_available_slots no ofrece horarios fuera de ese rango, para que la
--     reserva pública no muestre un horario que después se rechaza.
--
-- Reglas del horario:
--   * "00:00"/"00:00" en un día = cerrado ese día. Si NINGÚN día tiene horario
--     cargado (sucursal sin configurar), no se restringe nada.
--   * Cierre "00:00" (o igual/anterior a la apertura) = cierra a medianoche.

create or replace function public._sucursal_cerrada_en(
  p_branch_id uuid, p_starts timestamptz, p_ends timestamptz
) returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tz        text := 'America/Argentina/Buenos_Aires';
  v_hours     jsonb;
  v_day       jsonb;
  v_date      date;
  v_open      time;
  v_close     time;
  v_open_ts   timestamptz;
  v_close_ts  timestamptz;
begin
  select business_hours into v_hours from branches where id = p_branch_id;
  if v_hours is null or jsonb_typeof(v_hours) <> 'array' then
    return null;
  end if;

  -- Sin ningún día configurado = sucursal sin cargar el horario: no se restringe.
  if not exists (select 1 from jsonb_array_elements(v_hours) d where d->>'open' <> d->>'close') then
    return null;
  end if;

  v_date := (p_starts at time zone v_tz)::date;

  select d into v_day
    from jsonb_array_elements(v_hours) d
   where (d->>'weekday')::int = extract(dow from v_date)::int
   limit 1;

  if v_day is null or v_day->>'open' = v_day->>'close' then
    return 'La sucursal está cerrada ese día';
  end if;

  v_open  := (v_day->>'open')::time;
  v_close := (v_day->>'close')::time;
  v_open_ts  := (v_date + v_open) at time zone v_tz;
  v_close_ts := case when v_close <= v_open
                     then ((v_date + 1)::timestamp) at time zone v_tz
                     else (v_date + v_close) at time zone v_tz end;

  if p_starts < v_open_ts then
    return 'La sucursal todavía no abrió: abre a las ' || to_char(v_open, 'HH24:MI');
  end if;
  if p_ends > v_close_ts then
    return 'El turno termina después del cierre de la sucursal: cierra a las ' || to_char(v_close, 'HH24:MI');
  end if;

  return null;
end;
$function$;

revoke execute on function public._sucursal_cerrada_en(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public._sucursal_cerrada_en(uuid, timestamptz, timestamptz) to service_role;

-- ------------------------------------------------------------
-- Trigger: ningún turno nuevo o movido fuera del horario
-- ------------------------------------------------------------
create or replace function public.appointments_dentro_de_horario()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_motivo text;
begin
  if new.status = 'cancelado' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.starts_at = old.starts_at
     and new.ends_at   = old.ends_at
     and new.branch_id = old.branch_id then
    return new;
  end if;

  v_motivo := public._sucursal_cerrada_en(new.branch_id, new.starts_at, new.ends_at);
  if v_motivo is not null then
    raise exception '%', v_motivo;
  end if;
  return new;
end;
$function$;

revoke execute on function public.appointments_dentro_de_horario() from public, anon, authenticated;

drop trigger if exists appointments_dentro_de_horario on public.appointments;
create trigger appointments_dentro_de_horario
  before insert or update of starts_at, ends_at, branch_id on public.appointments
  for each row execute function public.appointments_dentro_de_horario();

-- ------------------------------------------------------------
-- Reserva pública: no se ofrecen horarios fuera del horario de atención
-- ------------------------------------------------------------
-- Mismo nombre y misma firma que en la 100: los permisos de 091 se conservan.

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
         -- Dentro del horario de atención de la sucursal (abre/cierra).
         and public._sucursal_cerrada_en(p_branch_id, v_cursor, v_slot_end) is null
         -- Bloqueo parcial (comida, médico, "salgo antes"): no se ofrece ningún
         -- horario que lo toque. Es la misma regla que _bloqueo_en_horario.
         and not exists (
           select 1 from schedule_exceptions e
            where e.branch_id = p_branch_id
              and e.exception_date = p_date
              and not e.closed_all_day
              and (e.barber_id is null or e.barber_id = p_barber_id)
              and v_cursor   < ((e.exception_date + e.end_time)   at time zone v_tz)
              and v_slot_end > ((e.exception_date + e.start_time) at time zone v_tz)
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
