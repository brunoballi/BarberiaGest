// ============================================================
// VALHALLA BARBERSHOP — Auth Proxy
// Next.js 16: el archivo se llama proxy.ts (no middleware.ts)
// y exporta una función llamada `proxy`.
//
// Responsabilidad: proteger rutas verificando si existe sesión
// Supabase en las cookies. NO hace llamadas a DB (solo JWT).
// La verificación de rol ocurre en los Server Components.
// ============================================================

import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function proxy(request: NextRequest) {
  // Construir respuesta base que también refresca las cookies de sesión
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          // Propagar cookies tanto al request como a la response
          // para que los Server Components del mismo ciclo las lean
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refrescar la sesión si el token expiró (rotación silenciosa)
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const path = request.nextUrl.pathname

  // ── Proteger rutas /admin y /barber ──────────────────────
  const isProtected =
    path.startsWith('/admin') || path.startsWith('/barber')

  if (isProtected && !session) {
    const loginUrl = new URL('/login', request.nextUrl)
    loginUrl.searchParams.set('next', path)
    return NextResponse.redirect(loginUrl)
  }

  // ── Raíz: el Server Component app/page.tsx maneja el redirect ─
  // No interferimos aquí para evitar llamadas a DB en el proxy.

  return response
}

export const config = {
  matcher: [
    // Excluir archivos estáticos, imágenes y APIs
    '/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.png$|.*\\.svg$|.*\\.ico$).*)',
  ],
}
