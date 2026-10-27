// ============================================================
// Turnero — acceso a datos (Fase 1: agenda del admin)
// ============================================================
// Envuelve las RPC de supabase/migrations/055_barber_schedules.sql y
// 056_appointments.sql. La garantía de que dos turnos no se superpongan vive
// en la base (restricción de exclusión), no acá: este módulo no valida
// disponibilidad, solo llama a la RPC y traduce el error si la base rechaza.
// ============================================================

import { supabase } from './supabase.client'

export type ScheduleMode = 'turno' | 'orden_llegada'
export type AppointmentStatus = 'reservado' | 'llego' | 'atendido' | 'no_vino' | 'cancelado'
export type AppointmentSource = 'publico' | 'admin' | 'barbero'

export interface BarberSchedule {
  id: string
  barber_id: string
  branch_id: string
  /** 0 = domingo .. 6 = sábado. */
  weekday: number
  start_time: string
  end_time: string
  mode: ScheduleMode
  slot_minutes: number | null
}

export interface ScheduleException {
  id: string
  branch_id: string
  barber_id: string | null
  exception_date: string
  closed_all_day: boolean
  start_time: string | null
  end_time: string | null
  reason: string | null
  /** Quién lo creó. Si coincide con `barber_id`, lo bloqueó el propio
   * barbero; si no, lo cargó un admin (las dos RPC de creación lo setean
   * así -- ver 055_barber_schedules.sql y 060_agenda_barbero.sql). */
  created_by: string | null
}

export interface AgendaAppointment {
  id: string
  barber_id: string
  barber_name: string
  client_name: string
  client_phone: string
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  source: AppointmentSource
  reference: string
  notes: string | null
  total_price: number
  services: { service_id: string; name: string; price: number; duration_min: number }[]
}

/** La agenda propia del barbero: no lleva barber_id/barber_name (ya se sabe
 * quién es), y sí transaction_id -- lo usa la UI para no ofrecer la precarga
 * del corte dos veces sobre el mismo turno. */
export interface BarberAgendaAppointment {
  id: string
  client_name: string
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  source: AppointmentSource
  reference: string
  notes: string | null
  total_price: number
  services: { service_id: string; name: string; price: number; duration_min: number }[]
  transaction_id: string | null
}

// ============================================================
// Horarios
// ============================================================

export async function getBarberSchedules(barberId: string): Promise<BarberSchedule[]> {
  const { data, error } = await supabase
    .from('barber_schedules')
    .select('id, barber_id, branch_id, weekday, start_time, end_time, mode, slot_minutes')
    .eq('barber_id', barberId)
    .order('weekday')
    .order('start_time')
  if (error) throw new Error(`[getBarberSchedules] ${error.message}`)
  return data as BarberSchedule[]
}

export async function createBarberSchedule(params: {
  barberId: string
  branchId: string
  weekday: number
  startTime: string
  endTime: string
  mode: ScheduleMode
  slotMinutes: number | null
}): Promise<void> {
  const { error } = await supabase.rpc('create_barber_schedule', {
    p_barber_id: params.barberId,
    p_branch_id: params.branchId,
    p_weekday: params.weekday,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_mode: params.mode,
    p_slot_minutes: params.slotMinutes,
  })
  if (error) throw new Error(error.message)
}

export interface FranjaInput {
  startTime: string
  endTime: string
  mode: ScheduleMode
  slotMinutes: number | null
}

/**
 * Carga masiva (100_calendario_por_sucursal_y_horario_masivo.sql): las
 * mismas franjas en varios días y para varios barberos, en una sola
 * transacción. Con `replace` primero borra lo que esos barberos tenían en
 * esos días; si algo se superpone no se guarda nada.
 */
export async function setBarberWeekSchedule(params: {
  branchId: string
  barberIds: string[]
  weekdays: number[]
  franjas: FranjaInput[]
  replace: boolean
}): Promise<{ created: number; deleted: number }> {
  const { data, error } = await supabase.rpc('set_barber_week_schedule', {
    p_branch_id: params.branchId,
    p_barber_ids: params.barberIds,
    p_weekdays: params.weekdays,
    p_franjas: params.franjas.map((f) => ({
      start_time: f.startTime,
      end_time: f.endTime,
      mode: f.mode,
      slot_minutes: f.mode === 'turno' ? f.slotMinutes : null,
    })),
    p_replace: params.replace,
  })
  if (error) throw new Error(error.message)
  return data as { created: number; deleted: number }
}

export async function deleteBarberSchedule(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_barber_schedule', { p_id: id })
  if (error) throw new Error(error.message)
}

// ============================================================
// Excepciones (feriados, "hoy se va antes", vacaciones)
// ============================================================

export async function getScheduleExceptions(
  branchId: string,
  fromDate: string,
): Promise<ScheduleException[]> {
  const { data, error } = await supabase
    .from('schedule_exceptions')
    .select('id, branch_id, barber_id, exception_date, closed_all_day, start_time, end_time, reason, created_by')
    .eq('branch_id', branchId)
    .gte('exception_date', fromDate)
    .order('exception_date')
  if (error) throw new Error(`[getScheduleExceptions] ${error.message}`)
  return data as ScheduleException[]
}

export async function createScheduleException(params: {
  branchId: string
  exceptionDate: string
  barberId?: string | null
  closedAllDay: boolean
  startTime?: string | null
  endTime?: string | null
  reason?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('create_schedule_exception', {
    p_branch_id: params.branchId,
    p_exception_date: params.exceptionDate,
    p_barber_id: params.barberId ?? null,
    p_closed_all_day: params.closedAllDay,
    p_start_time: params.startTime ?? null,
    p_end_time: params.endTime ?? null,
    p_reason: params.reason ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function deleteScheduleException(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_schedule_exception', { p_id: id })
  if (error) throw new Error(error.message)
}

// ============================================================
// Agenda / turnos
// ============================================================

export async function getAdminAgenda(branchId: string, date: string): Promise<AgendaAppointment[]> {
  const { data, error } = await supabase.rpc('get_admin_agenda', {
    p_branch_id: branchId,
    p_date: date,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as AgendaAppointment[]
}

/**
 * Crea un turno a mano. Devuelve el código de referencia para mostrárselo al
 * admin (ej. para mencionarlo si el cliente llama).
 *
 * Puede rechazar con un mensaje de "ese horario ya no está libre" si otro
 * turno se coló entre que se mostró el horario y se confirmó — es la
 * restricción de exclusión de la base actuando, no un bug.
 */
export async function createAppointmentAdmin(params: {
  branchId: string
  barberId: string
  clientName: string
  clientPhone: string
  startsAt: string
  serviceIds: string[]
  clientEmail?: string | null
  notes?: string | null
}): Promise<{ id: string; reference: string }> {
  const { data, error } = await supabase.rpc('create_appointment_admin', {
    p_branch_id: params.branchId,
    p_barber_id: params.barberId,
    p_client_name: params.clientName,
    p_client_phone: params.clientPhone,
    p_starts_at: params.startsAt,
    p_service_ids: params.serviceIds,
    p_client_email: params.clientEmail ?? null,
    p_notes: params.notes ?? null,
  })
  if (error) throw new Error(error.message)
  const row = (data as { id: string; reference: string }[])[0]
  return row
}

export async function moveAppointment(params: {
  appointmentId: string
  newStartsAt: string
  newBarberId?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('move_appointment', {
    p_appointment_id: params.appointmentId,
    p_new_starts_at: params.newStartsAt,
    p_new_barber_id: params.newBarberId ?? null,
  })
  if (error) throw new Error(error.message)
}

/**
 * Edita un turno: horario, barbero y (opcional) servicios, todo junto. Si no se
 * pasan `serviceIds` los servicios quedan como están. Requiere la migración
 * 098; la pantalla solo la llama cuando cambiaron los servicios -- para mover
 * horario o barbero sigue usando moveAppointment.
 */
export async function editAppointment(params: {
  appointmentId: string
  newStartsAt: string
  newBarberId?: string | null
  serviceIds?: string[] | null
}): Promise<void> {
  const { error } = await supabase.rpc('edit_appointment', {
    p_appointment_id: params.appointmentId,
    p_new_starts_at: params.newStartsAt,
    p_new_barber_id: params.newBarberId ?? null,
    p_service_ids: params.serviceIds ?? null,
  })
  if (error) throw new Error(error.message)
}

/** Lo mismo que editAppointment pero para el barbero, sobre sus propios turnos
 * (no cambia de barbero). Requiere la migración 098. */
export async function editAppointmentBarber(params: {
  appointmentId: string
  newStartsAt: string
  serviceIds?: string[] | null
}): Promise<void> {
  const { error } = await supabase.rpc('edit_appointment_barber', {
    p_appointment_id: params.appointmentId,
    p_new_starts_at: params.newStartsAt,
    p_service_ids: params.serviceIds ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function cancelAppointment(appointmentId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_appointment', {
    p_appointment_id: appointmentId,
    p_reason: reason ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function setAppointmentStatus(
  appointmentId: string,
  status: Exclude<AppointmentStatus, 'reservado'>,
): Promise<void> {
  const { error } = await supabase.rpc('set_appointment_status', {
    p_appointment_id: appointmentId,
    p_status: status,
  })
  if (error) throw new Error(error.message)
}

// ============================================================
// Agenda del barbero (Fase 3)
// ============================================================

export async function getBarberAgenda(date: string): Promise<BarberAgendaAppointment[]> {
  const { data, error } = await supabase.rpc('get_barber_agenda', { p_date: date })
  if (error) throw new Error(error.message)
  return (data ?? []) as BarberAgendaAppointment[]
}

/**
 * El barbero agenda a mano para el cliente que llamó por teléfono. Mismo
 * comportamiento que createAppointmentAdmin, pero siempre para sí mismo.
 */
export async function createAppointmentBarber(params: {
  clientName: string
  clientPhone: string
  startsAt: string
  serviceIds: string[]
  clientEmail?: string | null
  notes?: string | null
}): Promise<{ id: string; reference: string }> {
  const { data, error } = await supabase.rpc('create_appointment_barber', {
    p_client_name: params.clientName,
    p_client_phone: params.clientPhone,
    p_starts_at: params.startsAt,
    p_service_ids: params.serviceIds,
    p_client_email: params.clientEmail ?? null,
    p_notes: params.notes ?? null,
  })
  if (error) throw new Error(error.message)
  const row = (data as { id: string; reference: string }[])[0]
  return row
}

/** "Hoy me voy antes", "salgo a comer", franco puntual. Siempre sobre el
 * propio horario del barbero -- bloquear el de otro o el de toda la
 * sucursal sigue siendo exclusivo del admin (createScheduleException). */
export async function createScheduleExceptionBarber(params: {
  exceptionDate: string
  closedAllDay: boolean
  startTime?: string | null
  endTime?: string | null
  reason?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('create_schedule_exception_barber', {
    p_exception_date: params.exceptionDate,
    p_closed_all_day: params.closedAllDay,
    p_start_time: params.startTime ?? null,
    p_end_time: params.endTime ?? null,
    p_reason: params.reason ?? null,
  })
  if (error) throw new Error(error.message)
}

/**
 * El puente con el gestor (docs/turnero_plan.md sección 5). Se llama SOLO
 * cuando el barbero confirma la precarga del corte, nunca automático. La
 * base rechaza si el turno ya tenía un corte vinculado o si el corte es de
 * otro barbero -- acá solo se traduce el error.
 */
export async function linkAppointmentTransaction(
  appointmentId: string,
  transactionId: string,
): Promise<void> {
  const { error } = await supabase.rpc('link_appointment_transaction', {
    p_appointment_id: appointmentId,
    p_transaction_id: transactionId,
  })
  if (error) throw new Error(error.message)
}

// ============================================================
// Etiquetas para la UI
// ============================================================

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  reservado: 'Reservado',
  llego: 'Llegó',
  atendido: 'Atendido',
  no_vino: 'No vino',
  cancelado: 'Cancelado',
}

export const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
