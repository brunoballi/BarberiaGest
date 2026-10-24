-- ============================================================
-- 083 — PORT de Flowi.estudio 100_calendario_por_sucursal_y_horario_masivo.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: solo set_barber_week_schedule; chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- Carga masiva de horarios (solo la parte 3 de la 100 de Flowi.estudio)
-- ============================================================
-- La 100 original mezcla tres cosas. Aca se porta SOLO set_barber_week_schedule.
-- NO se porta: create_branch_admin (usa la tabla subscription, del modelo SaaS de Flowi), ni
-- el endurecimiento de create_year / delete_year_* (Valhalla tiene sus propios cuerpos: se
-- endurecen aparte), ni el backfill de calendario (Valhalla ya tiene meses y semanas).
-- Usa public._admin_can_manage_branch, que define la 065.
-- ============================================================

-- ── 3. Carga masiva de horarios ─────────────────────────────────────────
-- p_franjas: array de {start_time "HH:MM", end_time "HH:MM",
--            mode "turno"|"orden_llegada", slot_minutes int|null}
create or replace function public.set_barber_week_schedule(
  p_branch_id  uuid,
  p_barber_ids uuid[],
  p_weekdays   smallint[],
  p_franjas    jsonb,
  p_replace    boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_barber  uuid;
  v_day     smallint;
  v_f       jsonb;
  v_mode    schedule_mode;
  v_slot    int;
  v_start   time;
  v_end     time;
  v_created int := 0;
  v_deleted int := 0;
  v_n       int;
begin
  if not _admin_can_manage_branch(p_branch_id) then
    raise exception 'Sin permisos para configurar horarios de esta sucursal';
  end if;

  if coalesce(array_length(p_barber_ids, 1), 0) = 0 then
    raise exception 'Elegí al menos un barbero';
  end if;
  if coalesce(array_length(p_weekdays, 1), 0) = 0 then
    raise exception 'Elegí al menos un día';
  end if;
  if exists (select 1 from unnest(p_weekdays) d where d < 0 or d > 6) then
    raise exception 'Día de la semana inválido';
  end if;
  if jsonb_typeof(p_franjas) <> 'array' or (jsonb_array_length(p_franjas) = 0 and not p_replace) then
    raise exception 'Cargá al menos una franja';
  end if;

  -- Los barberos tienen que ser de esta sucursal: sin esto, un admin podría
  -- escribir horarios de un barbero de otra sucursal con el branch_id propio.
  if exists (
    select 1 from unnest(p_barber_ids) b
    where not exists (select 1 from profiles p where p.id = b and p.branch_id = p_branch_id)
  ) then
    raise exception 'Alguno de los barberos no pertenece a esta sucursal';
  end if;

  if p_replace then
    delete from barber_schedules
     where barber_id = any(p_barber_ids)
       and weekday = any(p_weekdays);
    get diagnostics v_deleted = row_count;
  end if;

  foreach v_barber in array p_barber_ids loop
    foreach v_day in array p_weekdays loop
      for v_f in select * from jsonb_array_elements(p_franjas) loop
        v_start := (v_f->>'start_time')::time;
        v_end   := (v_f->>'end_time')::time;
        v_mode  := (v_f->>'mode')::schedule_mode;
        v_slot  := case when v_mode = 'turno' then nullif(v_f->>'slot_minutes', '')::int else null end;

        if v_start is null or v_end is null or v_end <= v_start then
          raise exception 'Franja %–%: el fin tiene que ser posterior al inicio',
            coalesce(v_f->>'start_time', '?'), coalesce(v_f->>'end_time', '?');
        end if;
        if v_mode = 'turno' and (v_slot is null or v_slot <= 0) then
          raise exception 'Franja %–%: indicá cada cuántos minutos se reserva',
            v_f->>'start_time', v_f->>'end_time';
        end if;

        insert into barber_schedules (barber_id, branch_id, weekday, start_time, end_time, mode, slot_minutes)
        values (v_barber, p_branch_id, v_day, v_start, v_end, v_mode, v_slot);
        v_created := v_created + 1;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('created', v_created, 'deleted', v_deleted);
exception
  when exclusion_violation then
    raise exception 'Hay franjas que se superponen (entre sí o con las que ya tenía el barbero ese día). No se guardó nada.';
end;
$function$;

revoke execute on function public.set_barber_week_schedule(uuid, uuid[], smallint[], jsonb, boolean) from public, anon;
grant  execute on function public.set_barber_week_schedule(uuid, uuid[], smallint[], jsonb, boolean) to authenticated;
