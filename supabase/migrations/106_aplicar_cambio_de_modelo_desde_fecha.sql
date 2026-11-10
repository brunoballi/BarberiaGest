-- ============================================================
-- 106: APLICAR UN CAMBIO DE MODELO DE COMPENSACION DESDE UNA FECHA
-- ============================================================
-- Problema: al pasar un barbero de comision a alquiler de box (o al reves) el
-- ABM solo guarda el perfil. Eso alcanza para los cortes que se carguen de ahi
-- en adelante, pero NO para lo ya trabajado:
--   * los cortes ya cargados conservan el reparto (barber_share / branch_share /
--     barber_already_collected) del modelo viejo, y
--   * una semana que ya termino (aunque siga abierta) es historia desde la 055:
--     la liquidacion manda con el modelo congelado, no con el perfil.
-- Resultado real (Leandro Fernandez, Junin, noviembre 2026): cambiaron su perfil a
-- alquiler de box pero su semana 02/11-08/11 siguio como comision.
--
-- Esta funcion es la forma explicita de decir "el modelo nuevo rige desde tal
-- fecha". Para cada semana de la sucursal del barbero que termine en o despues
-- de p_desde y en la que el barbero tenga cortes:
--   * si la liquidacion esta confirmada o pagada -> NO se toca (se cuenta como
--     saltada; para tocarla hay que anularla a borrador primero),
--   * si esta en borrador (o todavia no existe) -> se re-congela el snapshot de
--     compensacion con el perfil de HOY, se re-reparten los cortes con la misma
--     regla que usa registerCut y se recalcula la liquidacion.
-- Los cortes marcados is_manual_override SI se re-reparten: esa marca la pone
-- cualquier edicion de un corte (fullEditTransaction), no solo un ajuste
-- deliberado, y la app ya pisa su reparto al editar (resyncBoxRentalDaySplits).
--
-- La unidad es la SEMANA: una semana tiene un solo modelo. Si p_desde cae a
-- mitad de semana, esa semana completa pasa al modelo nuevo.
-- p_desde no puede ser futura: el perfil ya rige desde que se guarda.
--
-- Reparto por corte (igual que registerCut):
--   box_rental : los primeros box_rental_amount del dia (por orden de carga) van
--                a la barberia; el resto es del barbero. already_collected =
--                lo del barbero.
--   percentage : % sobre el monto; VIP (benefit_full_amount) 100% al barbero y
--                ya cobrado = efectivo + transferencia.
--   salary     : igual que percentage pero sin VIP (cae en la tasa por defecto
--                0.5 si no hay tasa, como registerCut).
--   already_collected fuera de box/VIP: la transferencia solo si receives_transfers.
-- ============================================================

create or replace function public.aplicar_cambio_de_modelo(p_barber_id uuid, p_desde date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_barber       profiles%rowtype;
  v_week         record;
  v_status       text;
  v_rate         numeric;
  v_recalc       integer := 0;
  v_saltadas     integer := 0;
  v_primera      date;
  v_hoy          date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  select * into v_barber from profiles where id = p_barber_id;
  if not found then raise exception 'Barbero % no encontrado', p_barber_id; end if;

  if auth.uid() is not null
     and not public._admin_can_manage_branch(v_barber.branch_id) then
    raise exception 'Sin permisos sobre esta sucursal';
  end if;

  if p_desde is null then raise exception 'Falta la fecha desde la que rige el cambio'; end if;
  if p_desde > v_hoy then
    raise exception 'La fecha no puede ser futura: el cambio ya rige desde que se guarda el perfil';
  end if;

  if v_barber.compensation_type = 'percentage' and v_barber.commission_rate is null then
    raise exception 'El barbero no tiene tasa de comisión cargada; cargala en el ABM antes de aplicar el cambio';
  end if;
  if v_barber.compensation_type = 'box_rental' and coalesce(v_barber.box_rental_amount, 0) <= 0 then
    raise exception 'El barbero no tiene monto de alquiler de box cargado; cargalo en el ABM antes de aplicar el cambio';
  end if;

  v_rate := coalesce(v_barber.commission_rate, 0.5);

  for v_week in
    select w.id, w.start_date
    from weeks w
    where w.branch_id = v_barber.branch_id
      and w.end_date >= p_desde
      and exists (select 1 from transactions t where t.week_id = w.id and t.barber_id = p_barber_id)
    order by w.start_date
  loop
    select s.status into v_status
    from settlements s where s.week_id = v_week.id and s.barber_id = p_barber_id;

    if v_status is not null and v_status <> 'draft' then
      v_saltadas := v_saltadas + 1;
      continue;
    end if;

    -- Re-congela el modelo con el perfil de hoy. Sin esto, una semana ya terminada
    -- seguiria calculandose con el modelo viejo (055).
    update settlements s
       set compensation_type_snap      = v_barber.compensation_type,
           box_rental_amount_snap      = case when v_barber.compensation_type = 'box_rental'
                                              then v_barber.box_rental_amount end,
           commission_rate_snap        = case when v_barber.compensation_type = 'percentage'
                                              then v_barber.commission_rate end,
           base_salary_rate_snap       = v_barber.base_salary_rate,
           presentismo_rate_snap       = v_barber.presentismo_rate,
           mantenimiento_rate_snap     = v_barber.mantenimiento_rate,
           mantenimiento_min_cuts_snap = v_barber.mantenimiento_min_cuts
     where s.week_id = v_week.id and s.barber_id = p_barber_id;

    if v_barber.compensation_type = 'box_rental' then
      with ordered as (
        select t.id, t.amount,
               coalesce(sum(t.amount) over (
                 partition by t.transaction_date order by t.created_at, t.id
                 rows between unbounded preceding and 1 preceding), 0) as acc
        from transactions t
        where t.week_id = v_week.id and t.barber_id = p_barber_id
      ), split as (
        select id, amount,
               round(least(amount, greatest(0, v_barber.box_rental_amount - acc)), 2) as to_shop
        from ordered
      )
      update transactions t
         set branch_share             = s.to_shop,
             barber_share             = round(s.amount - s.to_shop, 2),
             barber_already_collected = round(s.amount - s.to_shop, 2),
             commission_rate_snapshot = v_rate
        from split s
       where t.id = s.id;
    else
      with split as (
        select tx.id, tx.amount, tx.cash_amount, tx.transfer_amount,
               (v_barber.compensation_type = 'percentage'
                and coalesce(tx.benefit_full_amount_snap, bf.full_amount_to_barber, false)) as vip
        from transactions tx
        left join benefits bf on bf.id = tx.benefit_id
        where tx.week_id = v_week.id and tx.barber_id = p_barber_id
      ), calc as (
        select id, amount, cash_amount, transfer_amount, vip,
               case when vip then amount
                    else greatest(0, least(round(amount * v_rate, 2), amount)) end as bshare
        from split
      )
      update transactions t
         set barber_share             = c.bshare,
             branch_share             = round(c.amount - c.bshare, 2),
             barber_already_collected = case
                                          when c.vip then c.cash_amount + c.transfer_amount
                                          when v_barber.receives_transfers then c.transfer_amount
                                          else 0
                                        end,
             commission_rate_snapshot = v_rate
        from calc c
       where t.id = c.id;
    end if;

    perform public._calculate_settlement_core(v_week.id, p_barber_id);

    v_recalc := v_recalc + 1;
    if v_primera is null then v_primera := v_week.start_date; end if;
  end loop;

  return jsonb_build_object(
    'semanas_recalculadas',  v_recalc,
    'semanas_saltadas',      v_saltadas,
    'primera_semana',        v_primera
  );
end;
$function$;

revoke execute on function public.aplicar_cambio_de_modelo(uuid, date) from public, anon;
grant  execute on function public.aplicar_cambio_de_modelo(uuid, date) to authenticated, service_role;
