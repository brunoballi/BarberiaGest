import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

interface InviteExistingPayload {
  profileId: string   // UUID del perfil existente (sin auth)
  email: string
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 12 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('')
}

export async function POST(request: NextRequest) {
  // Verificar que el llamante es admin autenticado
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

  let body: InviteExistingPayload
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { profileId, email } = body
  if (!profileId || !email)
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Obtener datos del perfil existente
  const { data: existingProfile, error: fetchError } = await adminClient
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single()

  if (fetchError || !existingProfile)
    return NextResponse.json({ error: 'Barbero no encontrado' }, { status: 404 })

  const password = generatePassword()

  // Crear usuario en auth
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: existingProfile.full_name },
  })

  if (createError)
    return NextResponse.json({ error: createError.message }, { status: 400 })

  // Crear nuevo perfil con el UUID del auth user (mismos datos de compensación)
  const { error: profileError } = await adminClient.from('profiles').insert({
    id: created.user.id,
    branch_id: existingProfile.branch_id,
    full_name: existingProfile.full_name,
    role: 'barber',
    compensation_type: existingProfile.compensation_type,
    commission_rate: existingProfile.commission_rate,
    base_salary_rate: existingProfile.base_salary_rate,
    presentismo_rate: existingProfile.presentismo_rate,
    objetivo_rate: existingProfile.objetivo_rate,
    objetivo_min_cuts: existingProfile.objetivo_min_cuts,
    box_rental_amount: existingProfile.box_rental_amount,
    is_active: true,
  })

  if (profileError) {
    await adminClient.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  // Desactivar el perfil viejo (sin auth) — conserva historial
  await adminClient
    .from('profiles')
    .update({ is_active: false })
    .eq('id', profileId)

  return NextResponse.json({ ok: true, credentials: { email, password } })
}
