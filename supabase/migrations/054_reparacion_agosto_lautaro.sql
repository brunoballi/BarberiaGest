-- ============================================================
-- 054: REPARACION — agosto de Lautaro Foca, inflado por el precio del clasico
-- ============================================================
-- Ver la 053 para el bug. Entre el 01/09 y el 02/09/2026 se recalcularon 4
-- liquidaciones de agosto de Lautaro con el precio del clasico de septiembre
-- (20.000 en vez de los 15.000 que rigieron todo agosto), y el tramo de basico
-- se inflo $93.375 en total:
--
--   semana   basico             ganado                neto                de mas
--   03/08     90.000 -> 153.000  140.500 -> 165.500  128.000 -> 153.000  +25.000
--   10/08     60.000 -> 160.000  141.125 -> 172.500  128.625 -> 160.000  +31.375
--   17/08     60.000 -> 120.000  212.000 -> 236.000  190.500 -> 214.500  +24.000
--   24/08     96.750 -> 109.750  132.750 -> 145.750   96.750 -> 109.750  +13.000
--
-- Tres de las cuatro ya estaban en 'paid' cuando se recalcularon.
--
-- FUENTE DE LA RESTAURACION: audit_log.old_data de la PRIMERA actualizacion
-- mala de cada liquidacion, o sea la fila completa tal como estaba justo antes.
-- No se tipean importes a mano. Ademas se verifico de forma independiente:
-- reconstruir el basico de cada semana desde los cortes reales con el tope
-- viejo (2 x 15.000 = 30.000/dia) da exactamente estos mismos numeros.
--
-- IDEMPOTENTE: solo toca la fila si su barber_gross sigue siendo exactamente el
-- valor que escribio el recalculo malo. Si alguien ya la corrigio a mano o la
-- recalculo despues, no la pisa.
--
-- Se identifica al barbero por nombre y las semanas por fecha, para no clavar
-- UUIDs generados en una migracion.
--
-- ⚠️ PENDIENTE FUERA DE LA BASE — cuanto se le entrego realmente a Lautaro:
--   * 10/08 y 17/08 se marcaron pagadas el 18/08 y el 25/08, ANTES de inflarse:
--     cobro lo correcto y esta migracion alinea el registro con la realidad.
--   * 24/08 y 03/08 se marcaron pagadas DESPUES del recalculo (01/09 21:16 y
--     03/09 02:38). Si se le entrego el numero inflado, queda una diferencia a
--     favor de la barberia que hay que resolver por fuera del sistema. Bruno lo
--     va a chequear con el cliente.
-- ============================================================

with malos as (
  select distinct on (a.record_id)
         a.record_id, a.old_data, a.new_data
  from audit_log a
  join settlements s2 on s2.id = a.record_id
  join weeks w2      on w2.id = s2.week_id
  join profiles p2   on p2.id = s2.barber_id
  where a.table_name = 'settlements'
    and a.action = 'UPDATE'
    and a.diff ? 'barber_basico'
    and p2.full_name = 'Lautaro Foca'
    and w2.start_date between '2026-08-01' and '2026-08-31'
    and a.changed_at >= '2026-09-01'
  order by a.record_id, a.changed_at asc
)
update public.settlements s
set barber_basico             = (m.old_data->>'barber_basico')::numeric,
    barber_basico_dias        = (m.old_data->>'barber_basico_dias')::int,
    barber_comision           = (m.old_data->>'barber_comision')::numeric,
    barber_comision_dias      = (m.old_data->>'barber_comision_dias')::int,
    barber_comision_facturado = (m.old_data->>'barber_comision_facturado')::numeric,
    barber_gross              = (m.old_data->>'barber_gross')::numeric,
    total_earned              = (m.old_data->>'total_earned')::numeric,
    net_payable               = (m.old_data->>'net_payable')::numeric
from malos m
where s.id = m.record_id
  and s.barber_gross = (m.new_data->>'barber_gross')::numeric;
