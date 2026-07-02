-- Box rental: liquidación automática con alquiler diario devengado.
-- - box_rent = alquiler diario × días con cortes (auto, ya no manual)
-- - already_collected = facturado - alquiler cubierto (lo que el barbero se queda)
-- - total_earned = facturado - alquiler devengado
-- - net_payable = alquiler cubierto - alquiler devengado (≤ 0 → deuda si un día no llegó)
-- Aplicada en prod (gradyndgymguehmdneyv) vía MCP el 2026-07-02.

create or replace function public.calculate_settlement(p_week_id uuid, p_barber_id uuid)
returns uuid
language plpgsql
security definer
as $function$
declare
  v_barber                profiles%rowtype;
  v_settlement_id         uuid;
  v_total_cuts            integer;
  v_gross_amount          numeric;
  v_barber_gross          numeric;
  v_already_collected     numeric;
  v_cash_amount           numeric;
  v_transfer_amount       numeric;
  v_card_amount           numeric;
  v_bonus_presentismo     numeric := 0;
  v_bonus_objetivo        numeric := 0;
  v_total_earned          numeric;
  v_advances_deducted     numeric;
  v_total_deductions      numeric;
  v_net_payable           numeric;
  v_objetivo_auto         boolean := false;
  v_objetivo_met          boolean;
  v_presentismo_met       boolean;
  v_box_rent              numeric;
  v_presentismo_override  numeric;
  v_objetivo_override     numeric;
begin
  select * into v_barber from profiles where id = p_barber_id;
  if not found then raise exception 'Barbero % no encontrado', p_barber_id; end if;

  select presentismo_met, objetivo_met, box_rent,
         bonus_presentismo_override, bonus_objetivo_override
    into v_presentismo_met, v_objetivo_met, v_box_rent,
         v_presentismo_override, v_objetivo_override
  from settlements where week_id = p_week_id and barber_id = p_barber_id;
  v_box_rent := coalesce(v_box_rent, 0);

  select
    coalesce(count(*), 0),
    coalesce(sum(amount), 0),
    coalesce(sum(barber_share), 0),
    coalesce(sum(barber_already_collected), 0),
    coalesce(sum(cash_amount), 0),
    coalesce(sum(transfer_amount), 0),
    coalesce(sum(card_amount), 0)
  into
    v_total_cuts, v_gross_amount, v_barber_gross, v_already_collected,
    v_cash_amount, v_transfer_amount, v_card_amount
  from transactions
  where week_id = p_week_id and barber_id = p_barber_id;

  if v_total_cuts = 0 then
    delete from settlements
    where week_id = p_week_id and barber_id = p_barber_id and status = 'draft';
    return null;
  end if;

  if v_barber.compensation_type = 'salary' then
    v_barber_gross := coalesce(v_barber.base_salary_rate, 0);
  elsif v_barber.compensation_type = 'box_rental' then
    declare
      v_daily_rent  numeric := coalesce(v_barber.box_rental_amount, 0);
      v_rent_paid   numeric;
      v_worked_days integer;
    begin
      -- Alquiler cubierto por día (tope: lo facturado ese día) y días trabajados
      select coalesce(sum(least(day_gross, v_daily_rent)), 0), count(*)
        into v_rent_paid, v_worked_days
      from (
        select transaction_date, sum(amount) as day_gross
        from transactions
        where week_id = p_week_id and barber_id = p_barber_id
        group by transaction_date
      ) d;
      v_barber_gross      := v_gross_amount;
      v_already_collected := v_gross_amount - v_rent_paid;
      v_box_rent          := v_daily_rent * v_worked_days;
    end;
  end if;

  if v_barber.compensation_type in ('salary', 'percentage') then
    v_objetivo_auto := v_total_cuts >= coalesce(v_barber.objetivo_min_cuts, 2147483647);
    v_objetivo_met  := coalesce(v_objetivo_met, v_objetivo_auto);
    if coalesce(v_presentismo_met, false) then
      v_bonus_presentismo := coalesce(v_presentismo_override, v_gross_amount * coalesce(v_barber.presentismo_rate, 0));
    end if;
    if coalesce(v_objetivo_met, false) then
      v_bonus_objetivo := coalesce(v_objetivo_override, v_gross_amount * coalesce(v_barber.objetivo_rate, 0));
    end if;
  end if;

  select coalesce(sum(amount), 0) into v_advances_deducted
  from advances
  where barber_id = p_barber_id
    and branch_id = v_barber.branch_id
    and status IN ('pending', 'approved');

  if v_barber.compensation_type = 'box_rental' then
    -- Total ganado = facturado - alquiler devengado; el alquiler NO se resta
    -- de nuevo en deducciones. net = alquiler cubierto - devengado (deuda si < 0).
    v_total_earned     := v_gross_amount - v_box_rent;
    v_total_deductions := v_already_collected + v_advances_deducted;
  else
    v_total_earned     := v_barber_gross + v_bonus_presentismo + v_bonus_objetivo;
    v_total_deductions := v_already_collected + v_advances_deducted + v_box_rent;
  end if;
  v_net_payable := v_total_earned - v_total_deductions;

  insert into settlements (
    week_id, barber_id, branch_id,
    total_cuts, gross_amount, barber_gross,
    bonus_presentismo, bonus_objetivo, total_earned,
    already_collected, advances_deducted, total_deductions, net_payable,
    cash_amount, transfer_amount, card_amount,
    base_salary_rate_snap, presentismo_rate_snap, objetivo_rate_snap, objetivo_min_cuts_snap,
    objetivo_met, presentismo_met, box_rent,
    bonus_presentismo_override, bonus_objetivo_override, status, updated_at
  ) values (
    p_week_id, p_barber_id, v_barber.branch_id,
    v_total_cuts, v_gross_amount, v_barber_gross,
    v_bonus_presentismo, v_bonus_objetivo, v_total_earned,
    v_already_collected, v_advances_deducted, v_total_deductions, v_net_payable,
    v_cash_amount, v_transfer_amount, v_card_amount,
    v_barber.base_salary_rate, v_barber.presentismo_rate,
    v_barber.objetivo_rate, v_barber.objetivo_min_cuts,
    v_objetivo_met, v_presentismo_met, v_box_rent,
    v_presentismo_override, v_objetivo_override, 'draft', now()
  )
  on conflict (week_id, barber_id) do update set
    total_cuts                 = excluded.total_cuts,
    gross_amount               = excluded.gross_amount,
    barber_gross               = excluded.barber_gross,
    bonus_presentismo          = excluded.bonus_presentismo,
    bonus_objetivo             = excluded.bonus_objetivo,
    total_earned               = excluded.total_earned,
    already_collected          = excluded.already_collected,
    advances_deducted          = excluded.advances_deducted,
    total_deductions           = excluded.total_deductions,
    net_payable                = excluded.net_payable,
    cash_amount                = excluded.cash_amount,
    transfer_amount            = excluded.transfer_amount,
    card_amount                = excluded.card_amount,
    base_salary_rate_snap      = excluded.base_salary_rate_snap,
    presentismo_rate_snap      = excluded.presentismo_rate_snap,
    objetivo_rate_snap         = excluded.objetivo_rate_snap,
    objetivo_min_cuts_snap     = excluded.objetivo_min_cuts_snap,
    objetivo_met               = coalesce(settlements.objetivo_met, excluded.objetivo_met),
    presentismo_met            = coalesce(settlements.presentismo_met, excluded.presentismo_met),
    box_rent                   = excluded.box_rent,
    bonus_presentismo_override = settlements.bonus_presentismo_override,
    bonus_objetivo_override    = settlements.bonus_objetivo_override,
    updated_at                 = now()
  returning id into v_settlement_id;

  return v_settlement_id;
end;
$function$;

-- Recalcular también debe respetar el split diario por umbral (antes pisaba
-- todo con barber_share = amount / branch_share = 0).
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
