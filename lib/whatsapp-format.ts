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

/**
 * WhatsApp de CONSULTA de la sucursal para la leyenda de los avisos ("341 682-5981").
 *
 * Los avisos salen de un número que no recibe mensajes (el chip del turnero); la leyenda le dice
 * al cliente a qué número escribir. Sale de branches.whatsapp_phone, que se guarda como
 * 549 + área + número. Si la sucursal no lo cargó, devuelve una frase que sigue leyéndose bien
 * en la leyenda en vez de dejar la variable vacía (Meta rechaza variables vacías).
 */
export function numeroConsulta(whatsappPhone: string | null | undefined): string {
  const FALLBACK = 'el de siempre'
  if (!whatsappPhone) return FALLBACK
  const digits = whatsappPhone.replace(/\D/g, '').replace(/^549?/, '')
  if (digits.length !== 10) return FALLBACK
  // Área de 2 dígitos solo en Buenos Aires (11); el resto, de 3 (341, 351, 261...).
  const area = digits.startsWith('11') ? 2 : 3
  const resto = digits.slice(area)
  const corte = resto.length - 4
  return `${digits.slice(0, area)} ${resto.slice(0, corte)}-${resto.slice(corte)}`
}

/** "Bruno Mar Ballinari" -> "Bruno". Saludar con el nombre completo suena a formulario. */
export function primerNombre(nombreCompleto: string): string {
  const primero = nombreCompleto.trim().split(/\s+/)[0] ?? ''
  if (!primero) return nombreCompleto.trim()
  return primero.charAt(0).toLocaleUpperCase('es-AR') + primero.slice(1).toLocaleLowerCase('es-AR')
}
