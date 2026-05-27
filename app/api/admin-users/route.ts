import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  void request
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

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: admins, error: adminsError } = await adminClient
    .from('profiles')
    .select('id, full_name, is_active')
    .eq('role', 'admin')
    .order('full_name')

  if (adminsError) return NextResponse.json({ error: adminsError.message }, { status: 500 })

  const { data: abRows, error: abError } = await adminClient
    .from('admin_branches')
    .select('admin_id, branch_id')

  if (abError) return NextResponse.json({ error: abError.message }, { status: 500 })

  const { data: branches, error: branchesError } = await adminClient
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  if (branchesError) return NextResponse.json({ error: branchesError.message }, { status: 500 })

  const branchMap = Object.fromEntries((branches ?? []).map((b) => [b.id, b.name]))

  const result = (admins ?? []).map((a) => {
    const assignedBranches = (abRows ?? [])
      .filter((r) => r.admin_id === a.id)
      .map((r) => ({ id: r.branch_id, name: branchMap[r.branch_id] ?? r.branch_id }))
    return { ...a, branches: assignedBranches }
  })

  return NextResponse.json({ admins: result, branches: branches ?? [] })
}

export async function PUT(request: NextRequest) {
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

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const body = await request.json()
  const { profileId, full_name, email, branch_ids } = body as {
    profileId: string
    full_name: string
    email?: string
    branch_ids: string[]
  }

  if (!profileId || !full_name || !branch_ids)
    return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 })

  // 1. Actualizar nombre en profiles
  const { error: profileErr } = await adminClient
    .from('profiles')
    .update({ full_name })
    .eq('id', profileId)
  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })

  // 2. Actualizar email en auth si cambió
  if (email) {
    const { error: emailErr } = await adminClient.auth.admin.updateUserById(profileId, { email })
    if (emailErr) return NextResponse.json({ error: emailErr.message }, { status: 500 })
  }

  // 3. Reemplazar sucursales asignadas
  const { error: delErr } = await adminClient
    .from('admin_branches')
    .delete()
    .eq('admin_id', profileId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (branch_ids.length > 0) {
    const { error: insErr } = await adminClient
      .from('admin_branches')
      .insert(branch_ids.map((bid) => ({ admin_id: profileId, branch_id: bid })))
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
