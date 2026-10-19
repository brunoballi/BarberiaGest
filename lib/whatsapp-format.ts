// ============================================================
// Cómo se escriben los valores que entran en las plantillas de WhatsApp.
// Un solo lugar para que la confirmación, el recordatorio y la cancelación
// digan las cosas igual. SOLO cambia el formato de las variables: el texto de
// la plantilla es el que aprobó Meta (ver docs/whatsapp_templates.md).
// ============================================================

const TZ = 'America/Argentina/Buenos_Aires'

/** "viernes, 2 de octubre" */
export function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
}

/**
 * "18:40" -- en 24 horas a propósito. Las plantillas ya dicen "hs" después de
 * la hora, y "06:40 p. m. hs" mezclaba dos formas de decir lo mismo.
 */
export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ })
}

/** "Bruno Mar Ballinari" -> "Bruno". Saludar con el nombre completo suena a formulario. */
export function primerNombre(nombreCompleto: string): string {
  const primero = nombreCompleto.trim().split(/\s+/)[0] ?? ''
  if (!primero) return nombreCompleto.trim()
  return primero.charAt(0).toLocaleUpperCase('es-AR') + primero.slice(1).toLocaleLowerCase('es-AR')
}
