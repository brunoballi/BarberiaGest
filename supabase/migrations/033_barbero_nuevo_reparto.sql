-- 033: esquema de reparto especial para "barbero nuevo".
--
-- Un barbero recién ingresado (profiles.is_new_barber = true) no cobra el %
-- convencional por corte durante su período de adaptación (sin vencimiento
-- automático; el admin lo destilda a mano cuando termina el período). En su
-- lugar, cada TRANSACCIÓN se compara contra el precio de "2 cortes clásicos"
-- (service_catalog.is_classic_cut, un servicio de referencia por sucursal):
--
--   CLASICO = base_price del servicio marcado como clásico en la sucursal
--   BASICO  = 2 * CLASICO
--   DOBLE   = 2 * BASICO  (= 4 * CLASICO)
--
--   monto = 0                    -> barbero se lleva 0
--   0 < monto < BASICO            -> barbero se lleva el 100% (el monto entero)
--   monto = BASICO                -> barbero se lleva el 100% (= BASICO)
--   BASICO < monto <= DOBLE        -> barbero se lleva BASICO (fijo)
--   monto > DOBLE                  -> reparto convencional (% del ABM del barbero)
--
-- Si la sucursal no tiene ningún servicio marcado como clásico, se hace
-- fallback silencioso al reparto convencional (no se puede calcular BASICO).

alter table service_catalog add column if not exists is_classic_cut boolean not null default false;
alter table profiles add column if not exists is_new_barber boolean not null default false;

comment on column service_catalog.is_classic_cut is
  'Servicio de referencia ("corte clásico") usado para calcular el reparto de barberos nuevos. Un solo servicio por sucursal.';
comment on column profiles.is_new_barber is
  'Barbero recién ingresado: durante este período su reparto por corte usa el esquema de tramos basado en "2 cortes clásicos" en vez del % convencional. Sin vencimiento automático.';

-- Un solo servicio marcado como clásico por sucursal (evita ambigüedad sobre
-- qué precio usar para BASICO/DOBLE).
create unique index if not exists service_catalog_one_classic_cut_per_branch
  on service_catalog (branch_id)
  where is_classic_cut;

create or replace function public.recalculate_settlement_full(p_week_id uuid, p_barber_id uuid)
 returns uuid
 language plpgsql
 security definer
as $function$
declare
  v_barber    profiles%rowtype;
  v_status    text;
  v_clasico   numeric;
  v_basico    numeric;
  v_doble     numeric;
begin
  select * into v_barber from profiles where id = p_barber_id;
  if not found then raise exception 'Barbero % no encontrado', p_barber_id; end if;

  select status into v_status
  from settlements where week_id = p_week_id and barber_id = p_barber_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'La liquidación está en estado "%"; anulala (volver a borrador) para recalcular', v_status;
  end if;

  if v_barber.compensation_type = 'percentage' then
    if coalesce(v_barber.is_new_barber, false) then
      select base_price into v_clasico
      from service_catalog
      where branch_id = v_barber.branch_id and is_classic_cut
      limit 1;
    end if;

    if v_clasico is not null then
      -- Barbero nuevo con clásico definido: reparto por tramos, por transacción.
      v_basico := 2 * v_clasico;
      v_doble  := 2 * v_basico;

      update transactions t
      set barber_share = sub.bshare,
          branch_share = round(t.amount - sub.bshare, 2)
      from (
        select
          id,
          case
            when amount <= 0 then 0
            when amount <= v_basico then amount
            when amount <= v_doble then v_basico
            else greatest(0, least(
              round(
                (amount + coalesce(discount_amount, 0)) * coalesce(v_barber.commission_rate, 0)
                - coalesce(discount_amount, 0) * 0.5
              , 2),
              amount
            ))
          end as bshare
        from transactions
        where week_id = p_week_id and barber_id = p_barber_id
      ) sub
      where t.id = sub.id;
    else
      -- Reparto convencional (barbero experimentado, o sin clásico configurado
      -- en la sucursal: fallback).
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
    end if;
  elsif v_barber.compensation_type = 'box_rental' then
    update transactions
    set barber_share = amount, branch_share = 0
    where week_id = p_week_id and barber_id = p_barber_id;
  end if;

  return public.calculate_settlement(p_week_id, p_barber_id);
end;
$function$;

grant execute on function public.recalculate_settlement_full(uuid, uuid) to anon, authenticated, service_role;
