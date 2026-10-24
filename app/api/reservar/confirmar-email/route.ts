// ============================================================
// Email de confirmación del turno (reserva pública, Fase 2).
//
// Se llama desde booking-view.tsx justo después de que create_appointment_public
// confirma la reserva -- nunca antes. No confía en NADA de lo que mande el
// navegador salvo referencia + teléfono: el destinatario es el email que quedó
// guardado con la reserva, y el nombre de la sucursal y el contenido salen de
// la base. Antes el `email` y el `branchName` venían del body, y con una
// reserva propia se podía mandar HTML arbitrario a cualquier dirección desde
// el dominio de la barbería (auditoría 2026-09-29).
//
// Sale UNA sola vez por turno (appointments.confirmation_email_sent_at, 107).
//
// Si falla o no está configurado RESEND_API_KEY, no es un error para quien
// reservó: el turno ya quedó confirmado igual, el mail es un extra.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { buildAppointmentIcs } from '@/lib/ics'
import { findAppointmentForNotice, claimNotice, escapeHtml } from '@/lib/supabase/booking-notices'
import { turneroApiGate } from '@/lib/turnero-guard'

const TZ = 'America/Argentina/Buenos_Aires'

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}
function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
}
function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

export async function POST(request: NextRequest) {
  // Turnero en prueba: cerrado salvo para el usuario desarrollador (lib/turnero-access.ts).
  const gate = await turneroApiGate()
  if (gate) return gate

  if (!process.env.RESEND_API_KEY) {
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

  const appt = await findAppointmentForNotice(reference, phone)
  if (!appt) {
    return NextResponse.json({ sent: false, reason: 'not_found' })
  }
  if (!appt.clientEmail) {
    return NextResponse.json({ sent: false, reason: 'sin_email' })
  }
  if (appt.status !== 'reservado') {
    return NextResponse.json({ sent: false, reason: 'no_activo' })
  }
  if (!(await claimNotice(appt.id, 'confirmation_email_sent_at'))) {
    return NextResponse.json({ sent: false, reason: 'ya_enviado' })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.EMAIL_FROM || 'Valhalla <onboarding@resend.dev>'
  const nombreSucursal = escapeHtml(appt.branchName)

  // Link a /reservar/gestionar -- request.nextUrl.origin es el fallback si
  // no está seteada NEXT_PUBLIC_APP_URL, mismo patrón que ya usa
  // app/api/subscription/checkout/route.ts.
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
  const gestionarParams = new URLSearchParams({ ref: appt.reference, sucursal: appt.branchId })
  const gestionarUrl = `${origin}/reservar/gestionar?${gestionarParams.toString()}`

  const serviciosHtml = appt.services
    .map(
      (s) =>
        `<tr><td style="padding:4px 0;color:#334">${escapeHtml(s.name)}</td><td style="padding:4px 0;text-align:right;color:#334">${formatARS(s.price)}</td></tr>`
    )
    .join('')

  try {
    await resend.emails.send({
      from,
      to: appt.clientEmail,
      subject: `Turno confirmado en ${appt.branchName} — ${fechaLarga(appt.startsAt)}`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#0e1a15">
          <h1 style="color:#1D9E75;font-size:20px;margin-bottom:4px">¡Turno confirmado!</h1>
          <p style="color:#5a7a6c;margin-top:0">${nombreSucursal}</p>

          <div style="background:rgba(29,158,117,0.08);border-radius:12px;padding:16px 18px;margin:16px 0">
            <p style="font-size:16px;font-weight:700;margin:0 0 4px;color:#0e1a15">${fechaLarga(appt.startsAt)}</p>
            <p style="font-size:15px;margin:0;color:#0e1a15">${hora(appt.startsAt)} hs · con ${escapeHtml(appt.barberName)}</p>
          </div>

          <table style="width:100%;border-collapse:collapse;border-top:1px solid #d7e5de;border-bottom:1px solid #d7e5de;margin-bottom:16px">
            ${serviciosHtml}
            <tr><td style="padding:8px 0 0;font-weight:700">Total</td><td style="padding:8px 0 0;text-align:right;font-weight:700">${formatARS(appt.totalPrice)}</td></tr>
          </table>
          <p style="font-size:13px;color:#5a7a6c">Se paga en el local, no se cobra nada online.</p>

          <table style="width:100%;margin:20px 0" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="${escapeHtml(gestionarUrl)}" style="display:inline-block;background:#1D9E75;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:8px">
                Gestionar mi turno
              </a>
            </td></tr>
          </table>

          <p style="font-size:13px;color:#5a7a6c">Código de reserva: <strong>${escapeHtml(appt.reference)}</strong> — lo necesitás junto con tu teléfono para consultar o cancelar el turno (por si el botón de arriba no te funciona).</p>
          <p style="font-size:13px;color:#5a7a6c;border-top:1px solid #d7e5de;padding-top:12px">
            📅 Adjuntamos el turno como archivo de calendario: tocalo para agendarlo
            en tu teléfono y que te avise 2 horas antes.
          </p>
        </div>
      `,
      // El .ics va adjunto y no como link a Google Calendar: así funciona
      // igual en iPhone, Android, Outlook y Gmail, y lleva su propia alarma.
      attachments: [
        {
          filename: `turno-${appt.reference}.ics`,
          content: Buffer.from(
            buildAppointmentIcs({
              reference: appt.reference,
              startsAt: appt.startsAt,
              endsAt: appt.endsAt,
              branchName: appt.branchName,
              barberName: appt.barberName,
              services: appt.services,
            }),
            'utf8'
          ),
          contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
        },
      ],
    })
    return NextResponse.json({ sent: true })
  } catch (e) {
    console.error('[confirmar-email]', e)
    return NextResponse.json({ sent: false, reason: 'send_error' })
  }
}
