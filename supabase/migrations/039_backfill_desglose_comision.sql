-- 039: backfill del desglose comisión/básico para liquidaciones existentes.
--
-- La 036 agregó barber_comision/barber_basico con default 0 pero no backfilleó
-- las filas ya existentes: la grilla ("Comisión base" = barber_comision −
-- vip_amount) mostraría $0 (o negativo con VIP) en todas las semanas viejas.
--
-- Para filas previas al desglose (comision = 0 y basico = 0 con ganado > 0),
-- todo el ganado por cortes es comisión convencional — el esquema "básico" del
-- barbero nuevo no existía cuando se generaron. Las filas ya recalculadas con
-- el desglose (basico > 0 o comision > 0) no se tocan.

update settlements
set barber_comision = barber_gross
where barber_gross <> 0
  and barber_comision = 0
  and barber_basico = 0;
