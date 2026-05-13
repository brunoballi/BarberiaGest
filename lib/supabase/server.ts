// ============================================================
// VALHALLA BARBERSHOP — Supabase Server Client
// Usa @supabase/ssr para leer/escribir cookies en Server
// Components, Server Actions y Route Handlers.
// NO usar este archivo en Client Components.
// ============================================================

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Profile } from './database.types'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}

/**
 * Devuelve el Profile del usuario autenticado vía cookies de servidor.
 * Retorna null si no hay sesión o no existe el perfil.
 */
export async function getServerProfile(): Promise<Profile | null> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('[getServerProfile]', error.message)
    return null
  }

  return data ?? null
}
