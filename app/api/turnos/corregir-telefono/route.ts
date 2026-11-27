// ============================================================
// El administrador corrige el teléfono de un turno cuyo WhatsApp no llegó y
// se reenvía la confirmación.
//
// Controles: admin activo de la sucursal del turno; turno todavía reservado y a
// futuro; el ÚLTIMO WhatsApp del turno figura como fallido (así la ruta no
// sirve para mandar mensajes en cualquier momento ni dos veces seguidas: tras
// el reenvío el último queda "enviándose").
//
// El teléfono identifica al cliente (unique branch_id + phone), así que no
// alcanza con pisar el número:
//   · si el número nuevo ya es de un cliente de la sucursal, el turno pasa a
//     ese cliente (igual que si hubiera reservado bien desde el principio);
//   · si el cliente solo tiene este turno, se le corrige el número;
//   · si tiene otros turnos, se crea un cliente nuevo para no tocar los demás.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-admin'
import { turneroApiGate } from '@/lib/turnero-guard'
import { isWhatsAppConfigured, toWhatsAppRecipient, WhatsAppError } from '@/lib/whatsapp'
import { resolveSenderPhoneNumberId } from '@/lib/whatsapp-sender'
import { findAppointmentForNotice } from '@/lib/supabase/booking-notices'
import { enviarConfirmacionTurno } from '@/lib/whatsapp-confirmacion'

const error = (mensaje: string, status: number) => NextResponse.json({ error: mensaje }, { status })
const NO_GUARDADO = 'No se pudo guardar el número. Probá de nuevo.'

export async function POST(request: NextRequest) {
  const gate = await turneroApiGate()
  if (gate) return gate

  const caller = await requireAdmin()
  if (caller instanceof NextResponse) return caller
  const db = caller.adminClient

  let body: { appointmentId?: unknown; phone?: unknown }
  try {
    body = await request.json()
  } catch {
    return error('Datos inválidos', 400)
  }
  const { appointmentId, phone } = body
  if (typeof appointmentId !== 'string' || !appointmentId || typeof phone !== 'string') {
    return error('Datos inválidos', 400)
  }
  // Forma canónica que guarda PhoneInput: +54 y los 10 dígitos (área + número).
  const destinatario = /^\+54\d{10}$/.test(phone) ? toWhatsAppRecipient(phone) : null
  if (!destinatario) return error('El número tiene que tener 10 dígitos: código de área y número.', 400)

  const { data: turno } = await db
    .from('appointments')
    .select('id, branch_id, client_id, status, starts_at, reference')
    .eq('id', appointmentId)
    .maybeSingle()
  // Un turno de otra sucursal responde igual que uno inexistente.
  if (!turno || !caller.branchIds.has(turno.branch_id)) return error('No encontramos el turno.', 404)
  if (turno.status !== 'reservado' || new Date(turno.starts_at).getTime() <= Date.now()) {
    return error('Solo se puede corregir un turno reservado que todavía no pasó.', 409)
  }

  const { data: ultimo, error: errorUltimo } = await db
    .from('whatsapp_messages')
    .select('status')
    .eq('appointment_id', turno.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (errorUltimo) return error(NO_GUARDADO, 500)
  if (ultimo?.status !== 'failed') return error('El último WhatsApp de este turno no figura como fallido.', 409)

  const { data: cliente } = await db
    .from('appointment_clients')
    .select('id, full_name, phone, email')
    .eq('id', turno.client_id)
    .maybeSingle()
  if (!cliente) return error('No encontramos el cliente del turno.', 404)

  if (cliente.phone !== phone) {
    const { data: existente, error: errorExistente } = await db
      .from('appointment_clients')
      .select('id, email')
      .eq('branch_id', turno.branch_id)
      .eq('phone', phone)
      .maybeSingle()
    if (errorExistente) return error(NO_GUARDADO, 500)

    let nuevoClienteId: string | null = null

    if (existente) {
      const { error: e } = await db
        .from('appointment_clients')
        .update({ full_name: cliente.full_name, email: cliente.email ?? existente.email })
        .eq('id', existente.id)
      if (e) return error(NO_GUARDADO, 500)
      nuevoClienteId = existente.id
    } else {
      const { count, error: errorCount } = await db
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', cliente.id)
        .neq('id', turno.id)
      if (errorCount) return error(NO_GUARDADO, 500)

      if ((count ?? 0) === 0) {
        const { error: e } = await db.from('appointment_clients').update({ phone }).eq('id', cliente.id)
        if (e) return error(NO_GUARDADO, 500)
      } else {
        const { data: creado, error: e } = await db
          .from('appointment_clients')
          .insert({ branch_id: turno.branch_id, full_name: cliente.full_name, phone, email: cliente.email })
          .select('id')
          .single()
        if (e || !creado) return error(NO_GUARDADO, 500)
        nuevoClienteId = creado.id
      }
    }

    if (nuevoClienteId) {
      const { error: e } = await db.from('appointments').update({ client_id: nuevoClienteId }).eq('id', turno.id)
      if (e) return error(NO_GUARDADO, 500)
    }
    console.log('[turnos/corregir-telefono] número corregido', { turno: turno.reference, admin: caller.user.id })
  }

  // A partir de acá el número ya quedó guardado: un fallo del envío no es un error de la corrección.
  const sinEnvio = (motivo: string) => NextResponse.json({ saved: true, sent: false, reason: motivo })
  if (!isWhatsAppConfigured()) return sinEnvio('not_configured')
  const phoneNumberId = await resolveSenderPhoneNumberId(turno.branch_id)
  if (!phoneNumberId) return sinEnvio('sucursal_sin_numero')
  const aviso = await findAppointmentForNotice(turno.reference, phone)
  if (!aviso) return sinEnvio('not_found')

  try {
    await enviarConfirmacionTurno(aviso, destinatario, phoneNumberId)
    return NextResponse.json({ saved: true, sent: true })
  } catch (e) {
    console.error('[turnos/corregir-telefono]', e instanceof WhatsAppError ? e.message : e)
    return sinEnvio('send_error')
  }
}
