-- ============================================================
-- MEJORA 3 — CONFIGURACIÓN DE TRANSFERENCIAS POR BARBERO
-- receives_transfers = true  → el barbero recibe transferencias en
--   su cuenta (ya cobró su parte al momento del corte).
-- receives_transfers = false → las transferencias van a la cuenta de
--   Valhalla; el barbero NO cobró aún y se le paga en la liquidación.
-- Idempotente.
-- ============================================================

alter table profiles
  add column if not exists receives_transfers boolean not null default true;
