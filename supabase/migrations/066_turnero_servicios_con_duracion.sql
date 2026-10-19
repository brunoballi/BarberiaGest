-- ============================================================
-- 066 — PORT de Flowi.estudio 054_service_scheduling_fields.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- TURNERO — Fase 1: campos que le faltan a service_catalog
-- ============================================================
-- El catálogo hoy solo tiene nombre y precio, porque hasta ahora nadie
-- necesitaba saber cuánto tarda un servicio. El turnero sí: la duración es
-- lo que define los huecos de la agenda, no es un dato decorativo.
-- ============================================================

alter table public.service_catalog
  add column if not exists duration_min integer,
  add column if not exists description  text,
  add column if not exists image_url    text,
  -- Un servicio puede seguir existiendo para cargarlo a mano en el gestor sin
  -- ofrecerse en la reserva pública (ej. "Retoque", que no se agenda solo).
  -- ADAPTADO A VALHALLA: en Flowi.estudio el default es TRUE porque la tabla estaba vacia al
  -- crear la columna. Aca ya hay servicios cargados sin duracion, y el alta de servicios de la
  -- app actual tampoco manda duracion: con default TRUE el CHECK de abajo rechazaria a los
  -- existentes y haria fallar cada alta nueva. Default FALSE = ningun servicio se ofrece en
  -- la reserva publica hasta que el admin le cargue la duracion y lo habilite.
  add column if not exists is_bookable  boolean not null default false;

-- No se puede reservar un servicio sin saber cuánto dura, pero sí puede
-- seguir existiendo un servicio viejo con duration_min en null: por eso el
-- check exige la duración solo cuando is_bookable es true, en vez de hacer la
-- columna NOT NULL a secas (eso habría roto todo servicio ya cargado).
alter table public.service_catalog
  drop constraint if exists service_catalog_duration_check;

alter table public.service_catalog
  add constraint service_catalog_duration_check
  check (not is_bookable or (duration_min is not null and duration_min > 0));
