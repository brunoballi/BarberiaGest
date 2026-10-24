// ============================================================
// Marca de la sucursal — acceso a datos (062_branding_sucursal.sql)
// ============================================================
// Lo que la barbería muestra a SUS clientes en /reservar: logo, nombre,
// encabezado de bienvenida y descripción.
// ============================================================

import { supabase } from './supabase.client'
import type { DayHours } from './booking'

export interface BranchBranding {
  id: string
  name: string
  address: string | null
  logo_url: string | null
  welcome_title: string | null
  welcome_description: string | null
  /** Solo dígitos, formato internacional sin + (ej: 5491122334455). */
  whatsapp_phone: string | null
  /** Código de área sin 0 (ej: "341"). Completa el WhatsApp si se carga
   * solo el número local, sin área. */
  default_area_code: string | null
  /** Si es true, esta sucursal presta su nombre y logo al encabezado del
   * selector de sucursales en /reservar. A lo sumo una sucursal lo tiene
   * en true (097_encabezado_y_mapa_reserva.sql). */
  booking_header_enabled: boolean
  /** Logo alternativo SOLO para ese encabezado. Si es null, se usa logo_url. */
  booking_header_logo_url: string | null
  latitude: number | null
  longitude: number | null
  /** Siempre son 7 elementos (los 7 días). Ver 098_horario_de_atencion.sql. */
  business_hours: DayHours[]
}

/** Nombre e id de la sucursal que hoy presta el encabezado del selector,
 * para avisar en /admin/marca antes de que el admin choque con el índice
 * único parcial (una sola sucursal puede tenerlo activo a la vez). */
export interface BookingHeaderOwner {
  id: string
  name: string
}

const LOGO_BUCKET = 'branch-logos'

/** Tamaño máximo del logo. Es un logo, no una foto: 2 MB sobra de más y
 * evita que una imagen de cámara de 12 MB tarde una eternidad en cargar en
 * el celular de un cliente. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024
export const LOGO_TIPOS = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

export async function getBranchBranding(branchId: string): Promise<BranchBranding | null> {
  const { data, error } = await supabase
    .from('branches')
    .select(
      'id, name, address, logo_url, welcome_title, welcome_description, whatsapp_phone, default_area_code, booking_header_enabled, booking_header_logo_url, latitude, longitude, business_hours'
    )
    .eq('id', branchId)
    .single()
  if (error) throw new Error(`[getBranchBranding] ${error.message}`)
  return data as BranchBranding
}

/**
 * Sucursal que hoy tiene booking_header_enabled=true, si hay alguna. Se usa
 * en /admin/marca para avisar ANTES de guardar (el RPC igual lo rechaza,
 * pero con un mensaje que llega después de tocar "Guardar").
 */
export async function getBookingHeaderOwner(): Promise<BookingHeaderOwner | null> {
  const { data, error } = await supabase
    .from('branches')
    .select('id, name')
    .eq('booking_header_enabled', true)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new Error(`[getBookingHeaderOwner] ${error.message}`)
  return data
}

export async function updateBranchBranding(params: {
  branchId: string
  name: string
  address?: string | null
  logoUrl?: string | null
  welcomeTitle?: string | null
  welcomeDescription?: string | null
  whatsappPhone?: string | null
  defaultAreaCode?: string | null
  bookingHeaderEnabled?: boolean
  bookingHeaderLogoUrl?: string | null
  latitude?: number | null
  longitude?: number | null
  /** Omitido (undefined) preserva el horario ya guardado -- el RPC hace
   * coalesce(p_business_hours, business_hours). Los guardados incidentales
   * (subir logo, tildar el encabezado) no lo mandan a propósito, para no
   * tener que arrastrar el estado del picker de horario a cada handler. */
  businessHours?: DayHours[]
}): Promise<void> {
  const { error } = await supabase.rpc('update_branch_branding', {
    p_branch_id: params.branchId,
    p_name: params.name,
    p_address: params.address ?? null,
    p_logo_url: params.logoUrl ?? null,
    p_welcome_title: params.welcomeTitle ?? null,
    p_welcome_description: params.welcomeDescription ?? null,
    p_whatsapp_phone: params.whatsappPhone ?? null,
    p_default_area_code: params.defaultAreaCode ?? null,
    p_booking_header_enabled: params.bookingHeaderEnabled ?? false,
    p_booking_header_logo_url: params.bookingHeaderLogoUrl ?? null,
    p_latitude: params.latitude ?? null,
    p_longitude: params.longitude ?? null,
    p_business_hours: params.businessHours ?? null,
  })
  if (error) throw new Error(error.message)
}

/**
 * Sube el logo al bucket público y devuelve su URL definitiva.
 *
 * El nombre del archivo lleva un timestamp a propósito: si se reemplaza el
 * logo, la URL cambia. Con un nombre fijo, el navegador (y el CDN) seguirían
 * mostrando el logo viejo cacheado y parecería que la subida no funcionó.
 */
export async function uploadBranchLogo(branchId: string, file: File): Promise<string> {
  if (!LOGO_TIPOS.includes(file.type)) {
    throw new Error('El logo tiene que ser PNG, JPG, WEBP o SVG.')
  }
  if (file.size > LOGO_MAX_BYTES) {
    throw new Error('El logo no puede pesar más de 2 MB.')
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${branchId}/logo-${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: true })
  if (error) throw new Error(`No se pudo subir el logo: ${error.message}`)

  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
