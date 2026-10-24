// ============================================================
// Número de WhatsApp desde el que sale cada aviso (SOLO servidor).
//
// Cada sucursal puede tener su propio número de la Cloud API de Meta
// (branches.whatsapp_phone_number_id, migración 112). Si no lo tiene, se usa
// WHATSAPP_PHONE_NUMBER_ID del entorno: es lo que usan las instalaciones con
// un solo número. En una instalación multi-número conviene no definir esa
// variable, así una sucursal sin configurar no manda desde el número de otra.
// ============================================================

import { serviceRoleClient } from '@/lib/api-admin'

/** Phone Number ID de Meta para esa sucursal, o null si no hay ninguno configurado. */
export async function resolveSenderPhoneNumberId(branchId: string): Promise<string | null> {
  const { data, error } = await serviceRoleClient()
    .from('branches')
    .select('whatsapp_phone_number_id')
    .eq('id', branchId)
    .maybeSingle()
  if (error) console.error('[whatsapp-sender] no se pudo leer el número de la sucursal:', error.message)
  return data?.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || null
}
