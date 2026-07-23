-- 035: el reparto por tramos del "barbero nuevo" se calcula POR DÍA, no sobre el
-- total semanal (corrige 034).
--
-- Cada día se evalúa por separado contra los tramos (clásico C, básico = 2C,
-- doble = 4C) y luego se SUMAN los días:
--   día_neto = 0            -> 0
--   0 < día_neto <= básico   -> día_neto
--   básico < día_neto <= doble-> básico (2 cortes clásicos)
--   día_neto > doble          -> convencional (día_neto · comisión)
--
-- Ejemplo (clásico 15.000 -> básico 30.000, doble 60.000):
--   día 1 = 50.000  (entre básico y doble) -> 30.000
--   día 2 = 40.000  (entre básico y doble) -> 30.000
--   barbero = 60.000 ; barbería = 90.000 - 60.000 = 30.000
--
-- Solo cambia calculate_settlement (el bloque del barbero nuevo). El resto y
-- recalculate_settlement_full quedan como en 034.

create or replace function public.calculate_settlement(p_week_id uuid, p_barber_id uuid)
 returns uuid
 language plpgsql
 security definer
as $function$
declare
  v_barber                    profiles%rowtype;
  v_settlement_id             uuid;
  v_total_cuts                integer;
  v_gross_amount               numeric;
  v_barber_gross               numeric;
  v_already_collected          numeric;
  v_cash_amount                numeric;
  v_transfer_amount            numeric;
  v_card_amount                numeric;
  v_vip_amount                 numeric;
  v_vip_settled                numeric;
  v_facturado_neto             numeric;
  v_bonus_presentismo          numeric := 0;
  v_bonus_mantenimiento        numeric := 0;
  v_bonus_objetivo_pct         numeric := 0;
  v_total_earned               numeric;
  v_advances_deducted          numeric;
  v_total_deductions           numeric;
  v_net_payable                numeric;
  v_mantenimiento_auto         boolean := false;
  v_mantenimiento_met          boolean;
  v_presentismo_met            boolean;
  v_objetivo_met               boolean;
  v_box_rent                   numeric;
  v_presentismo_override       numeric;
  v_mantenimiento_override     numeric;
  v_objetivo_pct               numeric;
  v_classic                    numeric;
  v_basico                     numeric;
  v_doble                      numeric;
begin
  select * into v_barber from profiles where id = p_barber_id;
  if not found then raise exception 'Barbero % no encontrado', p_barber_id; end if;

  select presentismo_met, mantenimiento_met, box_rent,
         bonus_presentismo_override, bonus_mantenimiento_override, objetivo_pct, objetivo_met
    into v_presentismo_met, v_mantenimiento_met, v_box_rent,
         v_presentismo_override, v_mantenimiento_override, v_objetivo_pct, v_objetivo_met
  from settlements where week_id = p_week_id and barber_id = p_barber_id;
  v_box_rent := coalesce(v_box_rent, 0);

  select
    coalesce(count(*), 0),
    coalesce(sum(t.amount), 0),
    coalesce(sum(t.barber_share), 0),
    coalesce(sum(t.barber_already_collected), 0),
    coalesce(sum(case
      when coalesce(bf.full_amount_to_barber, false)
       and v_barber.compensation_type = 'percentage'
      then 0 else t.cash_amount end), 0),
    coalesce(sum(t.transfer_amount), 0),
    coalesce(sum(t.card_amount), 0),
    coalesce(sum(case
      when coalesce(bf.full_amount_to_barber, false)
       and v_barber.compensation_type = 'percentage'
      then t.barber_share else 0 end), 0),
    coalesce(sum(case
      when coalesce(bf.full_amount_to_barber, false)
       and v_barber.compensation_type = 'percentage'
      then least(t.barber_share, t.barber_already_collected) else 0 end), 0)
  into
    v_total_cuts, v_gross_amount, v_barber_gross, v_already_collected,
    v_cash_amount, v_transfer_amount, v_card_amount,
    v_vip_amount, v_vip_settled
  from transactions t
  left join benefits bf on bf.id = t.benefit_id
  where t.week_id = p_week_id and t.barber_id = p_barber_id;

  if v_total_cuts = 0 then
    delete from settlements
    where week_id = p_week_id and barber_id = p_barber_id and status = 'draft';
    return null;
  end if;

  v_facturado_neto := v_gross_amount - v_vip_amount;

  if v_barber.compensation_type = 'salary' then
    v_barber_gross := coalesce(v_barber.base_salary_rate, 0);
  elsif v_barber.compensation_type = 'box_rental' then
    declare
      v_daily_rent  numeric := coalesce(v_barber.box_rental_amount, 0);
      v_rent_paid   numeric;
      v_worked_days integer;
    begin
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

  -- Barbero nuevo (comisión %): reparto por tramos POR DÍA, sobre el facturado
  -- neto de cada día, sumando los días.
  if v_barber.compensation_type = 'percentage'
     and coalesce(v_barber.is_new_barber, false)
     and v_barber.classic_service_id is not null then
    select base_price into v_classic from service_catalog where id = v_barber.classic_service_id;
    if v_classic is not null then
      v_basico := 2 * v_classic;
      v_doble  := 2 * v_basico;
      select coalesce(sum(
        case
          when day_neto <= 0 then 0
          when day_neto <= v_basico then day_neto
          when day_neto <= v_doble then v_basico
          else round(day_neto * coalesce(v_barber.commission_rate, 0), 2)
        end
      ), 0)
      into v_barber_gross
      from (
        select t.transaction_date,
               sum(t.amount)
                 - sum(case when coalesce(bf.full_amount_to_barber, false)
                            then t.barber_share else 0 end) as day_neto
        from transactions t
        left join benefits bf on bf.id = t.benefit_id
        where t.week_id = p_week_id and t.barber_id = p_barber_id
        group by t.transaction_date
      ) d;
    end if;
  end if;

  if v_barber.compensation_type in ('salary', 'percentage') then
    v_mantenimiento_auto := v_total_cuts >= coalesce(v_barber.mantenimiento_min_cuts, 2147483647);
    v_mantenimiento_met  := coalesce(v_mantenimiento_met, v_mantenimiento_auto);
    if coalesce(v_presentismo_met, false) then
      v_bonus_presentismo := coalesce(v_presentismo_override, v_facturado_neto * coalesce(v_barber.presentismo_rate, 0));
    end if;
    if coalesce(v_mantenimiento_met, false) then
      v_bonus_mantenimiento := coalesce(v_mantenimiento_override, v_facturado_neto * coalesce(v_barber.mantenimiento_rate, 0));
    end if;
    if coalesce(v_objetivo_met, false) then
      v_bonus_objetivo_pct := round(v_facturado_neto * coalesce(v_objetivo_pct, 0), 2);
    end if;
  end if;

  select coalesce(sum(amount), 0) into v_advances_deducted
  from advances
  where barber_id = p_barber_id
    and branch_id = v_barber.branch_id
    and status IN ('pending', 'approved');

  if v_barber.compensation_type = 'box_rental' then
    v_total_earned     := v_gross_amount - v_box_rent;
    v_total_deductions := v_already_collected + v_advances_deducted;
  else
    v_total_earned     := v_barber_gross + v_bonus_presentismo + v_bonus_mantenimiento + v_bonus_objetivo_pct;
    v_total_deductions := v_already_collected + v_advances_deducted + v_box_rent;
  end if;
  v_net_payable := v_total_earned - v_total_deductions;

  insert into settlements (
    week_id, barber_id, branch_id,
    total_cuts, gross_amount, barber_gross,
    bonus_presentismo, bonus_mantenimiento, bonus_objetivo_pct, total_earned,
    already_collected, advances_deducted, total_deductions, net_payable,
    cash_amount, transfer_amount, card_amount,
    vip_amount, vip_settled,
    base_salary_rate_snap, presentismo_rate_snap, mantenimiento_rate_snap, mantenimiento_min_cuts_snap,
    mantenimiento_met, presentismo_met, box_rent, objetivo_pct, objetivo_met,
    bonus_presentismo_override, bonus_mantenimiento_override, status, updated_at
  ) values (
    p_week_id, p_barber_id, v_barber.branch_id,
    v_total_cuts, v_gross_amount, v_barber_gross,
    v_bonus_presentismo, v_bonus_mantenimiento, v_bonus_objetivo_pct, v_total_earned,
    v_already_collected, v_advances_deducted, v_total_deductions, v_net_payable,
    v_cash_amount, v_transfer_amount, v_card_amount,
    v_vip_amount, v_vip_settled,
    v_barber.base_salary_rate, v_barber.presentismo_rate,
    v_barber.mantenimiento_rate, v_barber.mantenimiento_min_cuts,
    v_mantenimiento_met, v_presentismo_met, v_box_rent, v_objetivo_pct, v_objetivo_met,
    v_presentismo_override, v_mantenimiento_override, 'draft', now()
  )
  on conflict (week_id, barber_id) do update set
    total_cuts                     = excluded.total_cuts,
    gross_amount                   = excluded.gross_amount,
    barber_gross                   = excluded.barber_gross,
    bonus_presentismo              = excluded.bonus_presentismo,
    bonus_mantenimiento            = excluded.bonus_mantenimiento,
    bonus_objetivo_pct             = excluded.bonus_objetivo_pct,
    total_earned                   = excluded.total_earned,
    already_collected              = excluded.already_collected,
    advances_deducted              = excluded.advances_deducted,
    total_deductions               = excluded.total_deductions,
    net_payable                    = excluded.net_payable,
    cash_amount                    = excluded.cash_amount,
    transfer_amount                = excluded.transfer_amount,
    card_amount                    = excluded.card_amount,
    vip_amount                     = excluded.vip_amount,
    vip_settled                    = excluded.vip_settled,
    base_salary_rate_snap          = excluded.base_salary_rate_snap,
    presentismo_rate_snap          = excluded.presentismo_rate_snap,
    mantenimiento_rate_snap        = excluded.mantenimiento_rate_snap,
    mantenimiento_min_cuts_snap    = excluded.mantenimiento_min_cuts_snap,
    mantenimiento_met              = coalesce(settlements.mantenimiento_met, excluded.mantenimiento_met),
    presentismo_met                = coalesce(settlements.presentismo_met, excluded.presentismo_met),
    box_rent                       = excluded.box_rent,
    objetivo_pct                   = settlements.objetivo_pct,
    objetivo_met                   = settlements.objetivo_met,
    bonus_presentismo_override     = settlements.bonus_presentismo_override,
    bonus_mantenimiento_override   = settlements.bonus_mantenimiento_override,
    updated_at                     = now()
  returning id into v_settlement_id;

  return v_settlement_id;
end;
$function$;

grant execute on function public.calculate_settlement(uuid, uuid) to anon, authenticated, service_role;
