-- ============================================================
-- 051: EL CALCULO CONGELA Y RESPETA EL MODELO DE COMPENSACION
-- ============================================================
-- Cierra el agujero que dejaron la 049 (snapshot) y la 050 (reportes):
-- calculate_settlement y recalculate_settlement_full siguen resolviendo el
-- modelo leyendo profiles, o sea el valor de HOY. Una semana vieja que todavia
-- este en borrador se recalcula con el modelo nuevo.
--
-- REGLA: la semana en curso sigue al perfil; la semana cerrada es historia.
--   * weeks.status = 'open'   -> manda profiles, y se re-congela el snapshot
--     en cada calculo (el admin todavia esta armando la semana; si cambia la
--     configuracion del barbero, se tiene que reflejar).
--   * weeks.status = 'closed' -> manda settlements.compensation_type_snap. La
--     semana ya se cerro: reinterpretarla con el modelo de hoy es el bug.
-- Si no hay snapshot (fila anterior a la 049 que nunca se recalculo) se cae al
-- perfil, que es el comportamiento actual.
--
-- Con esto, recalcular una semana vieja de Laureano la recalcula con
-- 'percentage' y reproduce los mismos numeros, en vez de convertirla a
-- alquiler de box.
--
-- ⚠️ OJO — calculate_settlement NO tiene guarda de estado (verificado con
-- pg_get_functiondef contra prod: la guarda 'status <> draft' existe SOLO en
-- recalculate_settlement_full). Su 'on conflict do update' pisa una
-- liquidacion confirmada o pagada sin avisar, y calculate_all_settlements la
-- llama para todos los barberos de la semana seleccionada. El historial de
-- julio/agosto se salvo por el flujo de trabajo, no porque algo lo impidiera.
-- Esta migracion NO agrega esa guarda a proposito: un 'raise' adentro de
-- calculate_settlement abortaria el lote entero de "Cerrar semana" cuando
-- alguna liquidacion de la semana ya este paga. Va aparte, en la 052, saltando
-- las no-draft en vez de fallar.
--
-- Cambios respecto de las definiciones vivas en prod:
--   calculate_settlement:
--     1. declara v_week_status / v_comp_snap / v_box_amt_snap / v_comm_snap
--     2. los lee junto al resto de los campos preservados de settlements
--     3. bloque nuevo "modelo efectivo" antes del agregado de transactions
--        (el agregado ya usa v_barber.compensation_type para el VIP)
--     4. persiste las tres columnas _snap en el insert y en el on conflict
--   recalculate_settlement_full:
--     1. misma resolucion del modelo efectivo
--     2. corta con un error claro si el modelo efectivo es 'percentage' y no
--        hay tasa de comision. Antes el coalesce(...,0) dejaba barber_share en
--        0 en TODOS los cortes de la semana en silencio. Es un riesgo real hoy:
--        el ABM pone commission_rate = null al pasar a box_rental, asi que
--        Laureano ya no tiene tasa en profiles y sus filas historicas tienen
--        commission_rate_snap en null (la 049 no la backfilleo a proposito).
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
  v_week_status                text;
  v_comp_snap                  compensation_type;
  v_box_amt_snap               numeric;
  v_comm_snap                  numeric;
begin
  select * into v_barber from profiles where id = p_barber_id;
  if not found then raise exception 'Barbero % no encontrado', p_barber_id; end if;

  select presentismo_met, mantenimiento_met, box_rent,
         bonus_presentismo_override, bonus_mantenimiento_override, objetivo_pct, objetivo_met,
         compensation_type_snap, box_rental_amount_snap, commission_rate_snap
    into v_presentismo_met, v_mantenimiento_met, v_box_rent,
         v_presentismo_override, v_mantenimiento_override, v_objetivo_pct, v_objetivo_met,
         v_comp_snap, v_box_amt_snap, v_comm_snap
  from settlements where week_id = p_week_id and barber_id = p_barber_id;
  v_box_rent := coalesce(v_box_rent, 0);

  -- 051 — MODELO EFECTIVO. Semana cerrada con snapshot: manda el snapshot.
  -- Semana abierta (o fila sin snapshot): manda el perfil y se re-congela.
  select w.status::text into v_week_status from weeks w where w.id = p_week_id;
  if v_week_status = 'closed' and v_comp_snap is not null then
    v_barber.compensation_type := v_comp_snap;
    v_barber.box_rental_amount := coalesce(v_box_amt_snap, v_barber.box_rental_amount);
    v_barber.commission_rate   := coalesce(v_comm_snap,    v_barber.commission_rate);
  end if;

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

  -- Split por defecto: todo es "comisión base" (barberos no nuevos).
  v_barber_comision := v_barber_gross;
  v_barber_basico   := 0;

  -- Barbero nuevo (comisión %): reparto por tramos POR DÍA, discriminando
  -- básico (días <= doble) de comisión (días > doble).
  if v_barber.compensation_type = 'percentage'
     and coalesce(v_barber.is_new_barber, false)
     and v_barber.classic_service_id is not null then
    select base_price into v_classic from service_catalog where id = v_barber.classic_service_id;
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
                 - sum(case when coalesce(bf.full_amount_to_barber, false)
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
    compensation_type_snap, box_rental_amount_snap, commission_rate_snap,
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
    v_barber.compensation_type, v_barber.box_rental_amount, v_barber.commission_rate,
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

-- ------------------------------------------------------------

create or replace function public.recalculate_settlement_full(p_week_id uuid, p_barber_id uuid)
 returns uuid
 language plpgsql
 security definer
as $function$
declare
  v_barber       profiles%rowtype;
  v_status       text;
  -- 051: resolucion del modelo de compensacion efectivo
  v_week_status  text;
  v_comp_snap    compensation_type;
  v_box_amt_snap numeric;
  v_comm_snap    numeric;
begin
  select * into v_barber from profiles where id = p_barber_id;
  if not found then raise exception 'Barbero % no encontrado', p_barber_id; end if;

  select status, compensation_type_snap, box_rental_amount_snap, commission_rate_snap
    into v_status, v_comp_snap, v_box_amt_snap, v_comm_snap
  from settlements where week_id = p_week_id and barber_id = p_barber_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'La liquidación está en estado "%"; anulala (volver a borrador) para recalcular', v_status;
  end if;

  -- 051 — MODELO EFECTIVO. Esta funcion reescribe barber_share/branch_share de
  -- TODOS los cortes de la semana: si toma el modelo de hoy para una semana ya
  -- cerrada, destruye el reparto historico de las transacciones.
  select w.status::text into v_week_status from weeks w where w.id = p_week_id;
  if v_week_status = 'closed' and v_comp_snap is not null then
    v_barber.compensation_type := v_comp_snap;
    v_barber.box_rental_amount := coalesce(v_box_amt_snap, v_barber.box_rental_amount);
    v_barber.commission_rate   := coalesce(v_comm_snap,    v_barber.commission_rate);
  end if;

  -- Sin tasa no se recalcula: el coalesce(...,0) de abajo pondria barber_share
  -- en 0 en todos los cortes de la semana sin decir nada.
  if v_barber.compensation_type = 'percentage' and v_barber.commission_rate is null then
    raise exception 'El barbero no tiene tasa de comisión cargada para esta semana; cargala en el ABM antes de recalcular';
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
