-- 094 - Aplicada a Valhalla el 2026-10-19 (no existe en Flowi.estudio).
-- Tabla de respaldo del 2026-07-28 que habia quedado sin RLS: con la clave publica (anon) se podia
-- leer por la API. Sin politicas nadie con sesion ni anon la ve. Las otras _backup_* ya estaban asi.
alter table public._backup_20260728_transactions_descuento enable row level security;
