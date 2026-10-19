-- ============================================================
-- 084 — PORT de Flowi.estudio 107_avisos_de_turno_una_sola_vez.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 107 — Cada aviso automático de un turno sale una sola vez
-- ============================================================
-- Las rutas públicas /api/reservar/confirmar-email, confirmar-whatsapp y
-- cancelar-whatsapp no piden sesión: alcanza con la referencia y el
-- teléfono de un turno, que cualquiera tiene si reservó uno. Sin freno, un
-- atacante reservaba una vez y después llamaba a la ruta del mail en loop,
-- y la instalación mandaba cientos de mails (o mensajes pagos de WhatsApp)
-- desde su propio dominio. Además el destinatario y el nombre de la
-- sucursal salían del body (auditoría 2026-09-29).
--
-- Ahora las rutas leen todo de la base y "reclaman" el envío con un
-- update ... where <columna> is null: el primero que llega lo manda, los
-- demás no. Las columnas solo las escribe el service role.
-- ============================================================

alter table public.appointments
  add column if not exists confirmation_email_sent_at    timestamptz,
  add column if not exists confirmation_whatsapp_sent_at timestamptz,
  add column if not exists cancellation_whatsapp_sent_at timestamptz;
