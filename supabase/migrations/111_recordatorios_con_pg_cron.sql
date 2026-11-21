-- ============================================================
-- 111 — Recordatorios de turno disparados desde Supabase (pg_cron + pg_net)
-- ============================================================
-- La base llama cada 5 minutos a /api/cron/appointment-reminders con la clave del Vault
-- ('cron_secret'), que tiene que ser IGUAL a CRON_SECRET en Vercel (si no, el endpoint responde 401
-- y no se manda nada). El endpoint recuerda, una sola vez por turno, los turnos reservados desde
-- la web pública que empiezan dentro de la próxima hora.
--
-- Para apagarlo:   select cron.unschedule('recordatorios-de-turno');
-- Para ver corridas: select * from net._http_response order by created desc limit 10;
-- Reemplaza al script de supabase/pendientes (que se quitó al aplicarlo). Aplicada el 2026-11-21.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'recordatorios-de-turno') then
    perform cron.unschedule('recordatorios-de-turno');
  end if;
end $$;

select cron.schedule(
  'recordatorios-de-turno',
  '*/5 * * * *',
  $cron$
    select net.http_get(
      url     := 'https://www.salonvalhalla.com/api/cron/appointment-reminders',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 20000
    );
  $cron$
);
