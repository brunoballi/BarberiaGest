-- ============================================================
-- ELIMINAR TRANSACCIONES (solo admin)
-- Borra una transacción y, si existe una liquidación en BORRADOR para
-- ese barbero/semana, la recalcula. Las liquidaciones confirmed/paid no
-- se tocan (el admin debe anularlas primero).
-- security definer + search_path fijo; ejecutable solo por authenticated.
-- Idempotente.
-- ============================================================

create or replace function public.delete_transaction_admin(p_tx_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week   uuid;
  v_barber uuid;
  v_status settlement_status;
begin
  if (select auth_role()) <> 'admin' then
    raise exception 'Solo administradores pueden eliminar transacciones';
  end if;

  select week_id, barber_id into v_week, v_barber
  from transactions where id = p_tx_id;
  if not found then
    raise exception 'Transacción % no encontrada', p_tx_id;
  end if;

  delete from transactions where id = p_tx_id;

  select status into v_status
  from settlements where week_id = v_week and barber_id = v_barber;
  if found and v_status = 'draft' then
    perform calculate_settlement(v_week, v_barber);
  end if;
end;
$$;

revoke all on function public.delete_transaction_admin(uuid) from public, anon;
grant execute on function public.delete_transaction_admin(uuid) to authenticated;
