-- ============================================================
-- PENDIENTE (no esta en migrations/ a proposito) — port de Flowi.estudio 105_recordatorios_con_pg_cron.sql
-- ============================================================
-- NO correr hasta que se cumplan las 4 condiciones, o los recordatorios fallan en silencio:
--   1. La app con /api/cron/appointment-reminders esta desplegada en Vercel.
--   2. CRON_SECRET existe en Vercel y es IGUAL al secreto 'cron_secret' del Vault (ver abajo).
--   3. Las variables de WhatsApp estan cargadas y las plantillas aprobadas en Meta.
--   4. Se reemplazo la URL de abajo por el dominio real de Valhalla.
-- Activa las extensiones pg_cron y pg_net (hoy NO estan instaladas en Valhalla).
-- ============================================================

-- ============================================================
-- 105 — Recordatorios de turno disparados desde Supabase (pg_cron)
-- ============================================================
-- El disparador vivía en .github/workflows/appointment-reminders.yml
-- (GitHub Actions cada 10 min). Medido el 2026-09-26: en 24 h no llegó
-- NI UNA llamada al endpoint y en toda la base había 0 recordatorios
-- enviados. En un repo privado GitHub da 2.000 min/mes y cada corrida
-- cuenta como mínimo 1 min: cada 10 min son ~4.300 corridas, el cupo se
-- agota a mitad de mes y GitHub deja de correrlo sin avisar.
--
-- Ahora la base misma llama al endpoint cada 5 minutos con pg_cron +
-- pg_net. La clave va en Supabase Vault con el nombre 'cron_secret'
-- (NO en este archivo): tiene que ser igual a CRON_SECRET en Vercel.
-- La clave se crea aparte, una vez por instancia:
--
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
--                              'cron_secret', 'Igual a CRON_SECRET en Vercel');
--
-- y se copia desde el panel de Supabase (Vault) a la variable de Vercel.
--
-- La URL es la del dominio de ESTA instancia. En otra instancia (una por
-- barbería) hay que cambiarla.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Si ya existía (re-aplicar), se reemplaza.
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
      url     := 'https://REEMPLAZAR-POR-EL-DOMINIO-DE-VALHALLA/api/cron/appointment-reminders',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 20000
    );
  $cron$
);
