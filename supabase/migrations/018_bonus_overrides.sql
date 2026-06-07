-- ============================================================
-- OVERRIDE MANUAL DE BONOS (presentismo / objetivo)
-- El admin puede ajustar a mano el monto del bono de presentismo y objetivo.
-- Si hay override (no null) se usa ese monto en lugar del calculado por tasa;
-- el override solo aplica cuando el bono está activo (presentismo_met / objetivo_met).
-- Los overrides se preservan entre recálculos (igual que box_rent / *_met).
-- Reemplaza calculate_settlement manteniendo todas las reglas previas.
-- security definer. Idempotente.
-- ============================================================

alter table settlements add column if not exists bonus_presentismo_override numeric;
alter table settlements add column if not exists bonus_objetivo_override    numeric;

comment on column settlements.bonus_presentismo_override is
  'Monto de bono de presentismo ajustado manualmente por el admin. NULL = usar el calculado por tasa.';
comment on column settlements.bonus_objetivo_override is
  'Monto de bono de objetivo ajustado manualmente por el admin. NULL = usar el calculado por tasa.';

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

  -- Valores editables por el admin que se preservan entre recálculos
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

  -- No generar liquidaciones vacías
  if v_total_cuts = 0 then
    delete from settlements
    where week_id = p_week_id and barber_id = p_barber_id and status = 'draft';
    return null;
  end if;

  if v_barber.compensation_type = 'salary' then
    v_barber_gross := coalesce(v_barber.base_salary_rate, 0);
  elsif v_barber.compensation_type = 'box_rental' then
    -- Alquiler de box: gana el 100% y ya tiene todo el dinero.
    v_barber_gross      := v_gross_amount;
    v_already_collected := v_gross_amount;
  end if;

  -- Bonos para salary y percentage (no box_rental); % del total facturado.
  -- Si el admin cargó un override manual (no null) se usa ese monto.
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

  v_total_earned := v_barber_gross + v_bonus_presentismo + v_bonus_objetivo;

  select coalesce(sum(amount), 0) into v_advances_deducted
  from advances
  where barber_id = p_barber_id
    and branch_id = v_barber.branch_id
    and status IN ('pending', 'approved');

  -- El alquiler de box se descuenta como una deducción más (lo paga el barbero).
  v_total_deductions := v_already_collected + v_advances_deducted + v_box_rent;
  v_net_payable      := v_total_earned - v_total_deductions;

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
    box_rent                   = settlements.box_rent,
    bonus_presentismo_override = settlements.bonus_presentismo_override,
    bonus_objetivo_override    = settlements.bonus_objetivo_override,
    updated_at                 = now()
  returning id into v_settlement_id;

  return v_settlement_id;
end;
$function$;
