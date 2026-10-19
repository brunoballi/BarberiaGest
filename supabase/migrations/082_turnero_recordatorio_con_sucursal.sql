-- ============================================================
-- 082 — PORT de Flowi.estudio 099_recordatorio_branch_id.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 099 — branch_id en get_appointments_due_for_reminder
-- ============================================================
-- El recordatorio de WhatsApp va a sumar un botón "Gestionar mi turno" que
-- linkea a /reservar/gestionar?ref=...&sucursal=... -- mismo patrón que ya
-- usa confirmar-email/route.ts y confirmar-whatsapp/route.ts para que
-- "reservar otro turno" desde ahí vuelva a la misma sucursal en vez del
-- selector. Para eso el cron necesita el branch_id, no solo el nombre.
--
-- El drop es obligatorio: create or replace no puede cambiar el
-- RETURNS TABLE de una función existente (mismo gotcha de 062/065/078).
-- ============================================================

drop function if exists public.get_appointments_due_for_reminder(integer);

create or replace function public.get_appointments_due_for_reminder(p_minutes_ahead integer default 60)
returns table (
  appointment_id uuid,
  reference      text,
  starts_at      timestamptz,
  client_name    text,
  client_phone   text,
  branch_id      uuid,
  branch_name    text,
  services       text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.id, a.reference, a.starts_at, c.full_name, c.phone, b.id, b.name,
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

-- Mismo caveat que 068: Supabase le aplica su propio grant a anon/
-- authenticated/service_role a toda función nueva del esquema public, sin
-- importar el `revoke ... from public` de 063 -- hay que revocar explícito
-- sobre ESTA función después de crearla.
grant execute on function public.get_appointments_due_for_reminder(integer) to service_role;
revoke execute on function public.get_appointments_due_for_reminder(integer) from anon, authenticated, public;
