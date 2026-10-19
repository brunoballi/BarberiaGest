// ============================================================
// Integración con WhatsApp Cloud API — mensajes de plantilla.
//
// Solo manda plantillas (nunca texto libre): son el único tipo de mensaje
// que Meta deja iniciar sin que el cliente haya escrito antes ("mensaje de
// negocio, fuera de la ventana de servicio"). La confirmación y el
// recordatorio del turno son business-initiated por definición, así que
// las dos plantillas ("confirmacion_turno" y "recordatorio_turno") tienen
// que estar dadas de alta y aprobadas en el WhatsApp Manager de Meta antes
// de que esto funcione. Ver docs/whatsapp_templates.md para el texto exacto
// a someter.
//
// ⚠️ Sin probar contra un envío real (no había credenciales al escribir
// esto): el formato del pedido sigue la Cloud API documentada por Meta
// (estable desde 2022), pero antes de confiar en esto en producción hay
// que mandar un mensaje de prueba de verdad y confirmar que llega.
//
// Mismo patrón que lib/mercadopago.ts: MessagingError con el status HTTP,
// fetch envuelto, y un isWhatsAppConfigured() para que el resto del código
// pueda no-opear en vez de romper cuando faltan las credenciales -- igual
// que ya hace el mail con RESEND_API_KEY.
// ============================================================

const WA_API = 'https://graph.facebook.com/v21.0'

export class WhatsAppError extends Error {
  readonly status: number

  constructor(status: number, detail: string) {
    super(`WhatsApp ${status}: ${detail}`)
    this.name = 'WhatsAppError'
    this.status = status
  }
}

/**
 * ¿Hay credenciales de WhatsApp en esta instalación? Mira solo el token: el
 * número desde el que sale cada aviso es POR SUCURSAL (ver
 * lib/whatsapp-sender.ts y la migración 112), así que que falte uno no
 * significa que WhatsApp no esté configurado.
 */
export function isWhatsAppConfigured(): boolean {
  return !!process.env.WHATSAPP_ACCESS_TOKEN
}

function accessToken(): string {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) throw new Error('Falta WHATSAPP_ACCESS_TOKEN.')
  return token
}

/**
 * Convierte el teléfono canónico del cliente (+54XXXXXXXXXX, SIN el 9 --
 * ver normalizePhone en phone-input.tsx) al formato que la API de
 * WhatsApp exige para mandarle un mensaje: 549 + área + número.
 *
 * Es el mismo problema que ya resolvimos para branches.whatsapp_phone
 * (066_whatsapp_default_area_code.sql): el 9 de celular argentino no es
 * parte de cómo la gente marca, pero la numeración internacional de
 * WhatsApp lo exige igual. Acá no hace falta un código de área por
 * defecto porque el teléfono del cliente YA tiene el área incluida --
 * normalizePhone garantiza los 10 dígitos (área+número).
 *
 * Devuelve null si el teléfono no tiene la forma esperada, en vez de
 * mandar un `to` inválido a la API.
 *
 * Confirmado con un envío real (2026-08-27, número de negocio en vivo,
 * fuera de modo sandbox): "549..." es el formato correcto. La rareza
 * "54<área>15<número>" que hacía falta contra el número de PRUEBA de
 * Meta era específica de cómo el modo sandbox compara contra su lista
 * de destinatarios verificados -- no aplica acá. Mandando "549..." a un
 * número real, la API lo aceptó sin reclamo (el error que vino después
 * fue por otro motivo: la plantilla usada no estaba permitida fuera del
 * número de prueba, nada que ver con el formato del teléfono).
 */
export function toWhatsAppRecipient(canonicalPhone: string): string | null {
  const digits = canonicalPhone.replace(/\D/g, '').replace(/^54/, '')
  if (digits.length !== 10) return null
  return '549' + digits
}

/**
 * Manda un mensaje de plantilla ya aprobada por Meta.
 *
 * `to` va en formato internacional sin '+' (ej: 5493417505219) -- el mismo
 * que ya usa branches.whatsapp_phone (ver 066_whatsapp_default_area_code.sql)
 * y el que normaliza el teléfono del cliente en appointment_clients.
 *
 * `bodyParams` son los {{1}}, {{2}}... del cuerpo de la plantilla, EN ORDEN.
 * Wa no valida en el momento que la cantidad coincida con la plantilla
 * real: si no coincide, el error llega recién en la respuesta de la API.
 *
 * `buttonUrlParam`, si la plantilla tiene un botón de "sitio web" con URL
 * DINÁMICA (ej. `.../reservar/gestionar?ref={{1}}`), es el valor que
 * reemplaza ese {{1}} -- numeración propia, independiente de bodyParams
 * (ver docs/whatsapp_templates.md). Si el botón de la plantilla es
 * estático (sin {{1}}, como el de cancelacion_turno_v4), no hace falta
 * mandar nada: Meta lo renderiza solo.
 */
export async function sendTemplateMessage(params: {
  /** Phone Number ID de Meta desde el que sale el mensaje (el de la sucursal). */
  phoneNumberId: string
  to: string
  templateName: string
  languageCode?: string
  bodyParams: string[]
  buttonUrlParam?: string
}): Promise<{ messageId: string }> {
  const components = [
    ...(params.bodyParams.length > 0
      ? [{ type: 'body', parameters: params.bodyParams.map((text) => ({ type: 'text', text })) }]
      : []),
    ...(params.buttonUrlParam
      ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: params.buttonUrlParam }] }]
      : []),
  ]

  const res = await fetch(`${WA_API}/${params.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: params.to,
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.languageCode ?? 'es_AR' },
        // Sin parámetros (ej. "hello_world", que no tiene {{1}}), se omite
        // el bloque `components` entero -- mandarlo vacío para una
        // plantilla sin variables puede rechazarse en vez de ignorarse.
        ...(components.length > 0 ? { components } : {}),
      },
    }),
    cache: 'no-store',
  })

  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  if (!res.ok) {
    // El error real de Meta viene anidado en body.error.message, no en la
    // raíz -- a diferencia de Mercado Pago. Sin este acceso específico,
    // el catch de quien llama solo vería "WhatsApp 400: [object Object]".
    const detail =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: { message?: string } }).error?.message ?? JSON.stringify(body))
        : String(text).slice(0, 300)
    throw new WhatsAppError(res.status, detail)
  }

  const r = body as { messages?: { id: string }[] }
  return { messageId: r.messages?.[0]?.id ?? '' }
}
