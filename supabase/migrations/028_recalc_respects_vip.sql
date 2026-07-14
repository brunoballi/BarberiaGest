-- 028: recalculate_settlement_full (botón "Recalcular" por fila) debe RESPETAR
-- el beneficio VIP. Antes recomputaba barber_share = amount * commission para
-- TODOS los cortes de comisión %, revirtiendo el reparto 100%/0 de los cortes
-- VIP (full_amount_to_barber) al 50/50 y haciendo que la barbería "ganara"
-- dinero de esos cortes otra vez. Ahora, en cortes VIP, barber_share = amount
-- y branch_share = 0 (idéntico a registerCut/updateCut/calculate_settlement).
-- No toca barber_already_collected (igual que antes para comisión %).
-- Aplicada en prod vía MCP el 2026-07-14; este archivo queda de registro.

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
    update transactions t
    set barber_share = sub.bshare,
        branch_share = round(t.amount - sub.bshare, 2)
    from (
      select
        tx.id,
        case
          -- Beneficio VIP: el barbero se lleva el 100%, la barbería no gana nada.
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
    -- Reparte por umbral diario en orden cronológico: los primeros $X del día
    -- van a la barbería (alquiler), el resto es del barbero.
    update transactions t
    set branch_share = sub.to_shop,
        barber_share = round(t.amount - sub.to_shop, 2),
        barber_already_collected = round(t.amount - sub.to_shop, 2)
    from (
      select id,
        greatest(0, least(amount, coalesce(v_barber.box_rental_amount, 0) - acc_before)) as to_shop
      from (
        select id, amount,
          coalesce(sum(amount) over (
            partition by transaction_date
            order by created_at, id
            rows between unbounded preceding and 1 preceding
          ), 0) as acc_before
        from transactions
        where week_id = p_week_id and barber_id = p_barber_id
      ) x
    ) sub
    where t.id = sub.id;
  end if;

  return public.calculate_settlement(p_week_id, p_barber_id);
end;
$function$;
