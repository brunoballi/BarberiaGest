// ============================================================
// Foto del barbero — subida al bucket público 'barber-photos'
// (078_turnero_foto_del_barbero.sql). La sube el ADMIN desde /admin/barberos
// y se muestra en la reserva pública. Mismo patrón que el logo de la sucursal.
// ============================================================

import { supabase } from './supabase.client'

const PHOTO_BUCKET = 'barber-photos'

/** Mismo tope y tipos que fija el bucket en la migración 078. */
export const BARBER_PHOTO_MAX_BYTES = 3 * 1024 * 1024
export const BARBER_PHOTO_TIPOS = ['image/png', 'image/jpeg', 'image/webp']

/**
 * Sube la foto y devuelve su URL pública. El nombre lleva un timestamp a
 * propósito: si se reemplaza la foto la URL cambia, y el navegador y el CDN no
 * siguen mostrando la anterior.
 */
export async function uploadBarberPhoto(barberId: string, file: File): Promise<string> {
  if (!BARBER_PHOTO_TIPOS.includes(file.type)) {
    throw new Error('La foto tiene que ser PNG, JPG o WEBP.')
  }
  if (file.size > BARBER_PHOTO_MAX_BYTES) {
    throw new Error('La foto no puede pesar más de 3 MB.')
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${barberId}/foto-${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: true })
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`)

  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
