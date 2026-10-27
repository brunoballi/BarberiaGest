-- 100 — Reserva pública: un bloqueo parcial bloquea, no "recorta la franja"
--
-- get_available_slots (069) leía un bloqueo parcial (start_time/end_time, closed_all_day=false)
-- como "hoy atiendo SOLO de X a Y": recortaba la franja del barbero a ese rango.
-- Pero todo lo demás lo lee como "NO se atiende de X a Y" (comida, médico,
-- "salgo antes"): la grilla de agenda lo dibuja como bloqueado y la 096 impide
-- cargar turnos a mano en ese rango. Resultado: si un barbero bloqueaba de 13 a 15,
-- la reserva pública ofrecía SOLO de 13 a 15.
--
-- Ahora la reserva pública usa la misma regla que el resto: ningún horario que
-- toque el rango bloqueado se ofrece. create_appointment_public ya valida contra
-- esta función, así que tampoco deja reservar ahí con un pedido hecho a mano.
-- Los bloqueos de día completo siguen igual.
--
-- Mismo nombre y misma firma: los permisos de 091 se conservan.

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
