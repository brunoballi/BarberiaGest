-- ============================================================
-- 091 — Turnero: permisos y blindaje final
-- ============================================================
-- Cierra lo que las migraciones 066-090 dejan abierto por el default de Supabase: toda funcion
-- nueva del esquema public nace con EXECUTE para anon y authenticated (comprobado en Flowi,
-- 069). Los intentos de arreglarlo con "alter default privileges" no funcionaron alli.
-- Por eso se revoca de forma EXPLICITA funcion por funcion, y se otorga a anon SOLO la
-- superficie publica de la reserva.
--
-- Esto NO es la 063 de Flowi (que hacia "revoke ... on all functions in schema public" y
-- reabria a authenticated todo el esquema): aca solo se tocan las funciones del turnero.
-- El resto de las funciones de Valhalla las trata la 065.
---- Superficie publica (anon): flowi_tz, get_public_branch, list_public_branches, get_bookable_services, get_public_barbers, get_walkin_windows, get_available_slots, get_appointment_by_reference, cancel_appointment_public, get_booking_header, get_available_slots_any, get_popular_service.
-- create_appointment_public NO es publica: desde la 085 solo la ejecuta service_role (la
-- reserva pasa por /api/reservar/crear, que aplica el tope por IP).
-- ============================================================

do $$
declare
  r record;
  v_publicas constant text[] := array['flowi_tz', 'get_public_branch', 'list_public_branches', 'get_bookable_services', 'get_public_barbers', 'get_walkin_windows', 'get_available_slots', 'get_appointment_by_reference', 'cancel_appointment_public', 'get_booking_header', 'get_available_slots_any', 'get_popular_service'];
  v_todas    constant text[] := array['_barber_load', '_barbers_free_for_slot', '_wa_status_rank', 'cancel_appointment', 'cancel_appointment_public', 'create_appointment_admin', 'create_appointment_barber', 'create_appointment_public', 'create_appointment_public_rl', 'create_barber_schedule', 'create_schedule_exception', 'create_schedule_exception_barber', 'delete_barber_schedule', 'delete_schedule_exception', 'flowi_tz', 'get_admin_agenda', 'get_appointment_by_reference', 'get_appointments_due_for_reminder', 'get_available_slots', 'get_available_slots_any', 'get_barber_agenda', 'get_bookable_services', 'get_booking_header', 'get_popular_service', 'get_public_barbers', 'get_public_branch', 'get_walkin_windows', 'link_appointment_transaction', 'list_appointment_clients', 'list_public_branches', 'move_appointment', 'record_whatsapp_status', 'register_whatsapp_message', 'set_appointment_cancelled_at', 'set_appointment_status', 'set_barber_week_schedule', 'set_branch_whatsapp_sender', 'update_branch_branding'];
begin
  -- 1. Todo lo del turnero que no es publico: fuera anon y PUBLIC.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (v_todas)
       and p.proname <> all (v_publicas)
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;

  -- 2. La superficie publica, nombrada: anon, authenticated y service_role.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (v_publicas)
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated, service_role', r.sig);
  end loop;
end $$;

-- 3. Tablas del turnero: anon no toca nada; authenticated solo lee (RLS acota por sucursal).
--    Toda escritura pasa por funciones SECURITY DEFINER.
revoke all on public.barber_schedules, public.schedule_exceptions, public.appointment_clients,
              public.appointments, public.appointment_services from anon;
revoke insert, update, delete, truncate, references, trigger on
              public.barber_schedules, public.schedule_exceptions, public.appointment_clients,
              public.appointments, public.appointment_services from authenticated;

-- 4. create_appointment_public: solo service_role (la 085 ya lo hizo; se reafirma).
revoke execute on function public.create_appointment_public(uuid, uuid, text, text, timestamptz, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.create_appointment_public(uuid, uuid, text, text, timestamptz, uuid[], text)
  to service_role;