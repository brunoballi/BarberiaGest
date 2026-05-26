import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const serverClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: callerProfile } = await serverClient
    .from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'admin')
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const profileId = request.nextUrl.searchParams.get('profileId')
  if (!profileId)
    return NextResponse.json({ error: 'Falta profileId' }, { status: 400 })

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: authUser, error } = await adminClient.auth.admin.getUserById(profileId)
  if (error || !authUser?.user)
    return NextResponse.json({ email: null })

  return NextResponse.json({ email: authUser.user.email ?? null })
}
