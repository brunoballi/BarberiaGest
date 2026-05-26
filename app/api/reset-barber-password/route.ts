import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 12 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('')
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const serverClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )

  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: callerProfile } = await serverClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (callerProfile?.role !== 'admin')
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  let body: { profileId: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { profileId } = body
  if (!profileId)
    return NextResponse.json({ error: 'Falta profileId' }, { status: 400 })

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Verificar si el barbero tiene cuenta de auth
  const { data: authUser, error: getUserError } = await adminClient.auth.admin.getUserById(profileId)

  if (getUserError || !authUser?.user) {
    return NextResponse.json({ error: 'no-auth' }, { status: 404 })
  }

  const password = generatePassword()

  const { error: updateError } = await adminClient.auth.admin.updateUserById(profileId, { password })
  if (updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    credentials: {
      email: authUser.user.email ?? '',
      password,
    },
  })
}
