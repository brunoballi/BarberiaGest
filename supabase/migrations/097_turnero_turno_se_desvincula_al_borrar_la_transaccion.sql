-- 097 — Borrar una transacción vinculada a un turno ya no falla
--
-- El corte que se precarga desde la agenda del barbero queda enlazado al turno
-- (appointments.transaction_id). Con la FK sin acción, borrar esa transacción
-- (delete_transaction_admin) rebotaba por la clave foránea.
--
-- Ahora, al borrar la transacción, el turno se conserva (con su historial y los datos
-- del cliente) y solo pierde el vínculo: transaction_id pasa a NULL.

alter table public.appointments
  drop constraint if exists appointments_transaction_id_fkey;

alter table public.appointments
  add constraint appointments_transaction_id_fkey
  foreign key (transaction_id) references public.transactions(id) on delete set null;
