-- ============================================================
-- TURNERO EN VIVO — la agenda se actualiza sola entre admin, barberos y reservas
--
-- 009 habilito Realtime para las tablas de finanzas, pero las del turnero quedaron afuera: lo que
-- una persona creaba, movia o cancelaba recien lo veia la otra al recargar o volver a la pestaña.
-- Se suman turnos, bloqueos y horarios semanales a la publicacion supabase_realtime.
-- RLS sigue aplicando: cada cliente recibe solo los cambios que puede leer.
--
-- replica identity full: manda la fila vieja completa en UPDATE/DELETE, para que los filtros por
-- branch_id / barber_id tambien funcionen cuando se borra o se cancela algo.
-- Idempotente.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['appointments','appointment_services','schedule_exceptions','barber_schedules'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
