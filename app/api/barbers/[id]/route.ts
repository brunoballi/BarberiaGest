import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { ProfileUpdate } from '@/lib/supabase/database.types'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

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

  const { data: caller } = await serverClient
    .from('profiles')
    .select('role, branch_id')
    .eq('id', user.id)
    .single()

  if (caller?.role !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  let body: ProfileUpdate
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  // Verificar que el barbero pertenece a la misma sucursal del admin
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: target } = await adminClient
    .from('profiles')
    .select('branch_id')
    .eq('id', id)
    .single()

  if (!target || target.branch_id !== caller.branch_id) {
    return NextResponse.json({ error: 'Barbero no encontrado en tu sucursal' }, { status: 404 })
  }

  const { error } = await adminClient
    .from('profiles')
    .update(body)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

/**
 * Borrado DEFINITIVO de un barbero. Solo permitido si:
 *  - el barbero pertenece a la sucursal del admin,
 *  - está inactivo (is_active = false),
 *  - no tiene datos asociados (transacciones, liquidaciones ni adelantos).
 * Elimina el usuario de auth (cascade → profiles). Irreversible.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

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

  const { data: caller } = await serverClient
    .from('profiles')
    .select('role, branch_id')
    .eq('id', user.id)
    .single()

  if (caller?.role !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: target } = await adminClient
    .from('profiles')
    .select('branch_id, is_active')
    .eq('id', id)
    .single()

  if (!target || target.branch_id !== caller.branch_id) {
    return NextResponse.json({ error: 'Barbero no encontrado en tu sucursal' }, { status: 404 })
  }

  if (target.is_active) {
    return NextResponse.json(
      { error: 'Solo se pueden eliminar barberos inactivos. Desactivalo primero.' },
      { status: 409 }
    )
  }

  // Verificar que no tenga datos asociados (no perder histórico)
  const [{ count: txCount }, { count: settCount }, { count: advCount }] = await Promise.all([
    adminClient.from('transactions').select('id', { count: 'exact', head: true }).eq('barber_id', id),
    adminClient.from('settlements').select('id', { count: 'exact', head: true }).eq('barber_id', id),
    adminClient.from('advances').select('id', { count: 'exact', head: true }).eq('barber_id', id),
  ])

  if ((txCount ?? 0) > 0 || (settCount ?? 0) > 0 || (advCount ?? 0) > 0) {
    return NextResponse.json(
      { error: 'No se puede eliminar: el barbero tiene cortes, liquidaciones o adelantos. Mantenelo como inactivo.' },
      { status: 409 }
    )
  }

  // Eliminar usuario de auth → cascade a profiles. Si no tuviera cuenta auth,
  // borrar el profile directamente como fallback.
  const { error: authErr } = await adminClient.auth.admin.deleteUser(id)
  if (authErr) {
    const { error: profErr } = await adminClient.from('profiles').delete().eq('id', id)
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
