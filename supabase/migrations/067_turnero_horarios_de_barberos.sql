-- ============================================================
-- 067 — PORT de Flowi.estudio 055_barber_schedules.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — Fase 1: horarios de atención por barbero
-- ============================================================
-- Dos tablas:
--
--   barber_schedules    el horario semanal recurrente (lunes, martes, ...).
--   schedule_exceptions  lo que rompe el horario habitual un día puntual:
--                        feriado, vacaciones, "hoy me voy a las 18".
--
-- La franja mixta (orden de llegada vs. turno) que necesita Valhalla no es un
-- caso especial: `mode` es un atributo de CADA FRANJA, no del negocio. Un
-- barbero puede tener una franja de la mañana en 'orden_llegada' y una de la
-- tarde en 'turno', el mismo día. El caso de Valhalla queda representado con
-- dos filas, sin código extra.
-- ============================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'schedule_mode') then
    create type schedule_mode as enum ('turno', 'orden_llegada');
  end if;
end $$;

create table if not exists barber_schedules (
  id           uuid          primary key default gen_random_uuid(),
  barber_id    uuid          not null references profiles(id) on delete cascade,
  branch_id    uuid          not null references branches(id) on delete cascade,
  -- 0 = domingo .. 6 = sábado. Mismo orden que extract(dow from date).
  weekday      smallint      not null check (weekday between 0 and 6),
  start_time   time          not null,
  end_time     time          not null,
  mode         schedule_mode not null default 'turno',
  -- Granularidad de los turnos dentro de la franja. Solo tiene sentido en
  -- modo 'turno': en 'orden_llegada' no se reserva hora, así que no hay nada
  -- que trocear.
  slot_minutes integer,
  created_at   timestamptz   not null default now(),
  constraint barber_schedules_times_check check (end_time > start_time),
  constraint barber_schedules_slot_check check (
    (mode = 'turno' and slot_minutes is not null and slot_minutes > 0)
    or (mode = 'orden_llegada' and slot_minutes is null)
  )
);

-- Dos franjas del mismo barbero, mismo día, no pueden superponerse — sea cual
-- sea su modo. Se representa el horario como un rango de timestamps sobre una
-- fecha fija arbitraria: lo único que importa acá es la superposición de
-- horas del día, no una fecha real.
-- ADAPTADO: en el esquema extensions (en Flowi va en public y trae ~100 funciones ejecutables por anon).
create extension if not exists btree_gist with schema extensions;

alter table barber_schedules
  drop constraint if exists barber_schedules_sin_solape;

alter table barber_schedules
  add constraint barber_schedules_sin_solape
  exclude using gist (
    barber_id with =,
    weekday with =,
    tsrange(
      ('2000-01-03'::date + start_time)::timestamp,
      ('2000-01-03'::date + end_time)::timestamp
    ) with &&
  );

create index if not exists idx_barber_schedules_barber
  on barber_schedules(barber_id, weekday);

-- ------------------------------------------------------------
create table if not exists schedule_exceptions (
  id             uuid        primary key default gen_random_uuid(),
  branch_id      uuid        not null references branches(id) on delete cascade,
  -- null = aplica a toda la sucursal (feriado). Con barbero puntual = el día
  -- libre de una sola persona.
  barber_id      uuid        references profiles(id) on delete cascade,
  exception_date date        not null,
  -- true: no se atiende nada ese día (feriado, franco, vacaciones).
  -- false: el horario de ese día se reemplaza por start_time/end_time en vez
  -- del horario habitual (ej. "hoy me voy a las 18").
  closed_all_day boolean     not null default true,
  start_time     time,
  end_time       time,
  reason         text,
  created_at     timestamptz not null default now(),
  created_by     uuid        references auth.users(id),
  constraint schedule_exceptions_partial_needs_times check (
    closed_all_day or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index if not exists idx_schedule_exceptions_lookup
  on schedule_exceptions(branch_id, exception_date);

-- ============================================================
-- RLS
-- ============================================================
-- Lectura abierta a cualquier autenticado de la sucursal: hoy solo la usa el
-- admin, pero el barbero va a necesitar ver su propio horario en la Fase 3
-- (su agenda mobile) y no hace falta reabrir esto entonces.
--
-- Escritura: nada de policy directa a propósito. Todo pasa por las RPC de
-- abajo, que validan rol y que el admin tenga la sucursal — mismo criterio
-- que expense_categories.
alter table barber_schedules   enable row level security;
alter table schedule_exceptions enable row level security;

drop policy if exists "barber_schedules_read" on barber_schedules;
create policy "barber_schedules_read" on barber_schedules
  for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());

drop policy if exists "schedule_exceptions_read" on schedule_exceptions;
create policy "schedule_exceptions_read" on schedule_exceptions
  for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());

-- ============================================================
-- RPC — horarios
-- ============================================================
create or replace function public.create_barber_schedule(
  p_barber_id    uuid,
  p_branch_id    uuid,
  p_weekday      smallint,
  p_start_time   time,
  p_end_time     time,
  p_mode         schedule_mode,
  p_slot_minutes integer default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar horarios de esta sucursal';
  end if;

  insert into barber_schedules (barber_id, branch_id, weekday, start_time, end_time, mode, slot_minutes)
  values (p_barber_id, p_branch_id, p_weekday, p_start_time, p_end_time, p_mode, p_slot_minutes)
  returning id into v_id;

  return v_id;
exception
  -- El nombre técnico de exclusion_violation no le dice nada a un admin. Se
  -- traduce al único motivo real por el que puede pasar acá: dos franjas que
  -- se superponen.
  when exclusion_violation then
    raise exception 'Esa franja se superpone con otra que ya tiene este barbero ese día';
end;
$function$;

create or replace function public.delete_barber_schedule(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from barber_schedules where id = p_id;
  if v_branch is null then
    raise exception 'La franja no existe';
  end if;

  if (select role from profiles where id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar horarios de esta sucursal';
  end if;

  delete from barber_schedules where id = p_id;
end;
$function$;

create or replace function public.create_schedule_exception(
  p_branch_id      uuid,
  p_exception_date date,
  p_barber_id      uuid    default null,
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
  v_id uuid;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar excepciones de esta sucursal';
  end if;

  insert into schedule_exceptions (branch_id, barber_id, exception_date, closed_all_day,
                                   start_time, end_time, reason, created_by)
  values (p_branch_id, p_barber_id, p_exception_date, p_closed_all_day,
          p_start_time, p_end_time, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.delete_schedule_exception(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from schedule_exceptions where id = p_id;
  if v_branch is null then
    raise exception 'La excepción no existe';
  end if;

  if (select role from profiles where id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar excepciones de esta sucursal';
  end if;

  delete from schedule_exceptions where id = p_id;
end;
$function$;

grant execute on function public.create_barber_schedule(uuid, uuid, smallint, time, time, schedule_mode, integer) to authenticated;
grant execute on function public.delete_barber_schedule(uuid) to authenticated;
grant execute on function public.create_schedule_exception(uuid, date, uuid, boolean, time, time, text) to authenticated;
grant execute on function public.delete_schedule_exception(uuid) to authenticated;
