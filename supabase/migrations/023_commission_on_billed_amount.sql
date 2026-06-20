-- ============================================================
-- COMISIÓN SOBRE EL MONTO FACTURADO (sin penalizar el descuento)
-- ------------------------------------------------------------
-- Antes: barber_share = (amount + descuento) * % − descuento * 0.5
--   → el barbero absorbía la mitad de cada descuento, por lo que la
--     comisión base no daba el % exacto sobre lo facturado.
-- Ahora: barber_share = amount * %  (amount ya es el monto cobrado, con el
--   descuento aplicado). El descuento queda repartido en proporción al split
--   (cada parte su % del monto cobrado). Ej: 40% de $326.000 = $130.400.
--
-- Idempotente. Solo cambia la fórmula del modelo 'percentage'.
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

  -- 1. Recomputar el split de cada corte: comisión = % sobre el monto cobrado.
  if v_barber.compensation_type = 'percentage' then
    update transactions t
    set barber_share = sub.bshare,
        branch_share = round(t.amount - sub.bshare, 2)
    from (
      select
        id,
        greatest(0, least(
          round(amount * coalesce(v_barber.commission_rate, 0), 2),
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
