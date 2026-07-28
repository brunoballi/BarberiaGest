-- 040: recalculate_settlement_full NO debe hacer que barbero y barbería
-- "absorban" el descuento a medias. La regla correcta (confirmada por el
-- cliente) es la misma de siempre: el descuento baja el monto facturado, y
-- sobre ESE monto ya descontado se aplica el % convencional del barbero. Nadie
-- se hace cargo de una parte del descuento aparte de eso.
--
-- Bug: desde la migración 019 (recalculate_settlement_full, el RPC detrás del
-- botón "Recalcular" por fila de liquidación), la fórmula era:
--   comisión = (monto + descuento) × %  −  descuento × 50%
-- que reparte el costo del descuento mitad barbero / mitad barbería. Esto
-- SOLO estaba en recalculate_settlement_full: registerCut, updateCut y el
-- modal de edición del admin siempre usaron la fórmula simple
-- (monto_neto × %), así que un corte cargado o editado a mano siempre estuvo
-- bien. El bug solo corrompía cortes cuando el admin apretaba "Recalcular".
--
-- Fix: comisión = round(monto_neto × %, 2), clamped a [0, monto_neto]. Igual
-- que registerCut/updateCut. Sin cambios en VIP (100% al barbero) ni box_rental.

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

  select status into v_status
  from settlements where week_id = p_week_id and barber_id = p_barber_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'La liquidación está en estado "%"; anulala (volver a borrador) para recalcular', v_status;
  end if;

  if v_barber.compensation_type = 'percentage' then
    -- Cortes VIP (full_amount_to_barber): 100% al barbero, la barbería absorbe
    -- el descuento (igual que registerCut/updateCut/calculate_settlement).
    -- Cortes normales: % convencional sobre el monto YA descontado. Sin resta
    -- adicional por el descuento — nadie "absorbe" nada aparte.
    update transactions t
    set barber_share = sub.bshare,
        branch_share = round(t.amount - sub.bshare, 2)
    from (
      select
        tx.id,
        case
          when coalesce(bf.full_amount_to_barber, false) then tx.amount
          else greatest(0, least(
            round(tx.amount * coalesce(v_barber.commission_rate, 0), 2),
            tx.amount
          ))
        end as bshare
      from transactions tx
      left join benefits bf on bf.id = tx.benefit_id
      where tx.week_id = p_week_id and tx.barber_id = p_barber_id
    ) sub
    where t.id = sub.id;
  elsif v_barber.compensation_type = 'box_rental' then
    update transactions
    set barber_share = amount, branch_share = 0
    where week_id = p_week_id and barber_id = p_barber_id;
  end if;

  return public.calculate_settlement(p_week_id, p_barber_id);
end;
$function$;

grant execute on function public.recalculate_settlement_full(uuid, uuid) to anon, authenticated, service_role;
