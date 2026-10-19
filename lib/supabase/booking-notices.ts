// ============================================================
// Datos de un turno para los avisos automáticos (mail / WhatsApp) que
// disparan las rutas públicas de /api/reservar. SOLO servidor: usa el
// service role.
//
// Todo sale de la base, nada del body: antes el destinatario del mail y el
// nombre de la sucursal los mandaba el navegador, así que cualquiera con una
// reserva propia podía mandar mails con el HTML que quisiera a cualquier
// dirección, desde el dominio de la barbería (auditoría 2026-09-29).
// ============================================================

import { serviceRoleClient } from '@/lib/api-admin'

export interface AppointmentNotice {
  id: string
  reference: string
  startsAt: string
  endsAt: string
  status: string
  createdAt: string
  branchId: string
  branchName: string
  barberName: string
  clientName: string
  clientEmail: string | null
  services: { name: string; price: number }[]
  totalPrice: number
}

/** Busca el turno por referencia + teléfono (los dos tienen que coincidir). */
export async function findAppointmentForNotice(
  reference: string,
  phone: string,
): Promise<AppointmentNotice | null> {
  const db = serviceRoleClient()

  const { data: appt } = await db
    .from('appointments')
    .select('id, reference, starts_at, ends_at, status, created_at, branch_id, barber_id, client_id')
    .eq('reference', reference.trim().toUpperCase())
    .maybeSingle()
  if (!appt) return null

  const { data: client } = await db
    .from('appointment_clients')
    .select('full_name, phone, email')
    .eq('id', appt.client_id)
    .maybeSingle()
  if (!client || client.phone !== phone.trim()) return null

  const [{ data: branch }, { data: barber }, { data: services }] = await Promise.all([
    db.from('branches').select('name').eq('id', appt.branch_id).maybeSingle(),
    db.from('profiles').select('full_name').eq('id', appt.barber_id).maybeSingle(),
    db.from('appointment_services')
      .select('service_name, price')
      .eq('appointment_id', appt.id)
      .order('created_at'),
  ])

  const lista = (services ?? []).map((s) => ({ name: s.service_name as string, price: Number(s.price) }))

  return {
    id: appt.id,
    reference: appt.reference,
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
    status: appt.status,
    createdAt: appt.created_at,
    branchId: appt.branch_id,
    branchName: branch?.name ?? 'la barbería',
    barberName: barber?.full_name ?? '',
    clientName: client.full_name,
    clientEmail: client.email,
    services: lista,
    totalPrice: lista.reduce((acc, s) => acc + s.price, 0),
  }
}

export type NoticeColumn =
  | 'confirmation_email_sent_at'
  | 'confirmation_whatsapp_sent_at'
  | 'cancellation_whatsapp_sent_at'

/**
 * Marca el aviso como enviado y devuelve true solo la PRIMERA vez (update
 * condicionado a que la columna esté vacía). Si el envío después falla, el
 * aviso no se reintenta — preferible a que la ruta sirva para mandar en loop.
 */
export async function claimNotice(appointmentId: string, column: NoticeColumn): Promise<boolean> {
  const db = serviceRoleClient()
  const { data } = await db
    .from('appointments')
    .update({ [column]: new Date().toISOString() })
    .eq('id', appointmentId)
    .is(column, null)
    .select('id')
  return (data ?? []).length > 0
}

/** Escapa texto para meterlo en el HTML de un mail. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
