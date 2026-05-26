import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'

interface InviteAdminPayload {
  email: string
  full_name: string
  branch_ids: string[]
}

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

  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  let body: InviteAdminPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { email, full_name, branch_ids } = body
  if (!email || !full_name || !branch_ids?.length) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const password = generatePassword()
  const userId = randomUUID()

  // Usamos RPC para crear el usuario directo en auth.users/identities,
  // evitando la validación de email de GoTrue (que rechaza dominios no estándar)
  const { error: createError } = await adminClient.rpc('create_admin_auth_user', {
    p_id:        userId,
    p_email:     email,
    p_password:  password,
    p_full_name: full_name,
  })

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 400 })
  }

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: userId,
    branch_id: branch_ids[0],
    full_name,
    role: 'admin',
    compensation_type: 'salary',   // admins bypass salary constraints
    is_active: true,
  })

  if (profileError) {
    // Rollback: borrar el usuario auth recién creado
    await adminClient.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  const adminBranchRows = branch_ids.map((branch_id) => ({
    admin_id: userId,
    branch_id,
    granted_by: user.id,
  }))

  const { error: abError } = await adminClient.from('admin_branches').insert(adminBranchRows)

  if (abError) {
    await adminClient.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: abError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, credentials: { email: email.toLowerCase(), password } })
}
