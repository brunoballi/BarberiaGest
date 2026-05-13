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

export async function POST(request: NextRequest) {
  // Verify caller is authenticated admin
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

  // Parse body
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

  // Admin client with service role — never expose this key client-side
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Invite user — Supabase sends magic-link email automatically
  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    { data: { full_name, role: 'barber' } }
  )

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 })
  }

  // Insert profile row with the new user's UUID
  const { error: profileError } = await adminClient.from('profiles').insert({
    id: invited.user.id,
    branch_id,
    full_name,
    role: 'barber',
    compensation_type,
    is_active: true,
    ...compensationFields,
  })

  if (profileError) {
    // Clean up: delete the auth user so the invite isn't dangling
    await adminClient.auth.admin.deleteUser(invited.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, user_id: invited.user.id })
}
