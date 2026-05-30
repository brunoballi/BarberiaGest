-- ============================================================
-- MEJORA 2 — SEMANAS MARTES A SÁBADO (restricción de días para barberos)
-- Los barberos solo pueden cargar cortes de martes(2) a sábado(6).
-- Domingo(0) y lunes(1) quedan bloqueados en su vista.
-- El admin puede habilitar un dom/lun puntual de una semana agregando
-- esa fecha a barber_extra_days, para los días que excepcionalmente se trabaja.
-- El admin nunca tiene este límite (carga cualquier día vía manual-cut).
-- No cambia la generación de semanas ni los rangos existentes. Idempotente.
-- ============================================================

alter table weeks
  add column if not exists barber_extra_days date[] not null default '{}';
