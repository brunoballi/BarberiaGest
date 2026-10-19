// ============================================================
// Controles compartidos de las rutas /api de administración.
//
// Estas rutas usan el service role, que saltea RLS: el único control es el
// que hagan ellas. Antes cada ruta miraba solo "¿el que llama es admin?" y
// después operaba sobre CUALQUIER perfil que llegara en el body. Un admin de
// una sola sucursal podía resetearle la contraseña al dueño y quedarse con
// su cuenta, o crear un admin disfrazado de barbero (auditoría 2026-09-29).
//
// Reglas:
//   · Un barbero se toca solo si es de una sucursal que el admin maneja.
//   · Otro admin se toca solo si todas sus sucursales están entre las del
//     que llama (el dueño, que tiene todas, maneja a todos; un encargado de
//     una sucursal no puede tocar al dueño). Uno mismo, siempre.
//   · El rol nunca sale del body.
// ============================================================

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { randomInt } from 'crypto'

export interface AdminCaller {
  user: User
  serverClient: SupabaseClient
  adminClient: SupabaseClient
  /** Sucursales que maneja: admin_branches + su sucursal "home" (legacy). */
  branchIds: Set<string>
}

export function serviceRoleClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * Devuelve el admin que llama, o la respuesta de error lista para devolver.
 * Uso: `const caller = await requireAdmin(); if (caller instanceof NextResponse) return caller`
 */
export async function requireAdmin(): Promise<AdminCaller | NextResponse> {
  const cookieStore = await cookies()
  const serverClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  ) as unknown as SupabaseClient

  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const adminClient = serviceRoleClient()

  const { data: profile } = await adminClient
    .from('profiles')
    .select('role, branch_id, is_active')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' || profile.is_active === false) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { data: rows } = await adminClient
    .from('admin_branches')
    .select('branch_id')
    .eq('admin_id', user.id)

  const branchIds = new Set<string>((rows ?? []).map((r) => r.branch_id as string))
  if (profile.branch_id) branchIds.add(profile.branch_id)

  return { user, serverClient, adminClient, branchIds }
}

/** Perfil de barbero de una sucursal del admin, o null. */
export async function getManageableBarber(caller: AdminCaller, profileId: string) {
  const { data } = await caller.adminClient
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .maybeSingle()
  if (!data || data.role !== 'barber') return null
  if (!data.branch_id || !caller.branchIds.has(data.branch_id)) return null
  return data
}

/** ¿El que llama puede administrar a este otro admin? */
export async function canManageAdmin(caller: AdminCaller, adminId: string): Promise<boolean> {
  if (adminId === caller.user.id) return true

  const { data: target } = await caller.adminClient
    .from('profiles')
    .select('role, branch_id')
    .eq('id', adminId)
    .maybeSingle()
  if (!target || target.role !== 'admin') return false

  const { data: rows } = await caller.adminClient
    .from('admin_branches')
    .select('branch_id')
    .eq('admin_id', adminId)

  const targetBranches = new Set<string>((rows ?? []).map((r) => r.branch_id as string))
  if (target.branch_id) targetBranches.add(target.branch_id)

  for (const b of targetBranches) {
    if (!caller.branchIds.has(b)) return false
  }
  return true
}

/** ¿Todas estas sucursales son del que llama? */
export function ownsAllBranches(caller: AdminCaller, branchIds: unknown): branchIds is string[] {
  return (
    Array.isArray(branchIds) &&
    branchIds.every((b) => typeof b === 'string' && caller.branchIds.has(b))
  )
}

/**
 * Campos de un perfil de barbero que el admin puede fijar desde las rutas.
 * Todo lo demás (role, id, archived_at, created_at...) se descarta.
 */
export const BARBER_EDITABLE_FIELDS = [
  'full_name',
  'dni',
  'birth_date',
  'avatar_url',
  'branch_id',
  'compensation_type',
  'commission_rate',
  'base_salary_rate',
  'presentismo_rate',
  'mantenimiento_rate',
  'mantenimiento_min_cuts',
  'box_rental_amount',
  'receives_transfers',
  'advance_enabled',
  'advance_limit',
  'is_new_barber',
  'classic_service_id',
  'is_active',
] as const

export function pickBarberFields(body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!body || typeof body !== 'object') return out
  for (const key of BARBER_EDITABLE_FIELDS) {
    if (key in body) out[key] = (body as Record<string, unknown>)[key]
  }
  return out
}

/**
 * Contraseña de 12 caracteres para credenciales nuevas o reseteadas.
 * crypto.randomInt y no Math.random: la segunda no es apta para secretos.
 */
export function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join('')
}
