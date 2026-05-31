-- ============================================================
-- PERFORMANCE — Cálculo de liquidaciones en una sola llamada server-side
-- Antes: el cliente hacía N llamadas RPC (una calculate_settlement por barbero)
-- = N round-trips de red al cerrar semana. Ahora: 1 RPC que itera los barberos
-- dentro de Postgres, en una sola transacción. Reutiliza calculate_settlement.
-- security definer + search_path fijo; ejecutable solo por authenticated.
-- ============================================================

create or replace function public.calculate_all_settlements(
  p_week_id uuid,
  p_barber_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barber uuid;
  v_count  integer := 0;
begin
  foreach v_barber in array coalesce(p_barber_ids, '{}'::uuid[]) loop
    perform calculate_settlement(p_week_id, v_barber);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.calculate_all_settlements(uuid, uuid[]) from public, anon;
grant execute on function public.calculate_all_settlements(uuid, uuid[]) to authenticated;
