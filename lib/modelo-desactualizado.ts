import { supabase, aplicarCambioDeModelo } from '@/lib/supabase/supabase.client'
import { confirmDialog } from '@/lib/confirm-dialog'
import type { CompensationType } from '@/lib/supabase/database.types'

/**
 * Una liquidación en borrador guarda el modelo con el que se calculó (snapshot).
 * Si después el admin cambia el perfil del barbero (se olvidó de configurarlo al
 * arrancar el mes, por ejemplo), una semana que ya terminó sigue con el modelo
 * viejo: "Recalcular" y "Cerrar semana" respetan el snapshot para no reescribir
 * la historia (migración 055). Este chequeo detecta esa diferencia y le pregunta
 * al admin si quiere aplicar el modelo actual del perfil a la semana.
 */

interface FilaModelo {
  barber_id: string
  compensation_type_snap: CompensationType | null
  box_rental_amount_snap: number | null
  commission_rate_snap: number | null
  barber:
    | { full_name: string; compensation_type: CompensationType; box_rental_amount: number | null; commission_rate: number | null }
    | null
}

export interface ModeloDesactualizado {
  barberId: string
  nombre: string
  liquidacion: string
  perfil: string
}

const ars = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

function etiqueta(tipo: CompensationType, alquiler: number | null, tasa: number | null): string {
  if (tipo === 'box_rental') return alquiler != null ? `Alquiler de box ${ars(Number(alquiler))}/día` : 'Alquiler de box'
  if (tipo === 'percentage') return tasa != null ? `Comisión ${Math.round(Number(tasa) * 10000) / 100}%` : 'Comisión %'
  return 'Sueldo fijo'
}

function difiere(a: number | null, b: number | null, tolerancia: number): boolean {
  if (a == null || b == null) return false // sin dato congelado no hay con qué comparar
  return Math.abs(Number(a) - Number(b)) > tolerancia
}

/** Liquidaciones en borrador de la semana cuyo modelo congelado ya no coincide con el perfil. */
export async function modelosDesactualizados(
  weekId: string,
  barberId?: string,
): Promise<ModeloDesactualizado[]> {
  let query = supabase
    .from('settlements')
    .select(
      'barber_id, compensation_type_snap, box_rental_amount_snap, commission_rate_snap, barber:profiles!barber_id ( full_name, compensation_type, box_rental_amount, commission_rate )',
    )
    .eq('week_id', weekId)
    .eq('status', 'draft')
  if (barberId) query = query.eq('barber_id', barberId)

  const { data, error } = await query
  if (error) throw new Error(`[modelosDesactualizados] ${error.message}`)

  const out: ModeloDesactualizado[] = []
  for (const r of (data ?? []) as unknown as FilaModelo[]) {
    const p = r.barber
    const snap = r.compensation_type_snap
    if (!p || !snap) continue
    const distintoTipo = snap !== p.compensation_type
    const distintoAlquiler =
      p.compensation_type === 'box_rental' && difiere(r.box_rental_amount_snap, p.box_rental_amount, 0.005)
    const distintaTasa =
      p.compensation_type === 'percentage' && difiere(r.commission_rate_snap, p.commission_rate, 1e-6)
    if (!distintoTipo && !distintoAlquiler && !distintaTasa) continue
    out.push({
      barberId: r.barber_id,
      nombre: p.full_name,
      liquidacion: etiqueta(snap, r.box_rental_amount_snap, r.commission_rate_snap),
      perfil: etiqueta(p.compensation_type, p.box_rental_amount, p.commission_rate),
    })
  }
  return out
}

/**
 * Si algún barbero de la semana (o el indicado) tiene la liquidación en borrador
 * con un modelo distinto al de su perfil, pregunta si aplicar el modelo actual y,
 * si el admin acepta, lo aplica desde el inicio de la semana. Hay que llamarla
 * ANTES de recalcular o cerrar. Si el admin dice que no, no hace nada: el
 * recalculo sigue con el modelo congelado, como hasta ahora.
 */
export async function ofrecerAplicarModeloActual(
  week: { id: string; start_date: string },
  barberId?: string,
): Promise<void> {
  const lista = await modelosDesactualizados(week.id, barberId)
  if (lista.length === 0) return

  const detalle = lista
    .map((m) => `• ${m.nombre}: la liquidación está como "${m.liquidacion}" y su perfil dice "${m.perfil}"`)
    .join('\n')
  const ok = await confirmDialog({
    title: 'El modelo del barbero cambió',
    message:
      `${detalle}\n\n` +
      '¿Aplicar el modelo actual del perfil a esta semana? Se re-reparten sus cortes y se recalcula ' +
      'esta semana y las siguientes que estén en borrador. Las liquidaciones confirmadas o pagadas no se tocan.',
    confirmLabel: 'Aplicar modelo actual',
    cancelLabel: 'Dejar como está',
  })
  if (!ok) return

  for (const m of lista) {
    await aplicarCambioDeModelo(m.barberId, week.start_date)
  }
}
