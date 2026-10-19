// ============================================================
// Registro de mensajes de WhatsApp enviados (SOLO servidor).
//
// Meta acepta el pedido de envío de forma síncrona, pero la entrega real (y
// los errores como "falta método de pago") llegan después por el webhook de
// estados. Para poder cruzar uno con otro, cada envío guarda el `wamid`
// que devolvió Meta junto con el turno al que pertenece. Ver migración 110.
//
// Es de mejor esfuerzo a propósito: si el registro falla, el mensaje ya
// salió y no hay nada que reintentar -- solo se pierde el seguimiento.
// ============================================================

import { serviceRoleClient } from '@/lib/api-admin'

export type WhatsAppKind = 'confirmacion' | 'recordatorio' | 'cancelacion' | 'difusion'

export async function registerWhatsAppMessage(params: {
  wamid: string
  branchId: string
  appointmentId: string | null
  kind: WhatsAppKind
  recipient: string
}): Promise<void> {
  if (!params.wamid) return
  try {
    const { error } = await serviceRoleClient().rpc('register_whatsapp_message', {
      p_wamid: params.wamid,
      p_branch_id: params.branchId,
      p_appointment_id: params.appointmentId,
      p_kind: params.kind,
      p_recipient: params.recipient,
    })
    if (error) console.error('[whatsapp-log] no se pudo registrar el envío:', error.message)
  } catch (e) {
    console.error('[whatsapp-log] no se pudo registrar el envío:', e instanceof Error ? e.message : e)
  }
}

export interface WhatsAppStatusUpdate {
  wamid: string
  status: string
  recipient: string | null
  errorCode: number | null
  errorTitle: string | null
  errorDetail: string | null
}

/** Vuelca un estado que informó Meta. Devuelve false si la base falló (el webhook responde 500 y Meta reintenta). */
export async function recordWhatsAppStatus(u: WhatsAppStatusUpdate): Promise<boolean> {
  const { error } = await serviceRoleClient().rpc('record_whatsapp_status', {
    p_wamid: u.wamid,
    p_status: u.status,
    p_recipient: u.recipient,
    p_error_code: u.errorCode,
    p_error_title: u.errorTitle,
    p_error_detail: u.errorDetail,
  })
  if (error) {
    console.error('[whatsapp-log] no se pudo registrar el estado:', error.message)
    return false
  }
  return true
}
