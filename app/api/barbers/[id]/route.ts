import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProfileUpdate } from '@/lib/supabase/database.types'

/**
 * ¿El admin puede operar sobre un barbero de la sucursal `targetBranchId`?
 * Un admin multi-sucursal tiene sus sucursales en `admin_branches`, no solo en
 * su `profiles.branch_id`. Antes se comparaba únicamente contra la sucursal
 * "home" (profiles.branch_id), lo que rompía el borrado/edición de barberos de
 * cualquier otra sucursal asignada. Se acepta la home como fallback para admins
 * legacy sin filas en admin_branches.
 */
async function adminHasBranch(
  adminClient: SupabaseClient,
  adminId: string,
  targetBranchId: string | null,
  homeBranchId: string | null,
): Promise<boolean> {
  if (!targetBranchId) return false
  if (targetBranchId === homeBranchId) return true
  const { count } = await adminClient
    .from('admin_branches')
    .select('branch_id', { count: 'exact', head: true })
    .eq('admin_id', adminId)
    .eq('branch_id', targetBranchId)
  return (count ?? 0) > 0
}

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

  if (!target || !(await adminHasBranch(adminClient, user.id, target.branch_id, caller.branch_id))) {
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

  if (!target || !(await adminHasBranch(adminClient, user.id, target.branch_id, caller.branch_id))) {
    return NextResponse.json({ error: 'Barbero no encontrado en tu sucursal' }, { status: 404 })
  }

  // La decisión (borrar de verdad vs archivar) la toma el RPC admin_delete_or_archive,
  // que es la misma lógica que usan servicios, beneficios y socios vitalicios.
  //
  // Antes se chequeaba acá a mano solo transactions/settlements/advances, y eso
  // dejaba afuera cuatro relaciones en CASCADE: barber_debt_payments,
  // maintenance_sheet_items, maintenance_template_blocks y admin_branches. Un
  // barbero con planillas de mantenimiento pero sin cortes pasaba el chequeo y
  // deleteUser() se las llevaba puestas en silencio.
  //
  // Se llama con serverClient (la sesión del admin) y no con adminClient: el RPC
  // exige auth_role() = 'admin', y el service role no tiene auth.uid().
  const { data: resultado, error: rpcErr } = await serverClient.rpc('admin_delete_or_archive', {
    p_kind: 'barbero',
    p_id: id,
  })
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 })

  const r = resultado as { eliminado: boolean; nombre: string; usos?: unknown[] }

  // Se borró el profile: limpiar también el usuario de auth, que queda huérfano.
  // Si falla no se revierte nada — el registro ya no está y el usuario de auth
  // sin profile no puede entrar a ningún lado.
  if (r.eliminado) {
    await adminClient.auth.admin.deleteUser(id)
  }

  return NextResponse.json({ ok: true, ...r })
}
