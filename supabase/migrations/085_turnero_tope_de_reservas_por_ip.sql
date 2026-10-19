-- ============================================================
-- 085 — PORT de Flowi.estudio 109_limite_de_reservas_por_ip.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 109 — Tope de reservas públicas por IP y por día
-- ============================================================
-- El freno que había (3 turnos activos por teléfono) no sirve contra
-- alguien que va cambiando el número: podía llenar la agenda de turnos
-- falsos (auditoría 2026-09-29). Ahora, además, una misma conexión puede
-- sacar como mucho 20 reservas por día (hora de Argentina). Decisión de
-- Bruno: 20 queda muy por encima de un cliente o una familia — y de varios
-- clientes que comparten IP (datos móviles, el Wi-Fi del local) — y
-- chico para alguien que quiera sabotear.
--
-- Cómo:
--   · La reserva pública deja de ir directo del navegador a Supabase: pasa
--     por /api/reservar/crear, que lee la IP real (la pone Vercel, no se
--     puede falsificar desde afuera) y llama a create_appointment_public_rl
--     con el service role. A anon/authenticated se les saca el execute de
--     create_appointment_public: sin eso, el tope se salteaba llamando
--     directo a la RPC.
--   · Se guarda un hash de la IP (sha256 con sal del servidor), nunca la IP.
--   · create_appointment_public_rl bloquea la fila del contador, chequea el
--     tope, crea el turno y recién ahí suma 1, todo en la misma
--     transacción: una reserva que falla (horario tomado, datos inválidos)
--     no gasta cupo, y dos pedidos simultáneos no se pasan del tope.
--   · Las reservas que carga el admin o el barbero desde el panel usan
--     otras RPC y no tienen tope.
-- ============================================================

create table if not exists public.booking_rate_limits (
  ip_hash  text    not null,
  day      date    not null,
  bookings integer not null default 0,
  primary key (ip_hash, day)
);

-- Solo la toca el service role (vía la función de abajo).
alter table public.booking_rate_limits enable row level security;
revoke all on public.booking_rate_limits from anon, authenticated;

create or replace function public.create_appointment_public_rl(
  p_ip_hash     text,
  p_branch_id   uuid,
  p_barber_id   uuid,
  p_client_name text,
  p_client_phone text,
  p_starts_at   timestamptz,
  p_service_ids uuid[],
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

  return query
    select r.reference, r.starts_at, r.ends_at
    from create_appointment_public(
      p_branch_id, p_barber_id, p_client_name, p_client_phone,
      p_starts_at, p_service_ids, p_client_email
    ) r;

  update booking_rate_limits
  set bookings = bookings + 1
  where ip_hash = p_ip_hash and day = v_day;
end;
$$;

revoke execute on function public.create_appointment_public_rl(text, uuid, uuid, text, text, timestamptz, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.create_appointment_public_rl(text, uuid, uuid, text, text, timestamptz, uuid[], text)
  to service_role;

revoke execute on function public.create_appointment_public(uuid, uuid, text, text, timestamptz, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.create_appointment_public(uuid, uuid, text, text, timestamptz, uuid[], text)
  to service_role;
