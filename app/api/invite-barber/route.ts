import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { CompensationType } from '@/lib/supabase/database.types'

interface InvitePayload {
  email: string
  full_name: string
  branch_id: string
  compensation_type: CompensationType
  commission_rate: number | null
  base_salary_rate: number | null
  presentismo_rate: number | null
  objetivo_rate: number | null
  objetivo_min_cuts: number | null
  box_rental_amount: number | null
}

/** Genera una contraseña segura de 12 caracteres */
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
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: callerProfile } = await serverClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  // Parsear body
  let body: InvitePayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { email, full_name, branch_id, compensation_type, ...compensationFields } = body

  if (!email || !full_name || !branch_id || !compensation_type) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const password = generatePassword()

  // Crear usuario via Admin API — maneja auth.users + auth.identities correctamente
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,   // no requiere confirmación por email
    user_metadata: { full_name },
  })

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 400 })
  }

  // Insertar perfil en nuestra tabla
  const { error: profileError } = await adminClient.from('profiles').insert({
    id: created.user.id,
    branch_id,
    full_name,
    role: 'barber',
    compensation_type,
    is_active: true,
    ...compensationFields,
  })

  if (profileError) {
    // Rollback: eliminar el usuario de auth si el perfil falló
    await adminClient.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  // Devolver credenciales para que el admin las comparta con el barbero
  return NextResponse.json({
    ok: true,
    credentials: { email, password },
  })
}
