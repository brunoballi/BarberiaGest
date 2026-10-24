// ============================================================
// Confirmación del turno por WhatsApp (mensaje automático AL CLIENTE).
//
// Mismo patrón que confirmar-email/route.ts: se llama justo después de
// que create_appointment_public confirma la reserva, y de lo que manda el
// navegador solo usa referencia + teléfono. El nombre de la sucursal y el
// resto del texto salen de la base (antes `branchName` venía del body y se
// podía meter cualquier texto en un mensaje enviado con el número de la
// barbería). Sale UNA sola vez por turno (107).
//
// El NÚMERO QUE MANDA es el de la sucursal del turno registrado en la Cloud
// API de Meta (branches.whatsapp_phone_number_id, con respaldo en
// WHATSAPP_PHONE_NUMBER_ID; el token es WHATSAPP_ACCESS_TOKEN). No tiene relación con branches.whatsapp_phone: esa
// columna es solo para el botón manual "Enviarme por WhatsApp" (wa.me),
// donde el CLIENTE le escribe a la barbería. Acá es al revés: la
// barbería (vía Meta) le escribe al cliente.
//
// Si falla, si no está configurado WHATSAPP_ACCESS_TOKEN, o si el
// teléfono no tiene forma de celular argentino, no es un error para
// quien reservó: el turno ya quedó confirmado igual, y el botón wa.me
// sigue andando en paralelo como respaldo manual mientras la plantilla
// no esté aprobada por Meta.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { sendTemplateMessage, isWhatsAppConfigured, toWhatsAppRecipient, WhatsAppError } from '@/lib/whatsapp'
import { findAppointmentForNotice, claimNotice } from '@/lib/supabase/booking-notices'
import { resolveSenderPhoneNumberId } from '@/lib/whatsapp-sender'
import { registerWhatsAppMessage } from '@/lib/whatsapp-log'
import { fechaLarga, hora, primerNombre } from '@/lib/whatsapp-format'
import { turneroApiGate } from '@/lib/turnero-guard'

export async function POST(request: NextRequest) {
  // Turnero en prueba: cerrado salvo para el usuario desarrollador (lib/turnero-access.ts).
  const gate = await turneroApiGate()
  if (gate) return gate

  if (!isWhatsAppConfigured()) {
    return NextResponse.json({ sent: false, reason: 'not_configured' })
  }

  let body: { reference?: string; phone?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { reference, phone } = body
  if (typeof reference !== 'string' || typeof phone !== 'string' || !reference || !phone) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 })
  }

  const destinatario = toWhatsAppRecipient(phone)
  if (!destinatario) {
    // No debería pasar (el teléfono ya se validó al reservar), pero si
    // pasa no tiene sentido intentar mandarlo con un `to` roto.
    return NextResponse.json({ sent: false, reason: 'telefono_invalido' })
  }

  const appt = await findAppointmentForNotice(reference, phone)
  if (!appt) {
    return NextResponse.json({ sent: false, reason: 'not_found' })
  }
  if (appt.status !== 'reservado') {
    return NextResponse.json({ sent: false, reason: 'no_activo' })
  }
  // Antes de reclamar el aviso: si la sucursal no tiene número, no hay que
  // gastar el "una sola vez" de un mensaje que no puede salir.
  const phoneNumberId = await resolveSenderPhoneNumberId(appt.branchId)
  if (!phoneNumberId) {
    return NextResponse.json({ sent: false, reason: 'sucursal_sin_numero' })
  }
  if (!(await claimNotice(appt.id, 'confirmation_whatsapp_sent_at'))) {
    return NextResponse.json({ sent: false, reason: 'ya_enviado' })
  }

  const servicios = appt.services.map((s) => s.name).join(', ')

  // Valor dinámico del botón "Gestionar mi turno" -- se concatena al final
  // de la URL registrada en Meta (`.../gestionar?ref={{1}}`), así que tiene
  // que ser lo mismo que arma confirmar-email/route.ts para el link del
  // mail: la referencia y la sucursal (para que "reservar otro turno" desde
  // ahí vuelva a la misma sucursal en vez del selector).
  const botonParam = `${appt.reference}&sucursal=${appt.branchId}`

  try {
    // El ORDEN de bodyParams tiene que coincidir exactamente con los
    // {{1}}, {{2}}... de la plantilla "confirmacion_turno_v4" aprobada en
    // Meta -- ver docs/whatsapp_templates.md para el texto exacto.
    const { messageId } = await sendTemplateMessage({
      phoneNumberId,
      to: destinatario,
      templateName: 'confirmacion_turno_v4',
      bodyParams: [primerNombre(appt.clientName), appt.branchName, fechaLarga(appt.startsAt), hora(appt.startsAt), servicios, appt.reference],
      buttonUrlParam: botonParam,
    })
    await registerWhatsAppMessage({ wamid: messageId, branchId: appt.branchId, appointmentId: appt.id, kind: 'confirmacion', recipient: destinatario })
    return NextResponse.json({ sent: true })
  } catch (e) {
    console.error('[confirmar-whatsapp]', e instanceof WhatsAppError ? e.message : e)
    return NextResponse.json({ sent: false, reason: 'send_error' })
  }
}
