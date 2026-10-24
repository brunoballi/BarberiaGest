-- ============================================================
-- 068 — PORT de Flowi.estudio 056_appointments.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — Fase 1: turnos
-- ============================================================
-- Tres tablas:
--
--   appointment_clients   los clientes que reservan. NO son usuarios del
--                         sistema — no tienen fila en profiles ni login.
--                         Se identifican por teléfono dentro de la sucursal.
--   appointments          el turno en sí.
--   appointment_services  los servicios de ese turno, con precio, nombre y
--                         duración CONGELADOS al momento de reservar. Si la
--                         barbería sube los precios después, el turno ya
--                         tomado conserva lo que se le cotizó al cliente.
--
-- La garantía más importante de este archivo es que DOS TURNOS DEL MISMO
-- BARBERO NO PUEDEN SUPERPONERSE, y esa garantía vive en la base, no en el
-- código. Comprobar "¿está libre?" y recién después insertar no alcanza:
-- entre esas dos operaciones puede colarse otra reserva. La restricción de
-- exclusión lo hace imposible aunque la aplicación tenga un bug.
-- ============================================================

-- ADAPTADO: en el esquema extensions (ver 067).
create extension if not exists btree_gist with schema extensions;

-- ------------------------------------------------------------
create table if not exists appointment_clients (
  id         uuid        primary key default gen_random_uuid(),
  branch_id  uuid        not null references branches(id) on delete cascade,
  full_name  text        not null,
  phone      text        not null,
  email      text,
  created_at timestamptz not null default now(),
  constraint appointment_clients_branch_phone_unique unique (branch_id, phone),
  constraint appointment_clients_name_not_blank check (btrim(full_name) <> ''),
  constraint appointment_clients_phone_not_blank check (btrim(phone) <> '')
);

-- ------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'appointment_status') then
    create type appointment_status as enum
      ('reservado', 'llego', 'atendido', 'no_vino', 'cancelado');
  end if;
  if not exists (select 1 from pg_type where typname = 'appointment_source') then
    create type appointment_source as enum ('publico', 'admin', 'barbero');
  end if;
end $$;

create table if not exists appointments (
  id             uuid                primary key default gen_random_uuid(),
  branch_id      uuid                not null references branches(id) on delete cascade,
  barber_id      uuid                not null references profiles(id),
  client_id      uuid                not null references appointment_clients(id),
  starts_at      timestamptz         not null,
  ends_at        timestamptz         not null,
  status         appointment_status  not null default 'reservado',
  source         appointment_source  not null default 'admin',
  -- Código corto para que el cliente lo mencione por WhatsApp o teléfono,
  -- igual que el "XqhgBrVEU" de la referencia de mercado.
  reference      text                not null unique,
  notes          text,
  -- El puente con el gestor (ver docs/turnero_plan.md sección 5). Se llena
  -- SOLO cuando el barbero confirma la precarga del corte — nunca automático.
  -- Esa lógica es de la Fase 3; la columna se crea ahora para no tener que
  -- alterar la tabla después.
  transaction_id uuid                references transactions(id),
  created_at     timestamptz         not null default now(),
  created_by     uuid                references auth.users(id),
  constraint appointments_dates_check check (ends_at > starts_at)
);

-- La garantía central de todo el turnero.
alter table appointments
  drop constraint if exists appointments_sin_solape;

alter table appointments
  add constraint appointments_sin_solape
  exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelado', 'no_vino'));

create index if not exists idx_appointments_branch_date
  on appointments(branch_id, starts_at);
create index if not exists idx_appointments_client
  on appointments(client_id);

-- ------------------------------------------------------------
create table if not exists appointment_services (
  id            uuid          primary key default gen_random_uuid(),
  appointment_id uuid         not null references appointments(id) on delete cascade,
  service_id    uuid          not null references service_catalog(id),
  -- Congelados al reservar. Ver el comentario de arriba.
  service_name  text          not null,
  price         numeric(12,2) not null,
  duration_min  integer       not null check (duration_min > 0),
  created_at    timestamptz   not null default now()
);

create index if not exists idx_appointment_services_appt
  on appointment_services(appointment_id);

-- ============================================================
-- RLS
-- ============================================================
-- Mismo criterio que barber_schedules: lectura abierta a la sucursal (hoy
-- solo la usa el admin; el barbero la va a necesitar en la Fase 3 para ver su
-- propia agenda, sin tener que reabrir nada). Toda escritura por RPC.
alter table appointment_clients  enable row level security;
alter table appointments         enable row level security;
alter table appointment_services enable row level security;

drop policy if exists "appointment_clients_read" on appointment_clients;
create policy "appointment_clients_read" on appointment_clients
  for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());

drop policy if exists "appointments_read" on appointments;
create policy "appointments_read" on appointments
  for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());

-- appointment_services no tiene branch_id propio: se resuelve a través del
-- turno al que pertenece.
drop policy if exists "appointment_services_read" on appointment_services;
create policy "appointment_services_read" on appointment_services
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
       where a.id = appointment_services.appointment_id
         and (current_admin_has_branch(a.branch_id) or a.branch_id = current_user_branch())
    )
  );

-- ============================================================
-- RPC
-- ============================================================

-- Agenda de un día, para todos los barberos de la sucursal. Es lo que
-- alimenta la pantalla de turnos del admin.
create or replace function public.get_admin_agenda(p_branch_id uuid, p_date date)
returns table (
  id           uuid,
  barber_id    uuid,
  barber_name  text,
  client_name  text,
  client_phone text,
  starts_at    timestamptz,
  ends_at      timestamptz,
  status       appointment_status,
  source       appointment_source,
  reference    text,
  notes        text,
  total_price  numeric,
  services     jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin acceso a esta sucursal';
  end if;

  return query
    select
      a.id, a.barber_id, p.full_name, c.full_name, c.phone,
      a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes,
      coalesce(sum(s.price), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'service_id', s.service_id,
        'name', s.service_name,
        'price', s.price,
        'duration_min', s.duration_min
      ) order by s.created_at), '[]'::jsonb)
    from appointments a
    join profiles p            on p.id = a.barber_id
    join appointment_clients c on c.id = a.client_id
    left join appointment_services s on s.appointment_id = a.id
   where a.branch_id = p_branch_id
     -- América/Argentina, no la zona horaria de la sesión: un turno de las
     -- 23:30 no se puede correr al día siguiente por un desfasaje de reloj.
     and (a.starts_at at time zone 'America/Argentina/Buenos_Aires')::date = p_date
   group by a.id, a.barber_id, p.full_name, c.full_name, c.phone,
            a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes
   order by a.starts_at;
end;
$function$;

-- Crea el turno a mano. Da de alta o reutiliza al cliente por teléfono,
-- congela precio/nombre/duración de cada servicio elegido, y genera el
-- código de referencia con reintento por si chocara (es astronómicamente
-- improbable, pero cuesta nada cubrirlo).
create or replace function public.create_appointment_admin(
  p_branch_id    uuid,
  p_barber_id    uuid,
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

  -- Todos los servicios pedidos tienen que existir, ser de esta sucursal y
  -- tener duración cargada. Si el count no coincide con lo pedido, alguno no
  -- pasó el filtro — mejor cortar acá que agendar con menos de lo elegido.
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

  -- Alta o reutilización del cliente por teléfono. El nombre se actualiza al
  -- último dato que trajo (pudo cambiar); el email solo se pisa si vino uno
  -- nuevo, para no borrar uno que ya estaba cargado.
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

-- Mueve un turno de horario y/o de barbero. La duración total se recalcula
-- desde los servicios ya cargados: no hace falta volver a mandarlos.
create or replace function public.move_appointment(
  p_appointment_id uuid,
  p_new_starts_at  timestamptz,
  p_new_barber_id  uuid default null
)
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

create or replace function public.cancel_appointment(p_appointment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from appointments where id = p_appointment_id;
  if v_branch is null then
    raise exception 'El turno no existe';
  end if;
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;

  update appointments
     set status = 'cancelado',
         notes  = case when p_reason is not null and btrim(p_reason) <> ''
                        then coalesce(notes || ' — ', '') || 'Cancelado: ' || p_reason
                        else notes end
   where id = p_appointment_id;
end;
$function$;

-- Cambia el estado operativo del turno (llegó / atendido / no vino).
-- Admin-only por ahora: el barbero todavía no tiene pantalla propia (Fase 3).
-- Cuando la tenga, esta misma función es la que se va a extender para
-- aceptar también al barbero dueño del turno — no hace falta reescribirla.
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
  v_branch uuid;
begin
  if p_status = 'reservado' then
    raise exception 'No se puede volver un turno a "reservado" manualmente';
  end if;

  select branch_id into v_branch from appointments where id = p_appointment_id;
  if v_branch is null then
    raise exception 'El turno no existe';
  end if;
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(v_branch) or v_branch = current_user_branch(), false) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;

  update appointments set status = p_status where id = p_appointment_id;
end;
$function$;

grant execute on function public.get_admin_agenda(uuid, date) to authenticated;
grant execute on function public.create_appointment_admin(uuid, uuid, text, text, timestamptz, uuid[], text, text) to authenticated;
grant execute on function public.move_appointment(uuid, timestamptz, uuid) to authenticated;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;
grant execute on function public.set_appointment_status(uuid, appointment_status) to authenticated;
