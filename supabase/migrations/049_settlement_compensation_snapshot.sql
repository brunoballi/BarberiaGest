-- ============================================================
-- 049: SNAPSHOT DEL MODELO DE COMPENSACION EN LA LIQUIDACION
-- ============================================================
-- Bug: profiles.compensation_type / commission_rate / box_rental_amount son
-- el valor de HOY, y settlements nunca los congelo (solo congela las tasas:
-- base_salary_rate_snap, presentismo_rate_snap, mantenimiento_rate_snap,
-- mantenimiento_min_cuts_snap). Cuando un barbero cambia de modelo, todo lo
-- que resuelve el modelo leyendo profiles reinterpreta el pasado:
--   * report_by_period (042/043/046) clasifica el aporte historico del barbero
--     como "barberia por alquiler" en vez de "por comision".
--   * el dashboard y la vista del barbero renderizan liquidaciones viejas con
--     el layout de box rental (admin-dashboard.tsx:152,161,998,1106,1110,...).
--   * calculate_settlement / recalculate_settlement_full recalcularian una
--     semana vieja en borrador con el modelo nuevo.
-- Caso real: Laureano (a39f59fe-...) paso de comision 40% a alquiler de box
-- ($70.000/dia) el 01/09/2026. Sus 10 liquidaciones de julio y agosto siguen
-- pagadas y con la matematica correcta (la guarda status <> 'draft' de la 038
-- las protegio), pero se reportaban y mostraban como alquiler de box.
--
-- Esta migracion NO toca importes: solo etiqueta con que modelo se calculo
-- cada liquidacion. La usan las migraciones 050 (reportes) y 051 (calculo).
--
-- Backfill: el modelo se infiere de lo ya guardado en cada fila.
--   box_rent > 0                                        -> box_rental
--   barber_gross = gross_amount y sin basico ni comision -> box_rental
--   base_salary_rate_snap = barber_gross                 -> salary
--   resto                                                -> percentage
-- Las dos condiciones extra de la segunda regla evitan un falso positivo real:
-- un barbero nuevo con esquema basico + comision puede llegar al 100% del
-- facturado en una semana (Lautaro Foca, 24/08-30/08: 109.750 de basico +
-- 36.000 de VIP = 145.750 = facturado). En una liquidacion de box rental
-- barber_basico y barber_comision son siempre 0.
--
-- commission_rate_snap y box_rental_amount_snap quedan NULL en el historico a
-- proposito: el 40% se deduce del ratio, pero en el esquema mixto no hay una
-- tasa unica que represente la semana. Se llenan de aca en adelante.
-- ============================================================

alter table public.settlements
  add column if not exists compensation_type_snap compensation_type,
  add column if not exists box_rental_amount_snap numeric,
  add column if not exists commission_rate_snap   numeric;

comment on column public.settlements.compensation_type_snap is
  'Modelo de compensacion vigente cuando se calculo esta liquidacion. Congelado: no sigue a profiles.compensation_type si el barbero cambia de modelo.';
comment on column public.settlements.box_rental_amount_snap is
  'Alquiler diario de box vigente en la semana (solo box_rental). NULL en el historico previo a la 049.';
comment on column public.settlements.commission_rate_snap is
  'Tasa de comision vigente en la semana (solo percentage). NULL en el historico previo a la 049.';

update public.settlements s
set compensation_type_snap = case
      when s.box_rent > 0
        then 'box_rental'::compensation_type
      when s.gross_amount > 0
           and s.barber_gross = s.gross_amount
           and coalesce(s.barber_basico, 0)  = 0
           and coalesce(s.barber_comision, 0) = 0
        then 'box_rental'::compensation_type
      when s.base_salary_rate_snap is not null
           and s.barber_gross = s.base_salary_rate_snap
        then 'salary'::compensation_type
      else 'percentage'::compensation_type
    end
where s.compensation_type_snap is null;

create index if not exists idx_settlements_compensation_type_snap
  on public.settlements (compensation_type_snap);
