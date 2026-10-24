-- Revierte la 097: la FK vuelve a no tener acción (borrar una transacción con turno vinculado falla).
alter table public.appointments
  drop constraint if exists appointments_transaction_id_fkey;

alter table public.appointments
  add constraint appointments_transaction_id_fkey
  foreign key (transaction_id) references public.transactions(id);
