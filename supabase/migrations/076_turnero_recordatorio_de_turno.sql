-- ============================================================
-- 076 — PORT de Flowi.estudio 068_whatsapp_reminder.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 068 — Marca de "ya se mandó el recordatorio" del turno
--
-- El cron de recordatorios (app/api/cron/appointment-reminders) corre
-- cada 10 minutos y busca turnos que empiezan dentro de la próxima hora.
-- Sin esta columna, cada corrida volvería a mandar el mismo recordatorio
-- 6 veces (una por cada tick dentro de esa hora).
--
-- No hace falta una columna equivalente para la CONFIRMACIÓN: esa se
-- manda una sola vez, de forma síncrona, justo al reservar -- igual que
-- el mail (confirmar-email/route.ts), que tampoco tiene esa marca.
-- ============================================================

alter table appointments
  add column if not exists reminder_sent_at timestamptz;

comment on column appointments.reminder_sent_at is
  'Cuando se mando el recordatorio de WhatsApp (1h antes). Null = todavia no. La usa el cron para no mandar el mismo recordatorio mas de una vez.';

-- Índice parcial: el cron solo busca entre los turnos reservados sin
-- recordatorio todavía, así que es la única combinación que necesita
-- estar indexada -- no tiene sentido indexar turnos ya recordados o
-- cancelados para esta consulta.
create index if not exists idx_appointments_pending_reminder
  on appointments (starts_at)
  where status = 'reservado' and reminder_sent_at is null;

-- ------------------------------------------------------------
-- RPC que usa el cron para encontrar a quién recordarle
-- ------------------------------------------------------------
-- SOLO para service_role (la ruta app/api/cron/appointment-reminders,
-- llamada con SUPABASE_SERVICE_ROLE_KEY, nunca por un cliente logueado).
-- Devuelve teléfonos de clientes.
--
-- ⚠️ El `alter default privileges ... revoke execute on functions from
-- public` de 063_fix_grant_public_rpc.sql NO ALCANZA para esto -- se
-- verificó en producción (ver 069_revocar_anon_update_branding.sql) que
-- una función nueva sigue siendo ejecutable por `anon` y `authenticated`
-- aunque ese default esté puesto. Supabase le aplica su PROPIO default
-- (grant a anon/authenticated/service_role) a toda función nueva del
-- esquema public, y el `revoke ... from public` de 063 no lo pisa. La
-- única forma que se comprobó efectiva es el `revoke` EXPLÍCITO sobre
-- ESTA función, después de crearla -- por eso está acá abajo, y no
-- alcanza con simplemente "no otorgar" el execute a esos roles.
--
-- La ventana es "empieza dentro de la próxima hora, sin recordatorio
-- todavía" y no un rango angosto tipo "entre 55 y 65 minutos": así, si el
-- cron se salta una corrida (falla de red, deploy, lo que sea), la
-- siguiente corrida igual encuentra el turno y lo recuerda, en vez de
-- perderlo para siempre por haberse salido de una ventana fija.
create or replace function public.get_appointments_due_for_reminder(p_minutes_ahead integer default 60)
returns table (
  appointment_id uuid,
  reference      text,
  starts_at      timestamptz,
  client_name    text,
  client_phone   text,
  branch_name    text,
  services       text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.id, a.reference, a.starts_at, c.full_name, c.phone, b.name,
         (select string_agg(aps.service_name, ', ' order by aps.service_name)
            from appointment_services aps
           where aps.appointment_id = a.id)
    from appointments a
    join appointment_clients c on c.id = a.client_id
    join branches b on b.id = a.branch_id
   where a.status = 'reservado'
     and a.reminder_sent_at is null
     and a.starts_at > now()
     and a.starts_at <= now() + make_interval(mins => p_minutes_ahead);
$function$;

grant execute on function public.get_appointments_due_for_reminder(integer) to service_role;
revoke execute on function public.get_appointments_due_for_reminder(integer) from anon, authenticated, public;
