// ============================================================
// Base de clientes del turnero (lado del admin).
// Envuelve list_appointment_clients (migración 111).
// ============================================================

import { supabase } from './supabase.client'

export interface AppointmentClient {
  client_id: string
  full_name: string
  /** Canónico: +54 + área + número, sin el 9 (ver normalizePhone). */
  phone: string
  email: string | null
  created_at: string
  total_turnos: number
  atendidos: number
  no_vino: number
  cancelados: number
  /** Última vez que vino de verdad (atendido o llegó). */
  ultimo_turno: string | null
  /** Próximo turno reservado, si tiene uno por delante. */
  proximo_turno: string | null
}

export async function listAppointmentClients(branchId: string): Promise<AppointmentClient[]> {
  const { data, error } = await supabase.rpc('list_appointment_clients', { p_branch_id: branchId })
  if (error) throw new Error(error.message)
  return (data ?? []) as AppointmentClient[]
}
