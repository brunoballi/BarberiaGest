// ============================================================
// Estado de entrega de los WhatsApp (lado del admin).
// Lee whatsapp_messages (migración 110), que llena el webhook de Meta.
//
// Si la tabla todavía no existe o la consulta falla, devuelve vacío: la
// agenda funciona igual, simplemente sin el indicador de entrega.
// ============================================================

import { supabase } from './supabase.client'

export type WhatsAppDeliveryStatus = 'accepted' | 'sent' | 'delivered' | 'read' | 'failed'
export type WhatsAppMessageKind = 'confirmacion' | 'recordatorio' | 'cancelacion' | 'difusion' | 'aviso_barbero'

export interface WhatsAppDelivery {
  appointment_id: string
  kind: WhatsAppMessageKind
  status: WhatsAppDeliveryStatus
  error_code: number | null
  error_title: string | null
}

export const WHATSAPP_KIND_LABELS: Record<WhatsAppMessageKind, string> = {
  confirmacion: 'Confirmación',
  recordatorio: 'Recordatorio',
  cancelacion: 'Cancelación',
  difusion: 'Difusión',
  aviso_barbero: 'Aviso del barbero',
}

export const WHATSAPP_STATUS_LABELS: Record<WhatsAppDeliveryStatus, string> = {
  accepted: 'enviándose',
  sent: 'enviado',
  delivered: 'entregado',
  read: 'leído',
  failed: 'no llegó',
}

/**
 * Causas más comunes de "no llegó", en lenguaje de barbería. Los códigos son
 * los de la Cloud API de Meta; para cualquier otro se muestra el título que
 * mande Meta.
 */
const ERROR_HINTS: Record<number, string> = {
  131042: 'La cuenta de WhatsApp Business no tiene un método de pago válido en Meta.',
  131026: 'Ese número no tiene WhatsApp o no pudo recibir el mensaje.',
  131049: 'Meta frenó el envío para cuidar la calidad de la cuenta.',
  132000: 'Los datos del mensaje no coinciden con la plantilla.',
  132001: 'La plantilla no existe o todavía no está aprobada.',
  132015: 'La plantilla está pausada por Meta.',
}

export function whatsappErrorHint(code: number | null, title: string | null): string {
  if (code != null && ERROR_HINTS[code]) return ERROR_HINTS[code]
  return title ?? 'Meta no pudo entregar el mensaje.'
}

export async function getWhatsAppDeliveries(appointmentIds: string[]): Promise<Map<string, WhatsAppDelivery[]>> {
  const out = new Map<string, WhatsAppDelivery[]>()
  if (appointmentIds.length === 0) return out

  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('appointment_id, kind, status, error_code, error_title')
    .in('appointment_id', appointmentIds)
    .order('created_at')
  if (error) {
    console.warn('[getWhatsAppDeliveries]', error.message)
    return out
  }

  for (const row of (data ?? []) as WhatsAppDelivery[]) {
    const list = out.get(row.appointment_id) ?? []
    list.push(row)
    out.set(row.appointment_id, list)
  }
  return out
}

export interface WhatsAppFailureSummary {
  count: number
  lastCode: number | null
  lastTitle: string | null
}

/** Mensajes que fallaron en los últimos `days` días en la sucursal. */
export async function getRecentWhatsAppFailures(branchId: string, days = 7): Promise<WhatsAppFailureSummary> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('error_code, error_title')
    .eq('branch_id', branchId)
    .eq('status', 'failed')
    .gte('created_at', since)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) {
    console.warn('[getRecentWhatsAppFailures]', error.message)
    return { count: 0, lastCode: null, lastTitle: null }
  }
  const rows = (data ?? []) as { error_code: number | null; error_title: string | null }[]
  return { count: rows.length, lastCode: rows[0]?.error_code ?? null, lastTitle: rows[0]?.error_title ?? null }
}
