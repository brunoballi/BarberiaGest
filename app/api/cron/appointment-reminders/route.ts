// ============================================================
// Recordatorio de turno, 1 hora antes — disparado por GitHub Actions.
//
// Vercel Hobby (el plan de este proyecto) solo permite cron jobs UNA VEZ
// POR DÍA — inservible para algo que tiene que dispararse cada 5-10
// minutos. Por eso el disparador vive en
// .github/workflows/appointment-reminders.yml (gratis, sin límite de
// frecuencia) y le pega a este endpoint por HTTP, protegido con
// CRON_SECRET -- mismo mecanismo que documenta Vercel para sus propios
// crons (vercel.com/docs/cron-jobs → "Securing cron jobs"), aunque acá
// el llamador sea GitHub y no Vercel.
//
// Nunca falla el batch entero por un turno: cada envío va en su propio
// try/catch, así un teléfono roto en un turno no le hace perder el
// recordatorio a los demás.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendTemplateMessage, isWhatsAppConfigured, toWhatsAppRecipient, WhatsAppError } from '@/lib/whatsapp'
import { resolveSenderPhoneNumberId } from '@/lib/whatsapp-sender'
import { registerWhatsAppMessage } from '@/lib/whatsapp-log'
import { hora, primerNombre } from '@/lib/whatsapp-format'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface DueAppointment {
  appointment_id: string
  reference: string
  starts_at: string
  client_name: string
  client_phone: string
  branch_id: string
  branch_name: string
  services: string | null
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (!isWhatsAppConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'whatsapp_not_configured', sent: 0, failed: 0 })
  }

  const db = adminClient()

  const { data, error } = await db.rpc('get_appointments_due_for_reminder', { p_minutes_ahead: 60 })
  if (error) {
    console.error('[appointment-reminders] error consultando turnos', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // Solo se recuerdan los turnos reservados desde la web pública. Los que carga
  // el admin o el barbero a mano ya los conocen todas las partes: se dejan
  // asentados en el sistema y no se le avisa al cliente (decisión de Bruno,
  // 2026-10-07). Se filtra acá y no en get_appointments_due_for_reminder para
  // no tocar la base; esos turnos quedan sin reminder_sent_at y se vuelven a
  // descartar en cada corrida hasta que pase su hora.
  const candidatos = (data ?? []) as DueAppointment[]
  let due = candidatos
  if (candidatos.length > 0) {
    const { data: origen, error: origenError } = await db
      .from('appointments')
      .select('id')
      .in('id', candidatos.map((c) => c.appointment_id))
      .eq('source', 'publico')
    if (origenError) {
      console.error('[appointment-reminders] error consultando el origen de los turnos', origenError)
      return NextResponse.json({ ok: false, error: origenError.message }, { status: 500 })
    }
    const publicos = new Set((origen ?? []).map((o: { id: string }) => o.id))
    due = candidatos.filter((c) => publicos.has(c.appointment_id))
  }
  let sent = 0
  const omitidos = candidatos.length - due.length
  const failed: { reference: string; reason: string }[] = []

  // Un número por sucursal: se resuelve una vez por sucursal y por corrida.
  const numeros = new Map<string, string | null>()

  for (const appt of due) {
    if (!numeros.has(appt.branch_id)) {
      numeros.set(appt.branch_id, await resolveSenderPhoneNumberId(appt.branch_id))
    }
    const phoneNumberId = numeros.get(appt.branch_id)
    if (!phoneNumberId) {
      failed.push({ reference: appt.reference, reason: 'sucursal_sin_numero' })
      continue
    }

    const destinatario = toWhatsAppRecipient(appt.client_phone)
    if (!destinatario) {
      failed.push({ reference: appt.reference, reason: 'telefono_invalido' })
      continue
    }

    try {
      // El ORDEN tiene que coincidir con los {{1}}, {{2}}... de la
      // plantilla "recordatorio_turno_v4" aprobada en Meta -- ver
      // docs/whatsapp_templates.md. El botón "Gestionar mi turno" usa su
      // propia numeración ({{1}} del componente button, no del body) --
      // mismo valor que ya arma confirmar-whatsapp/route.ts.
      const { messageId } = await sendTemplateMessage({
        phoneNumberId,
        to: destinatario,
        templateName: 'recordatorio_turno_v4',
        bodyParams: [primerNombre(appt.client_name), appt.branch_name, hora(appt.starts_at), appt.services ?? ''],
        buttonUrlParam: `${appt.reference}&sucursal=${appt.branch_id}`,
      })
      await registerWhatsAppMessage({ wamid: messageId, branchId: appt.branch_id, appointmentId: appt.appointment_id, kind: 'recordatorio', recipient: destinatario })

      // Se marca ANTES de nada más: si el update fallara y el envío ya
      // salió, es preferible arriesgar no reintentar (recordatorio de
      // más se nota, recordatorio duplicado molesta) a mandarlo dos veces.
      await db.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', appt.appointment_id)
      sent++
    } catch (e) {
      const reason = e instanceof WhatsAppError ? e.message : e instanceof Error ? e.message : 'error desconocido'
      console.error('[appointment-reminders]', appt.reference, reason)
      failed.push({ reference: appt.reference, reason })
    }
  }

  return NextResponse.json({ ok: true, encontrados: due.length, omitidos, sent, failed })
}
