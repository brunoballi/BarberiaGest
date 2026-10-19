// ============================================================
// Aviso de cancelación por WhatsApp (mensaje automático AL CLIENTE).
//
// Mismo patrón que confirmar-whatsapp/route.ts: se llama justo después de
// que cancel_appointment_public cancela el turno, y de lo que manda el
// navegador solo usa referencia + teléfono. El turno tiene que estar
// efectivamente cancelado, el texto sale de la base, y el aviso sale UNA
// sola vez (107).
//
// Si falla, si no está configurado WHATSAPP_ACCESS_TOKEN, o si el
// teléfono no tiene forma de celular argentino, no es un error para
// quien cancela: el turno ya quedó cancelado igual, este aviso es un
// extra -- mismo criterio que confirmar-whatsapp y confirmar-email.
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
    return NextResponse.json({ sent: false, reason: 'telefono_invalido' })
  }

  const appt = await findAppointmentForNotice(reference, phone)
  if (!appt) {
    return NextResponse.json({ sent: false, reason: 'not_found' })
  }
  if (appt.status !== 'cancelado') {
    return NextResponse.json({ sent: false, reason: 'no_cancelado' })
  }
  const phoneNumberId = await resolveSenderPhoneNumberId(appt.branchId)
  if (!phoneNumberId) {
    return NextResponse.json({ sent: false, reason: 'sucursal_sin_numero' })
  }
  if (!(await claimNotice(appt.id, 'cancellation_whatsapp_sent_at'))) {
    return NextResponse.json({ sent: false, reason: 'ya_enviado' })
  }

  try {
    // El ORDEN de bodyParams tiene que coincidir exactamente con los
    // {{1}}, {{2}}... de la plantilla "cancelacion_turno_v4" aprobada en
    // Meta -- ver docs/whatsapp_templates.md para el texto exacto.
    const { messageId } = await sendTemplateMessage({
      phoneNumberId,
      to: destinatario,
      templateName: 'cancelacion_turno_v4',
      bodyParams: [primerNombre(appt.clientName), appt.branchName, fechaLarga(appt.startsAt), hora(appt.startsAt)],
    })
    await registerWhatsAppMessage({ wamid: messageId, branchId: appt.branchId, appointmentId: appt.id, kind: 'cancelacion', recipient: destinatario })
    return NextResponse.json({ sent: true })
  } catch (e) {
    console.error('[cancelar-whatsapp]', e instanceof WhatsAppError ? e.message : e)
    return NextResponse.json({ sent: false, reason: 'send_error' })
  }
}
