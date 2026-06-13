-- ============================================================
-- LIQUIDACIONES — Recálculo completo desde el ABM del barbero
-- ------------------------------------------------------------
-- Problema: calculate_settlement suma el barber_share de cada transacción,
-- pero ese barber_share se congela con la comisión vigente al momento de
-- registrar el corte. Si luego se cambia la comisión (o presentismo/objetivo)
-- en el ABM del barbero, la liquidación en borrador queda con valores viejos
-- y no hay forma de actualizarla.
--
-- recalculate_settlement_full(week, barber):
--   1. Recomputa barber_share / branch_share de CADA transacción de la semana
--      del barbero usando la comisión ACTUAL del ABM (solo 'percentage';
--      'box_rental' => barbero 100%; 'salary' no se toca el split).
--   2. Llama a calculate_settlement, que recomputa barber_gross (comisión base)
--      y los bonos de presentismo/objetivo con las tasas actuales del barbero.
--
-- Guarda: solo opera si la liquidación está en borrador (no toca confirmed/paid).
-- Misma fórmula de split que registerCut: el descuento se reparte 50/50.
-- security definer. Idempotente (create or replace).
-- ============================================================

create or replace function public.recalculate_settlement_full(p_week_id uuid, p_barber_id uuid)
 returns uuid
 language plpgsql
 security definer
as $function$
declare
  v_barber profiles%rowtype;
  v_status text;
begin
  select * into v_barber from profiles where id = p_barber_id;
  if not found then raise exception 'Barbero % no encontrado', p_barber_id; end if;

  -- No recalcular si la liquidación ya no está en borrador.
  select status into v_status
  from settlements where week_id = p_week_id and barber_id = p_barber_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'La liquidación está en estado "%"; anulala (volver a borrador) para recalcular', v_status;
  end if;

  -- 1. Recomputar el split de cada corte con la comisión actual del ABM.
  if v_barber.compensation_type = 'percentage' then
    update transactions t
    set barber_share = sub.bshare,
        branch_share = round(t.amount - sub.bshare, 2)
    from (
      select
        id,
        greatest(0, least(
          round(
            (amount + coalesce(discount_amount, 0)) * coalesce(v_barber.commission_rate, 0)
            - coalesce(discount_amount, 0) * 0.5
          , 2),
          amount
        )) as bshare
      from transactions
      where week_id = p_week_id and barber_id = p_barber_id
    ) sub
    where t.id = sub.id;
  elsif v_barber.compensation_type = 'box_rental' then
    update transactions
    set barber_share = amount, branch_share = 0
    where week_id = p_week_id and barber_id = p_barber_id;
  end if;

  -- 2. Recalcular la liquidación (comisión base + bonos con tasas actuales).
  return public.calculate_settlement(p_week_id, p_barber_id);
end;
$function$;

grant execute on function public.recalculate_settlement_full(uuid, uuid) to anon, authenticated, service_role;
