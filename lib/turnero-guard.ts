// Guardas del turnero para el SERVIDOR (paginas y rutas /api). Ver turnero-access.ts.
import { notFound, redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { createSupabaseServerClient, getServerProfile } from '@/lib/supabase/server'
import { canUseTurnero, TURNERO_PUBLIC_OPEN } from '@/lib/turnero-access'
import type { Profile } from '@/lib/supabase/database.types'

/** Pantallas de administracion del turnero: admin logueado Y en la lista de prueba. */
export async function requireTurneroAdminPage(): Promise<Profile> {
  const profile = await getServerProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')
  if (!canUseTurnero(profile.id)) notFound()
  return profile
}

/** Pantallas publicas del turnero (/reservar): 404 salvo que este abierto o sea un usuario de prueba. */
export async function requireTurneroPublicPage(): Promise<void> {
  if (TURNERO_PUBLIC_OPEN) return
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!canUseTurnero(user?.id)) notFound()
}

/**
 * Rutas /api publicas del turnero (reserva, avisos): devuelve una respuesta 404 si todavia
 * no estan abiertas y quien llama no es un usuario de prueba; null si puede seguir.
 * NO se usa en el webhook de Meta ni en el cron: esos se protegen con su propia firma/secreto.
 */
export async function turneroApiGate(): Promise<NextResponse | null> {
  if (TURNERO_PUBLIC_OPEN) return null
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (canUseTurnero(user?.id)) return null
  return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
}