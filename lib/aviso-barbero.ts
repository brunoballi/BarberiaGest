// ============================================================
// Aviso del barbero al cliente (turnero en prueba).
//
// El barbero NO ve el teléfono del cliente (migración 095): para escribirle
// pide el envío al servidor (/api/turnos/mensaje), que busca el número y manda
// una plantilla aprobada desde el WhatsApp de la sucursal. Acá vive lo que
// comparten la pantalla del barbero y el servidor: los mensajes disponibles y
// cuándo se puede mandar uno.
//
// Los mensajes son FIJOS a propósito: con texto libre el barbero podría
// escribir su propio número y llevarse al cliente. Además WhatsApp solo deja
// mandar texto libre dentro de las 24 h posteriores a un mensaje del cliente.
// ============================================================

export type TipoAvisoBarbero = 'espera' | 'imprevisto'

export interface AvisoBarberoDef {
  tipo: TipoAvisoBarbero
  /** Lo que ve el barbero en el botón. */
  etiqueta: string
  /** Nombre de la plantilla aprobada en Meta (lib/whatsapp-templates.ts). */
  plantilla: string
}

export const AVISOS_BARBERO: AvisoBarberoDef[] = [
  { tipo: 'espera', etiqueta: '¿Venís? Te estamos esperando', plantilla: 'aviso_espera_turno_v1' },
  { tipo: 'imprevisto', etiqueta: 'Avisar que hay una demora', plantilla: 'aviso_demora_turno_v1' },
]

/** Minutos después de la hora del turno desde los que se puede avisar. */
export const AVISO_MARGEN_MIN = 10
/** Pasado este tiempo desde la hora del turno ya no tiene sentido avisar. */
export const AVISO_VENTANA_MAX_MIN = 180

export type MotivoNoAvisable = 'estado' | 'todavia_no' | 'muy_tarde'

/**
 * ¿Se puede mandar un aviso por este turno ahora? Solo turnos "reservado" (si el
 * cliente ya llegó o se atendió no corresponde), pasada la hora más el margen,
 * y dentro de la ventana. El servidor la vuelve a aplicar: esto solo decide si
 * se muestra el botón.
 */
export function motivoNoAvisable(
  turno: { status: string; starts_at: string },
  ahora: Date = new Date(),
): MotivoNoAvisable | null {
  if (turno.status !== 'reservado') return 'estado'
  const minutos = (ahora.getTime() - new Date(turno.starts_at).getTime()) / 60000
  if (minutos < AVISO_MARGEN_MIN) return 'todavia_no'
  if (minutos > AVISO_VENTANA_MAX_MIN) return 'muy_tarde'
  return null
}
