// ============================================================
// VALHALLA BARBERSHOP — Auth Callback Route Handler
// Intercambia el code PKCE por una sesión Supabase.
// Se invoca cuando un barbero hace clic en su magic link de
// invitación o cuando se usa el flujo de recuperación de
// contraseña (signInWithOtp / inviteUserByEmail).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Determinar destino según el rol del usuario recién autenticado
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()

        const destination =
          profile?.role === 'admin' ? '/admin' : '/barber'

        return NextResponse.redirect(new URL(destination, origin))
      }
    }
  }

  // En caso de error o ausencia de code, redirigir al login
  return NextResponse.redirect(new URL('/login?error=auth', origin))
}
