-- ============================================================
-- REALTIME — Habilitar tablas en la publicación supabase_realtime
-- La publicación existía pero SIN tablas: las suscripciones (transactions)
-- nunca recibían eventos. Aquí agregamos las tablas que las vistas observan
-- para sincronizar en vivo entre dispositivos. RLS sigue aplicando a Realtime
-- (cada cliente solo recibe los cambios que está autorizado a ver).
--
-- replica identity full: incluye la fila vieja completa en UPDATE/DELETE, para
-- que los filtros por week_id/branch_id también funcionen en borrados.
-- Idempotente.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['transactions','settlements','expenses','weeks','months','profiles'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
