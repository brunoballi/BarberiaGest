-- ============================================================
-- REPORTES: desglose de retiros de socios por socio
-- ============================================================
-- Agrega la columna partner_withdrawals_partners: el detalle de
-- cuanto retiro cada socio en el periodo, para mostrarlo colapsable
-- en Reportes igual que "Total barberia" / "Total por barbero".
--
-- La columna partner_withdrawals (total agregado) YA existia y se
-- mantiene igual — esto solo suma el detalle.
--
-- ⚠️ Esta funcion se reescribe COMPLETA en cada migracion. El cuerpo
-- de abajo es la version que hoy corre en PRODUCCION (verificada con
-- pg_get_functiondef contra el proyecto del cliente), NO la del
-- archivo 043 del repo ni la que tenia la base local, que estaba
-- atrasada (le faltaban branch_from_cuts / branch_from_rent /
-- branch_cuts_barbers / branch_rent_barbers). Si se reescribe desde
-- una version vieja, esas features se pierden en prod.
--
-- Hay que dropear primero: agregar una columna cambia el tipo de
-- retorno y 'create or replace' falla cuando el RETURNS TABLE difiere.

drop function if exists public.report_by_period(uuid[], date, date);

create or replace function public.report_by_period(p_branch_ids uuid[], p_start date, p_end date)
returns table(
  branch_id uuid,
  cut_count integer,
  total_income double precision,
  branch_share double precision,
  barber_share double precision,
  total_expenses double precision,
  partner_withdrawals double precision,
  expenses_by_category jsonb,
  barber_total double precision,
  barbers jsonb,
  branch_from_cuts double precision,
  branch_from_rent double precision,
  branch_cuts_barbers jsonb,
  branch_rent_barbers jsonb,
  partner_withdrawals_partners jsonb
)
language sql
as $function$
  with target_weeks as (
    select w.id as week_id, w.branch_id
    from weeks w
    join months m on m.id = w.month_id
    where m.branch_id = any(p_branch_ids)
      and m.year  = extract(year from p_start)::int
      and m.month = extract(month from p_start)::int
  ),
  paid_settlements as (
    select s.week_id, s.barber_id, s.branch_id, s.total_earned,
           s.gross_amount, s.box_rent,
           p.compensation_type, p.full_name
    from settlements s
    join target_weeks tw on tw.week_id = s.week_id
    join profiles p on p.id = s.barber_id
    where s.status = 'paid'
  ),
  tx as (
    select t.branch_id,
           count(*)::int                              as cut_count,
           coalesce(sum(t.amount),0)::float8           as total_income,
           (coalesce(sum(t.amount),0) * 0.5)::float8   as branch_share,
           (coalesce(sum(t.amount),0) * 0.5)::float8   as barber_share
    from transactions t
    join paid_settlements ps
      on ps.week_id = t.week_id and ps.barber_id = t.barber_id
    group by t.branch_id
  ),
  branch_by_barber as (
    select ps.branch_id, ps.barber_id, ps.full_name,
           (ps.compensation_type = 'box_rental') as es_box,
           coalesce(sum(ps.gross_amount - ps.total_earned),0)::float8 as aporte
    from paid_settlements ps
    group by ps.branch_id, ps.barber_id, ps.full_name, (ps.compensation_type = 'box_rental')
  ),
  branch_split as (
    select bb.branch_id,
           coalesce(sum(bb.aporte) filter (where not bb.es_box),0)::float8 as branch_from_cuts,
           coalesce(sum(bb.aporte) filter (where bb.es_box),0)::float8     as branch_from_rent,
           coalesce(
             jsonb_agg(
               jsonb_build_object('barber_id', bb.barber_id, 'full_name', bb.full_name, 'total', bb.aporte)
               order by bb.aporte desc
             ) filter (where not bb.es_box),
             '[]'::jsonb
           ) as branch_cuts_barbers,
           coalesce(
             jsonb_agg(
               jsonb_build_object('barber_id', bb.barber_id, 'full_name', bb.full_name, 'total', bb.aporte)
               order by bb.aporte desc
             ) filter (where bb.es_box),
             '[]'::jsonb
           ) as branch_rent_barbers
    from branch_by_barber bb
    group by bb.branch_id
  ),
  exp as (
    select branch_id,
           coalesce(sum(amount) filter (where category is distinct from 'retiro_socio'),0)::float8 as total_expenses,
           coalesce(sum(amount) filter (where category = 'retiro_socio'),0)::float8               as partner_withdrawals
    from expenses
    where branch_id = any(p_branch_ids)
      and expense_date between p_start and p_end
    group by branch_id
  ),
  exp_cat as (
    select branch_id,
           coalesce(jsonb_object_agg(category, cat_sum), '{}'::jsonb) as expenses_by_category
    from (
      select branch_id, category, sum(amount)::float8 as cat_sum
      from expenses
      where branch_id = any(p_branch_ids)
        and expense_date between p_start and p_end
        and category is distinct from 'retiro_socio'
        and category is not null
      group by branch_id, category
    ) ec
    group by branch_id
  ),
  -- ── NUEVO: retiros agrupados por socio ──────────────────────
  -- partner_id puede ser null en filas cargadas antes de la
  -- migracion 044: se agrupan bajo "Sin socio asignado" en vez de
  -- descartarlas, para que el desglose siempre sume el total.
  partner_by_partner as (
    select e.branch_id,
           e.partner_id,
           coalesce(p.full_name, 'Sin socio asignado') as full_name,
           coalesce(sum(e.amount),0)::float8 as total
    from expenses e
    left join profiles p on p.id = e.partner_id
    where e.branch_id = any(p_branch_ids)
      and e.expense_date between p_start and p_end
      and e.category = 'retiro_socio'
    group by e.branch_id, e.partner_id, p.full_name
  ),
  partner_split as (
    select pp.branch_id,
           jsonb_agg(
             jsonb_build_object('partner_id', pp.partner_id, 'full_name', pp.full_name, 'total', pp.total)
             order by pp.total desc
           ) as partner_withdrawals_partners
    from partner_by_partner pp
    group by pp.branch_id
  ),
  barber_settle as (
    select ps.branch_id, ps.barber_id,
           coalesce(sum(ps.total_earned),0)::float8 as take
    from paid_settlements ps
    group by ps.branch_id, ps.barber_id
  ),
  barber_agg as (
    select bs.branch_id,
           coalesce(sum(bs.take),0)::float8 as barber_total,
           jsonb_agg(
             jsonb_build_object('barber_id', bs.barber_id, 'full_name', p.full_name, 'total', bs.take)
             order by bs.take desc
           ) as barbers
    from barber_settle bs
    join profiles p on p.id = bs.barber_id
    group by bs.branch_id
  )
  select b.id,
         coalesce(tx.cut_count, 0),
         coalesce(tx.total_income, 0),
         coalesce(tx.branch_share, 0),
         coalesce(tx.barber_share, 0),
         coalesce(exp.total_expenses, 0),
         coalesce(exp.partner_withdrawals, 0),
         coalesce(exp_cat.expenses_by_category, '{}'::jsonb),
         coalesce(barber_agg.barber_total, 0),
         coalesce(barber_agg.barbers, '[]'::jsonb),
         coalesce(branch_split.branch_from_cuts, 0),
         coalesce(branch_split.branch_from_rent, 0),
         coalesce(branch_split.branch_cuts_barbers, '[]'::jsonb),
         coalesce(branch_split.branch_rent_barbers, '[]'::jsonb),
         coalesce(partner_split.partner_withdrawals_partners, '[]'::jsonb)
  from unnest(p_branch_ids) as b(id)
  left join tx            on tx.branch_id = b.id
  left join exp           on exp.branch_id = b.id
  left join exp_cat       on exp_cat.branch_id = b.id
  left join barber_agg    on barber_agg.branch_id = b.id
  left join branch_split  on branch_split.branch_id = b.id
  left join partner_split on partner_split.branch_id = b.id;
$function$;
