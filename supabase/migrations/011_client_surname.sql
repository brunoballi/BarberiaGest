-- ============================================================
-- APELLIDO DEL CLIENTE EN TRANSFERENCIAS A VALHALLA
-- Cuando la transferencia va a la cuenta de Valhalla (barbero sin
-- receives_transfers), se pide nombre + apellido del cliente para poder
-- verificar contra el home banking. Idempotente.
-- ============================================================

alter table transactions
  add column if not exists client_surname text;

comment on column transactions.client_surname is
  'Apellido del cliente. Obligatorio cuando la transferencia va a la cuenta de Valhalla (barbero sin receives_transfers), para verificacion contra home banking.';
