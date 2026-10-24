// ============================================================
// Aviso del barbero al cliente de un turno (turnero en prueba).
//
// El barbero no ve el teléfono del cliente. Pide el envío con el id del turno y
// el tipo de mensaje; este servidor busca el número con la clave de servicio,
// manda una plantilla aprobada desde el WhatsApp de la sucursal y le devuelve
// solo "enviado" o el motivo por el que no. El número nunca sale de acá.
//
// Controles: barbero logueado y activo; el turno es SUYO; estado y horario
// (motivoNoAvisable); un solo aviso por turno; mensajes fijos (AVISOS_BARBERO).
//
// MODO PRUEBA: por defecto NO se envía nada. Hace todos los controles y devuelve
// { prueba: true }. Solo manda de verdad con TURNERO_AVISOS_BARBERO=real y
// WhatsApp configurado (WHATSAPP_ACCESS_TOKEN + número de la sucursal).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { serviceRoleClient } from '@/lib/api-admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { turneroApiGate } from '@/lib/turnero-guard'
import { sendTemplateMessage, isWhatsAppConfigured, toWhatsAppRecipient, WhatsAppError } from '@/lib/whatsapp'
import { resolveSenderPhoneNumberId } from '@/lib/whatsapp-sender'
import { registerWhatsAppMessage } from '@/lib/whatsapp-log'
import { hora, primerNombre } from '@/lib/whatsapp-format'
import { AVISOS_BARBERO, motivoNoAvisable } from '@/lib/aviso-barbero'

interface TurnoParaAviso {
  id: string
  branch_id: string
  barber_id: string
  status: string
  starts_at: string
  reference: string
  client: { full_name: string; phone: string } | null
  branch: { name: string } | null
}

export async function POST(request: NextRequest) {
  const gate = await turneroApiGate()
  if (gate) return gate

  // Quién llama: sesión de la app (no se acepta ningún id de barbero en el body).
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: { appointmentId?: string; tipo?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }
  const aviso = AVISOS_BARBERO.find((a) => a.tipo === body.tipo)
  if (typeof body.appointmentId !== 'string' || !body.appointmentId || !aviso) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  }

  const admin = serviceRoleClient()

  const { data: perfil } = await admin
    .from('profiles')
    .select('role, is_barber, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (!perfil || !perfil.is_active || !(perfil.role === 'barber' || perfil.is_barber)) {
    return NextResponse.json({ error: 'Solo los barberos pueden avisar a sus clientes' }, { status: 403 })
  }

  const { data: turno } = await admin
    .from('appointments')
    .select('id, branch_id, barber_id, status, starts_at, reference, client:appointment_clients(full_name, phone), branch:branches(name)')
    .eq('id', body.appointmentId)
    .maybeSingle<TurnoParaAviso>()
  // Un turno de otro barbero responde igual que uno inexistente.
  if (!turno || turno.barber_id !== user.id || !turno.client) {
    return NextResponse.json({ sent: false, reason: 'no_encontrado' }, { status: 404 })
  }

  const motivo = motivoNoAvisable(turno)
  if (motivo) return NextResponse.json({ sent: false, reason: motivo })

  const { count } = await admin
    .from('whatsapp_messages')
    .select('wamid', { count: 'exact', head: true })
    .eq('appointment_id', turno.id)
    .eq('kind', 'aviso_barbero')
  if ((count ?? 0) > 0) return NextResponse.json({ sent: false, reason: 'ya_enviado' })

  const destinatario = toWhatsAppRecipient(turno.client.phone)
  if (!destinatario) return NextResponse.json({ sent: false, reason: 'telefono_invalido' })

  // Modo prueba (por defecto): todos los controles pasaron, pero no se manda nada.
  if (process.env.TURNERO_AVISOS_BARBERO !== 'real') {
    return NextResponse.json({ sent: false, prueba: true, reason: 'modo_prueba' })
  }
  if (!isWhatsAppConfigured()) return NextResponse.json({ sent: false, reason: 'not_configured' })
  const phoneNumberId = await resolveSenderPhoneNumberId(turno.branch_id)
  if (!phoneNumberId) return NextResponse.json({ sent: false, reason: 'sucursal_sin_numero' })

  try {
    // El ORDEN de bodyParams tiene que coincidir con {{1}}, {{2}}... de la plantilla
    // (lib/whatsapp-templates.ts): nombre, sucursal, hora del turno.
    const { messageId } = await sendTemplateMessage({
      phoneNumberId,
      to: destinatario,
      templateName: aviso.plantilla,
      bodyParams: [primerNombre(turno.client.full_name), turno.branch?.name ?? '', hora(turno.starts_at)],
      buttonUrlParam: `${turno.reference}&sucursal=${turno.branch_id}`,
    })
    await registerWhatsAppMessage({
      wamid: messageId,
      branchId: turno.branch_id,
      appointmentId: turno.id,
      kind: 'aviso_barbero',
      recipient: destinatario,
    })
    return NextResponse.json({ sent: true })
  } catch (e) {
    console.error('[turnos/mensaje]', e instanceof WhatsAppError ? e.message : e)
    return NextResponse.json({ sent: false, reason: 'send_error' })
  }
}
