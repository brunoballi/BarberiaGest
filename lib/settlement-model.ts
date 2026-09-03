import type { CompensationType, Settlement, Profile } from '@/lib/supabase/database.types'

/**
 * Modelo de compensación con el que se calculó una liquidación.
 *
 * SIEMPRE usar esto para renderizar una liquidación, nunca
 * `s.barber.compensation_type`: ese es el modelo que el barbero tiene HOY, y si
 * cambió de esquema (por ejemplo de comisión a alquiler de box) todas sus
 * semanas anteriores se dibujan con el layout equivocado — mostrando el
 * facturado donde va la comisión, escondiendo los bonos y agregando una columna
 * de alquiler que esa semana no existió.
 *
 * El snapshot lo congela `calculate_settlement` (migraciones 049 y 051). El
 * fallback al perfil cubre las filas anteriores a la 049 que nunca se
 * recalcularon: para un barbero que no cambió de modelo da el mismo resultado.
 *
 * Para registrar o editar un corte NO se usa esto: ahí manda la configuración
 * actual del barbero, porque es carga de datos del día, no historia.
 */
export function settlementCompensation(
  s: Pick<Settlement, 'compensation_type_snap'> & {
    barber: Pick<Profile, 'compensation_type'>
  },
): CompensationType {
  return s.compensation_type_snap ?? s.barber.compensation_type
}

/** Atajo: ¿esta liquidación se calculó con alquiler de box? */
export function isBoxRentalSettlement(
  s: Pick<Settlement, 'compensation_type_snap'> & {
    barber: Pick<Profile, 'compensation_type'>
  },
): boolean {
  return settlementCompensation(s) === 'box_rental'
}
