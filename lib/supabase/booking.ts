// ============================================================
// Reserva pública — acceso a datos (Fase 2)
// ============================================================
// Envuelve las RPC de 059_reserva_publica.sql. Todo se resuelve con la clave
// anónima y SIN sesión: es la única parte del sistema que funciona así.
//
// Ninguna de estas funciones toca una tabla directo. El rol `anon` no tiene
// acceso a ninguna: si mañana alguien agrega acá un `.from('appointments')`,
// no va a devolver nada (RLS lo bloquea) — y está bien que así sea.
// ============================================================

import { supabase } from './supabase.client'

/** Horario de un día de la semana. weekday: 0=domingo..6=sábado (mismo
 * criterio que barber_schedules y extract(dow)). "00:00"/"00:00" = cerrado
 * ese día o sin configurar -- ver 098_horario_de_atencion.sql. */
export interface DayHours {
  weekday: number
  open: string
  close: string
}

export interface PublicBranch {
  id: string
  name: string
  address: string | null
  /** Marca editable desde /admin/marca. Los tres pueden ser null: la portada
   * cae al comportamiento de siempre (nombre + dirección) si no se configuró
   * nada. */
  logo_url: string | null
  welcome_title: string | null
  welcome_description: string | null
  /** WhatsApp de la barbería, solo dígitos. Null si no lo cargaron: en ese
   * caso la confirmación no muestra el botón de WhatsApp. */
  whatsapp_phone: string | null
  /** Para el mapa del selector de sucursales. Null si el admin no las cargó
   * en /admin/marca -- esa sucursal simplemente no aparece en el mapa. */
  latitude: number | null
  longitude: number | null
  /** Siempre son 7 elementos (los 7 días), cargado a mano en /admin/marca. */
  business_hours: DayHours[]
}

/** Encabezado general del selector de sucursales (097_encabezado_y_mapa_reserva.sql):
 * nombre y logo de LA sucursal marcada como fuente del encabezado, si hay
 * alguna. Sin ninguna marcada, la pantalla no muestra encabezado extra. */
export interface BookingHeader {
  title: string
  logo_url: string | null
}

export interface BookableService {
  id: string
  name: string
  description: string | null
  base_price: number
  duration_min: number
}

export interface PublicBarber {
  id: string
  full_name: string
  avatar_url: string | null
}

export interface WalkinWindow {
  barber_id: string
  barber_name: string
  start_time: string
  end_time: string
}

/** Valor de barberId para "sin preferencia": la base asigna un barbero libre
 * al confirmar (113_reserva_sin_preferencia_de_barbero.sql). */
export const BARBER_ANY = 'any'

export type SlotPeriod = 'manana' | 'tarde' | 'noche'

export interface AvailableSlot {
  slot_at: string
  period: SlotPeriod
}

export interface BookingResult {
  reference: string
  starts_at: string
  ends_at: string
}

export interface AppointmentLookup {
  reference: string
  starts_at: string
  ends_at: string
  status: string
  barber_name: string
  client_name: string
  total_price: number
  services: { name: string; price: number; duration_min?: number }[]
  /** Desde 114_detalle_del_turno_con_cancelacion.sql. Opcionales: si la base
   * todavía no tiene esa migración, la pantalla sale igual, sin esos datos. */
  branch_name?: string | null
  branch_address?: string | null
  branch_latitude?: number | null
  branch_longitude?: number | null
  created_at?: string
  /** null en turnos cancelados antes de la 114: no se inventa una fecha. */
  cancelled_at?: string | null
}

export async function getPublicBranch(branchId?: string): Promise<PublicBranch | null> {
  const { data, error } = await supabase.rpc('get_public_branch', {
    p_branch_id: branchId ?? null,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as PublicBranch[])[0] ?? null
}

/**
 * Todas las sucursales activas, para el selector de /reservar cuando hay más
 * de una. Con una sola, la pantalla ni la muestra -- ver booking-view.tsx.
 */
export async function listPublicBranches(): Promise<PublicBranch[]> {
  const { data, error } = await supabase.rpc('list_public_branches')
  if (error) throw new Error(error.message)
  return (data ?? []) as PublicBranch[]
}

/** Encabezado general del selector de sucursales, o null si ninguna
 * sucursal está marcada como fuente (comportamiento de siempre). */
export async function getBookingHeader(): Promise<BookingHeader | null> {
  const { data, error } = await supabase.rpc('get_booking_header')
  if (error) throw new Error(error.message)
  return ((data ?? []) as BookingHeader[])[0] ?? null
}

export async function getBookableServices(branchId: string): Promise<BookableService[]> {
  const { data, error } = await supabase.rpc('get_bookable_services', { p_branch_id: branchId })
  if (error) throw new Error(error.message)
  return (data ?? []) as BookableService[]
}

/** Id del servicio más pedido de la sucursal en los últimos 30 días, o null si
 * todavía no hay historial suficiente (la pantalla no muestra etiqueta). */
export async function getPopularServiceId(branchId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_popular_service', { p_branch_id: branchId })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

export async function getPublicBarbers(branchId: string): Promise<PublicBarber[]> {
  const { data, error } = await supabase.rpc('get_public_barbers', { p_branch_id: branchId })
  if (error) throw new Error(error.message)
  return (data ?? []) as PublicBarber[]
}

/** Franjas por orden de llegada: informativas, no se reservan. */
export async function getWalkinWindows(branchId: string, date: string): Promise<WalkinWindow[]> {
  const { data, error } = await supabase.rpc('get_walkin_windows', {
    p_branch_id: branchId,
    p_date: date,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as WalkinWindow[]
}

/**
 * Horarios libres. El cálculo lo hace la base, no el navegador: acá solo se
 * muestra lo que devuelve. Con barberId = BARBER_ANY devuelve los horarios
 * libres de cualquiera de los barberos de la sucursal.
 */
export async function getAvailableSlots(params: {
  branchId: string
  barberId: string
  date: string
  serviceIds: string[]
}): Promise<AvailableSlot[]> {
  if (params.barberId === BARBER_ANY) {
    const { data, error } = await supabase.rpc('get_available_slots_any', {
      p_branch_id: params.branchId,
      p_date: params.date,
      p_service_ids: params.serviceIds,
    })
    if (error) throw new Error(error.message)
    return (data ?? []) as AvailableSlot[]
  }
  const { data, error } = await supabase.rpc('get_available_slots', {
    p_branch_id: params.branchId,
    p_barber_id: params.barberId,
    p_date: params.date,
    p_service_ids: params.serviceIds,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as AvailableSlot[]
}

/**
 * Crea la reserva.
 *
 * Puede fallar aunque el horario se haya mostrado como libre: entre que se
 * pintó la pantalla y el cliente confirmó, otro pudo tomarlo. El mensaje que
 * devuelve la base ya está redactado para mostrárselo tal cual.
 *
 * Es la única de este archivo que NO va directo a Supabase: pasa por
 * /api/reservar/crear, que aplica el tope de reservas por IP (109).
 */
export async function createBooking(params: {
  branchId: string
  barberId: string
  clientName: string
  clientPhone: string
  clientEmail?: string | null
  startsAt: string
  serviceIds: string[]
}): Promise<BookingResult> {
  const res = await fetch('/api/reservar/crear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, clientEmail: params.clientEmail ?? null }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'No se pudo crear la reserva')
  return json as BookingResult
}

/** Consulta con código + teléfono. Los dos juntos: el código solo no alcanza. */
export async function lookupBooking(reference: string, phone: string): Promise<AppointmentLookup | null> {
  const { data, error } = await supabase.rpc('get_appointment_by_reference', {
    p_reference: reference,
    p_phone: phone,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as AppointmentLookup[])[0] ?? null
}

export async function cancelBooking(reference: string, phone: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_appointment_public', {
    p_reference: reference,
    p_phone: phone,
  })
  if (error) throw new Error(error.message)
}

// ─── Helpers de presentación ───────────────────────────────────────────
const TZ = 'America/Argentina/Buenos_Aires'

/** Hora local del turno, en el huso del negocio (no el del visitante). */
export function slotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', timeZone: TZ,
  })
}

/** "14/10/2026 18:54", en el huso del negocio. */
export function slotDateTimeShort(iso: string): string {
  const d = new Date(iso)
  const fecha = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ })
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ })
  return `${fecha} ${hora}`
}

export function slotDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ,
  })
}

/** 'YYYY-MM-DD' de hoy en el huso del negocio. */
export function todayInBusinessTz(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA')
}

/** Etiqueta corta para la tira de días: "Vie 7". */
export function dayChipLabel(iso: string): { dow: string; day: number } {
  const d = new Date(iso + 'T12:00:00')
  const dow = d.toLocaleDateString('es-AR', { weekday: 'short' })
  return { dow: dow.charAt(0).toUpperCase() + dow.slice(1, 3), day: d.getDate() }
}

/**
 * Horario de hoy para la tarjeta de sucursal ("Hoy 09:00 a 20:00"), o null
 * si ese día está cerrado / sin configurar (open === close, ver
 * 098_horario_de_atencion.sql). El día se calcula en el huso del negocio,
 * no el del visitante -- mismo criterio que el resto de este archivo.
 */
export function todayHoursLabel(hours: DayHours[]): string | null {
  const weekday = new Date(todayInBusinessTz() + 'T12:00:00').getDay()
  const today = hours.find((h) => h.weekday === weekday)
  if (!today || today.open === today.close) return null
  return `Hoy ${today.open} a ${today.close}`
}
