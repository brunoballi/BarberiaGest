import type { Transaction, ServiceCatalog, Benefit } from '@/lib/supabase/database.types'

type ConNombres = Pick<Transaction, 'service_name_snap' | 'benefit_name_snap'> & {
  service?: Pick<ServiceCatalog, 'name'> | null
  benefit?: Pick<Benefit, 'name'> | null
}

/**
 * Nombre del servicio de un corte, para mostrar en el historial.
 *
 * Manda el snapshot y no el join, por dos motivos:
 *  1. Si el servicio se elimino del catalogo, `service_id` queda en null (la FK es
 *     ON DELETE SET NULL desde la migracion 060) y el join no trae nada. El
 *     snapshot es lo unico que queda.
 *  2. Si el servicio se renombro despues del corte, el historial tiene que seguir
 *     diciendo lo que decia ese dia — mismo criterio que el resto de los
 *     snapshots (migraciones 049-057).
 *
 * El fallback al join cubre cortes anteriores a la 059 que nunca se recalcularon.
 */
export function txServiceName(tx: ConNombres): string | null {
  return tx.service_name_snap ?? tx.service?.name ?? null
}

/** Idem para el beneficio aplicado al corte. */
export function txBenefitName(tx: ConNombres): string | null {
  return tx.benefit_name_snap ?? tx.benefit?.name ?? null
}
