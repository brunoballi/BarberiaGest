-- ============================================================
-- 057: CONGELAR TAMBIEN LAS TASAS DE BONOS Y EL SUELDO BASE
-- ============================================================
-- Ultimo hueco del bloque que arrancó en la 049. `settlements` ya guardaba
-- base_salary_rate_snap, presentismo_rate_snap, mantenimiento_rate_snap y
-- mantenimiento_min_cuts_snap desde el esquema original, pero esas columnas se
-- ESCRIBIAN y no se leian nunca: quedaron como registro de auditoria, no como
-- snapshot funcional. calculate_settlement seguia calculando los bonos y el
-- sueldo con v_barber.* — o sea, el perfil de HOY.
--
-- Consecuencia: si el cliente cambia el porcentaje de presentismo o de
-- mantenimiento, una semana vieja EN BORRADOR que se recalcule recalcula ese
-- bono con la tasa nueva. Las confirmadas y pagadas ya estaban a salvo por la
-- 052, que hace que el recalculo masivo las saltee.
--
-- ESTADO ACTUAL: sin daño. Ninguna de las tasas guardadas difiere hoy del
-- perfil, o sea que todavia no se cambio ninguna. Preventiva, como la 056.
--
-- Fix: en una semana historica (misma regla de la 055 — cerrada o terminada
-- antes de hoy en hora de Argentina) mandan las tasas congeladas. En la semana
-- en curso sigue mandando el perfil y se re-congela, que es el comportamiento
-- que el cliente espera al editar la configuracion de un barbero.
--
-- De paso, la condicion del bloque pasa de `v_week_congelada and v_comp_snap is
-- not null` a `v_week_congelada` a secas, con coalesce en cada asignacion: es
-- equivalente para compensation_type y ademas deja que las tasas se congelen
-- aunque una fila vieja no tenga compensation_type_snap.
--
-- recalculate_settlement_full no se toca: no usa tasas de bonos, solo
-- commission_rate, que ya venia congelada desde la 051.
--
-- LIMITE CONOCIDO: si una tasa estaba en NULL cuando se calculo la liquidacion
-- y hoy tiene valor, el coalesce cae al valor de hoy. No hay forma de
-- distinguir "no tenia tasa" de "no se guardo" sin una columna extra, y el caso
-- es marginal.
-- ============================================================

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
  v_barber_comision            numeric := 0;
  v_barber_basico              numeric := 0;
  v_comision_facturado         numeric := 0;
  v_basico_dias                integer := 0;
  v_comision_dias              integer := 0;
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
  -- 051: resolucion del modelo de compensacion efectivo
  v_week_congelada             boolean;
  v_comp_snap                  compensation_type;
  v_box_amt_snap               numeric;
  v_comm_snap                  numeric;
  v_classic_snap               numeric;
  -- 057: tasas de bonos y sueldo base congelados
  v_salary_snap                numeric;
  v_pres_snap                  numeric;
  v_mant_snap                  numeric;
  v_mant_min_snap              integer;
begin
  select * into v_barber from profiles where id = p_barber_id;
  if not found then raise exception 'Barbero % no encontrado', p_barber_id; end if;

  select presentismo_met, mantenimiento_met, box_rent,
         bonus_presentismo_override, bonus_mantenimiento_override, objetivo_pct, objetivo_met,
         compensation_type_snap, box_rental_amount_snap, commission_rate_snap, classic_price_snap,
         base_salary_rate_snap, presentismo_rate_snap, mantenimiento_rate_snap, mantenimiento_min_cuts_snap
    into v_presentismo_met, v_mantenimiento_met, v_box_rent,
         v_presentismo_override, v_mantenimiento_override, v_objetivo_pct, v_objetivo_met,
         v_comp_snap, v_box_amt_snap, v_comm_snap, v_classic_snap,
         v_salary_snap, v_pres_snap, v_mant_snap, v_mant_min_snap
  from settlements where week_id = p_week_id and barber_id = p_barber_id;
  v_box_rent := coalesce(v_box_rent, 0);

  -- 051 — MODELO EFECTIVO. Semana historica con snapshot: manda el snapshot.
  -- Semana en curso (o fila sin snapshot): manda el perfil y se re-congela.
  -- 055: la semana ya es historia? Cerrada, o terminada antes de hoy (hora de
  -- Argentina). Una semana vieja que quedo ABIERTA tambien es pasado: mirar
  -- solo el status la dejaba siguiendo al catalogo/perfil de hoy.
  select (w.status::text = 'closed'
          or w.end_date < (now() at time zone 'America/Argentina/Buenos_Aires')::date)
    into v_week_congelada
  from weeks w where w.id = p_week_id;
  if v_week_congelada then
    v_barber.compensation_type := coalesce(v_comp_snap, v_barber.compensation_type);
    v_barber.box_rental_amount := coalesce(v_box_amt_snap, v_barber.box_rental_amount);
    v_barber.commission_rate   := coalesce(v_comm_snap,    v_barber.commission_rate);
    -- 057: las tasas de bonos y el sueldo base tambien son configuracion que el
    -- cliente edita, asi que en una semana historica mandan las congeladas.
    v_barber.base_salary_rate       := coalesce(v_salary_snap,   v_barber.base_salary_rate);
    v_barber.presentismo_rate       := coalesce(v_pres_snap,     v_barber.presentismo_rate);
    v_barber.mantenimiento_rate     := coalesce(v_mant_snap,     v_barber.mantenimiento_rate);
    v_barber.mantenimiento_min_cuts := coalesce(v_mant_min_snap, v_barber.mantenimiento_min_cuts);
  end if;

  select
    coalesce(count(*), 0),
    coalesce(sum(t.amount), 0),
    coalesce(sum(t.barber_share), 0),
    coalesce(sum(t.barber_already_collected), 0),
    coalesce(sum(case
      when coalesce(t.benefit_full_amount_snap, bf.full_amount_to_barber, false)
       and v_barber.compensation_type = 'percentage'
      then 0 else t.cash_amount end), 0),
    coalesce(sum(t.transfer_amount), 0),
    coalesce(sum(t.card_amount), 0),
    coalesce(sum(case
      when coalesce(t.benefit_full_amount_snap, bf.full_amount_to_barber, false)
       and v_barber.compensation_type = 'percentage'
      then t.barber_share else 0 end), 0),
    coalesce(sum(case
      when coalesce(t.benefit_full_amount_snap, bf.full_amount_to_barber, false)
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

  -- Split por defecto: todo es "comisión base" (barberos no nuevos).
  v_barber_comision := v_barber_gross;
  v_barber_basico   := 0;

  -- Barbero nuevo (comisión %): reparto por tramos POR DÍA, discriminando
  -- básico (días <= doble) de comisión (días > doble).
  if v_barber.compensation_type = 'percentage'
     and coalesce(v_barber.is_new_barber, false)
     and v_barber.classic_service_id is not null then
    select base_price into v_classic from service_catalog where id = v_barber.classic_service_id;
    -- 053 — PRECIO EFECTIVO DEL CLASICO. Semana historica: manda el congelado.
    -- Semana en curso: manda el catalogo y se re-congela mas abajo.
    if v_week_congelada and v_classic_snap is not null then
      v_classic := v_classic_snap;
    end if;
    if v_classic is not null then
      v_basico := 2 * v_classic;
      v_doble  := 2 * v_basico;
      select
        coalesce(sum(case when day_neto > 0 and day_neto <= v_doble
                          then (case when day_neto <= v_basico then day_neto else v_basico end)
                          else 0 end), 0),
        coalesce(sum(case when day_neto > v_doble
                          then round(day_neto * coalesce(v_barber.commission_rate, 0), 2)
                          else 0 end), 0),
        coalesce(sum(case when day_neto > v_doble then day_neto else 0 end), 0),
        coalesce(count(*) filter (where day_neto > 0 and day_neto <= v_doble), 0),
        coalesce(count(*) filter (where day_neto > v_doble), 0)
      into v_barber_basico, v_barber_comision, v_comision_facturado, v_basico_dias, v_comision_dias
      from (
        select t.transaction_date,
               sum(t.amount)
                 - sum(case when coalesce(t.benefit_full_amount_snap, bf.full_amount_to_barber, false)
                            then t.barber_share else 0 end) as day_neto
        from transactions t
        left join benefits bf on bf.id = t.benefit_id
        where t.week_id = p_week_id and t.barber_id = p_barber_id
        group by t.transaction_date
      ) d;
      -- Beneficio VIP: el barbero nuevo se lleva ADEMÁS el 100% del VIP (igual
      -- que el barbero % común, donde el VIP viaja dentro de barber_share). El
      -- tramo se calcula sobre el neto (sin VIP), así que acá se suma aparte.
      v_barber_comision := v_barber_comision + v_vip_amount;
      v_barber_gross    := v_barber_basico + v_barber_comision;
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
    barber_comision, barber_basico, barber_basico_dias, barber_comision_dias, barber_comision_facturado,
    bonus_presentismo, bonus_mantenimiento, bonus_objetivo_pct, total_earned,
    already_collected, advances_deducted, total_deductions, net_payable,
    cash_amount, transfer_amount, card_amount,
    vip_amount, vip_settled,
    base_salary_rate_snap, presentismo_rate_snap, mantenimiento_rate_snap, mantenimiento_min_cuts_snap,
    compensation_type_snap, box_rental_amount_snap, commission_rate_snap, classic_price_snap,
    mantenimiento_met, presentismo_met, box_rent, objetivo_pct, objetivo_met,
    bonus_presentismo_override, bonus_mantenimiento_override, status, updated_at
  ) values (
    p_week_id, p_barber_id, v_barber.branch_id,
    v_total_cuts, v_gross_amount, v_barber_gross,
    v_barber_comision, v_barber_basico, v_basico_dias, v_comision_dias, v_comision_facturado,
    v_bonus_presentismo, v_bonus_mantenimiento, v_bonus_objetivo_pct, v_total_earned,
    v_already_collected, v_advances_deducted, v_total_deductions, v_net_payable,
    v_cash_amount, v_transfer_amount, v_card_amount,
    v_vip_amount, v_vip_settled,
    v_barber.base_salary_rate, v_barber.presentismo_rate,
    v_barber.mantenimiento_rate, v_barber.mantenimiento_min_cuts,
    v_barber.compensation_type, v_barber.box_rental_amount, v_barber.commission_rate, v_classic,
    v_mantenimiento_met, v_presentismo_met, v_box_rent, v_objetivo_pct, v_objetivo_met,
    v_presentismo_override, v_mantenimiento_override, 'draft', now()
  )
  on conflict (week_id, barber_id) do update set
    total_cuts                     = excluded.total_cuts,
    gross_amount                   = excluded.gross_amount,
    barber_gross                   = excluded.barber_gross,
    barber_comision                = excluded.barber_comision,
    barber_basico                  = excluded.barber_basico,
    barber_basico_dias             = excluded.barber_basico_dias,
    barber_comision_dias           = excluded.barber_comision_dias,
    barber_comision_facturado      = excluded.barber_comision_facturado,
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
    compensation_type_snap         = excluded.compensation_type_snap,
    box_rental_amount_snap         = excluded.box_rental_amount_snap,
    commission_rate_snap           = excluded.commission_rate_snap,
    classic_price_snap             = coalesce(excluded.classic_price_snap, settlements.classic_price_snap),
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
