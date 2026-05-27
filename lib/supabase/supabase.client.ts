// ============================================================
// VALHALLA BARBERSHOP — Supabase Client + Query Helpers
// Usa createBrowserClient de @supabase/ssr para que las cookies
// de sesión sean accesibles desde el servidor (proxy.ts).
// ============================================================

import { createBrowserClient } from '@supabase/ssr'
import type {
  Branch,
  BranchReport,
  Profile,
  Transaction,
  TransactionInsert,
  TransactionWithRelations,
  Month,
  MonthWithWeeks,
  MonthInsert,
  Week,
  WeekInsert,
  Settlement,
  SettlementWithBarber,
  SettlementUpdate,
  Advance,
  AdvanceInsert,
  AdvanceUpdate,
  AdvanceWithBarber,
  Expense,
  ExpenseInsert,
  ProfileUpdate,
  WeekUpdate,
  ServiceCatalog,
  ServiceCatalogInsert,
  RegisterCutPayload,
} from './database.types'

// ============================================================
// CLIENT SINGLETON
// ============================================================
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ============================================================
// AUTH HELPERS
// ============================================================
export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('[getCurrentProfile]', error.message)
    return null
  }
  return data
}

// ============================================================
// BRANCHES
// ============================================================
export async function getBranches(): Promise<Branch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (error) throw new Error(`[getBranches] ${error.message}`)
  return data
}

/**
 * Devuelve los adelantos que están actualmente "a descontar" para un barbero
 * (status = pending o approved). Útil para mostrarlos en la fila de liquidación.
 */
export async function getAdvancesPendingForBarber(
  barberId: string,
  branchId: string
): Promise<Advance[]> {
  const { data, error } = await supabase
    .from('advances')
    .select('*')
    .eq('barber_id', barberId)
    .eq('branch_id', branchId)
    .in('status', ['pending', 'approved'])
    .order('advance_date', { ascending: false })

  if (error) throw new Error(`[getAdvancesPendingForBarber] ${error.message}`)
  return data
}

/**
 * Devuelve solo las sucursales que el admin actual tiene asignadas vía admin_branches.
 * Si el usuario no es admin o no tiene asignaciones, devuelve [].
 *
 * Implementación robusta: dos queries simples en vez de un join (evita ambigüedades
 * de PostgREST que devuelve la relación a veces como objeto, a veces como array).
 */
export async function getMyBranches(): Promise<Branch[]> {
  // 1. IDs de sucursales que tiene asignadas el usuario actual
  const { data: rows, error: errAB } = await supabase
    .from('admin_branches')
    .select('branch_id')

  if (errAB) throw new Error(`[getMyBranches/admin_branches] ${errAB.message}`)

  const ids = (rows ?? []).map((r) => r.branch_id)
  if (ids.length === 0) return []

  // 2. Cargar las sucursales completas
  const { data: branches, error: errB } = await supabase
    .from('branches')
    .select('*')
    .in('id', ids)
    .eq('is_active', true)
    .order('name')

  if (errB) throw new Error(`[getMyBranches/branches] ${errB.message}`)
  return branches ?? []
}

// ============================================================
// SERVICE CATALOG
// ============================================================
export async function getServicesByBranch(branchId: string): Promise<ServiceCatalog[]> {
  const { data, error } = await supabase
    .from('service_catalog')
    .select('id, name, base_price, is_active, branch_id, created_at')
    .eq('branch_id', branchId)
    .order('name')

  if (error) throw new Error(`[getServicesByBranch] ${error.message}`)
  return data
}

export async function createService(payload: ServiceCatalogInsert): Promise<ServiceCatalog> {
  const { data, error } = await supabase
    .from('service_catalog')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`[createService] ${error.message}`)
  return data
}

export async function updateService(
  id: string,
  updates: Partial<Pick<ServiceCatalog, 'name' | 'base_price' | 'is_active'>>
): Promise<void> {
  const { error } = await supabase
    .from('service_catalog')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`[updateService] ${error.message}`)
}

// ============================================================
// WEEKS
// ============================================================
export async function getOpenWeek(branchId: string): Promise<Week | null> {
  const today = todayLocal()
  // Single query: fetch all open weeks (normally ≤2 at any time), apply priority in JS
  const { data, error } = await supabase
    .from('weeks')
    .select('*')
    .eq('branch_id', branchId)
    .eq('status', 'open')
    .order('start_date', { ascending: true })
    .limit(10)

  if (error) throw new Error(`[getOpenWeek] ${error.message}`)
  if (!data?.length) return null

  // Priority 1: week that contains today
  const containsToday = data.find(w => w.start_date <= today && w.end_date >= today)
  if (containsToday) return containsToday

  // Priority 2: nearest future open week
  const nextOpen = data.find(w => w.start_date > today)
  if (nextOpen) return nextOpen

  // Priority 3: most recent past open week
  return data.filter(w => w.start_date < today).at(-1) ?? null
}

export async function getWeeksByBranch(branchId: string): Promise<Week[]> {
  const { data, error } = await supabase
    .from('weeks')
    .select('*')
    .eq('branch_id', branchId)
    .order('start_date', { ascending: false })

  if (error) throw new Error(`[getWeeksByBranch] ${error.message}`)
  return data
}

export async function createWeek(payload: WeekInsert): Promise<Week> {
  const { data, error } = await supabase
    .from('weeks')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`[createWeek] ${error.message}`)
  return data
}

export async function closeWeek(
  weekId: string,
  closedBy: string
): Promise<void> {
  // 1. Cerrar la semana
  const { data: closed, error } = await supabase
    .from('weeks')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: closedBy,
    } satisfies WeekUpdate)
    .eq('id', weekId)
    .eq('status', 'open')
    .select('branch_id, end_date')
    .single()

  if (error) throw new Error(`[closeWeek] ${error.message}`)

  // 2. Asegurar que exista una semana abierta posterior
  if (closed) {
    try {
      await ensureNextWeekOpen(closed.branch_id, closed.end_date)
    } catch (e) {
      // No bloquear el cierre si falla la auto-apertura — solo loguear
      console.error('[closeWeek/ensureNextWeekOpen]', e)
    }
  }
}

/**
 * Asegura que exista una semana abierta inmediatamente después de `afterEndDate`
 * para la sucursal dada. Si la semana no existe, la crea (creando el mes también si hace falta).
 * Si ya existe (en cualquier estado), no hace nada.
 */
export async function ensureNextWeekOpen(
  branchId: string,
  afterEndDate: string
): Promise<void> {
  // Calcular lunes siguiente (afterEndDate + 1 día) y domingo + 7
  const [y, m, d] = afterEndDate.split('-').map(Number)
  const start = new Date(y, m - 1, d + 1)  // local time, evita timezone bug
  const end   = new Date(y, m - 1, d + 7)

  const nextStart = dateToLocalString(start)
  const nextEnd   = dateToLocalString(end)

  // ¿Ya existe alguna semana que abarque esa fecha?
  const { data: existing } = await supabase
    .from('weeks')
    .select('id, status')
    .eq('branch_id', branchId)
    .eq('start_date', nextStart)
    .maybeSingle()

  if (existing) return  // ya hay una semana ahí, no tocar

  // Asegurar el mes (year/month del lunes de inicio)
  const nextYear  = start.getFullYear()
  const nextMonth = start.getMonth() + 1

  let monthId: string | null = null
  const { data: existingMonth } = await supabase
    .from('months')
    .select('id')
    .eq('branch_id', branchId)
    .eq('year', nextYear)
    .eq('month', nextMonth)
    .maybeSingle()

  if (existingMonth) {
    monthId = existingMonth.id
  } else {
    // Crear el mes sin sus semanas automáticas (las generamos en el manejo manual)
    const { data: newMonth, error: monthErr } = await supabase
      .from('months')
      .insert({ branch_id: branchId, year: nextYear, month: nextMonth, status: 'active' } satisfies MonthInsert)
      .select('id')
      .single()
    if (monthErr) throw new Error(`[ensureNextWeekOpen] ${monthErr.message}`)
    monthId = newMonth.id
  }

  // Tomar el próximo week_number disponible para la sucursal en este mes
  const { data: maxRow } = await supabase
    .from('weeks')
    .select('week_number')
    .eq('branch_id', branchId)
    .eq('month_id', monthId)
    .order('week_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextWeekNumber = (maxRow?.week_number ?? 0) + 1

  // Crear la semana abierta
  const { error: weekErr } = await supabase
    .from('weeks')
    .insert({
      branch_id: branchId,
      month_id: monthId,
      week_number: nextWeekNumber,
      start_date: nextStart,
      end_date: nextEnd,
      status: 'open',
    } satisfies WeekInsert)

  if (weekErr) throw new Error(`[ensureNextWeekOpen/insert] ${weekErr.message}`)
}

/**
 * Crea atómicamente los 12 meses + todas sus semanas Mon-Sun de un año entero.
 * Idempotente: si ya existen meses/semanas, las respeta y solo crea lo faltante.
 * Devuelve { months_created, weeks_created, year }.
 */
export async function createYear(
  branchId: string,
  year: number
): Promise<{ months_created: number; weeks_created: number; year: number }> {
  const { data, error } = await supabase.rpc('create_year', {
    p_branch_id: branchId,
    p_year: year,
  })
  if (error) throw new Error(`[createYear] ${error.message}`)
  return data as { months_created: number; weeks_created: number; year: number }
}

// ============================================================
// AUDIT LOG
// ============================================================
export interface AuditLogEntry {
  id: string
  table_name: string
  record_id: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  changed_by: string | null
  changed_at: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  diff: Record<string, { old: unknown; new: unknown }> | null
}

export interface AuditLogWithUser extends AuditLogEntry {
  changed_by_name: string | null
}

export interface AuditFilters {
  table?: 'transactions' | 'settlements' | 'expenses' | null
  action?: 'INSERT' | 'UPDATE' | 'DELETE' | null
  from?: string  // ISO date YYYY-MM-DD
  to?: string
  limit?: number
}

/** Trae entries del audit_log con nombre del usuario que hizo el cambio */
export async function getAuditLog(filters: AuditFilters = {}): Promise<AuditLogWithUser[]> {
  let query = supabase
    .from('audit_log')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(filters.limit ?? 100)

  if (filters.table)  query = query.eq('table_name', filters.table)
  if (filters.action) query = query.eq('action', filters.action)
  if (filters.from)   query = query.gte('changed_at', filters.from)
  if (filters.to)     query = query.lte('changed_at', filters.to + 'T23:59:59')

  const { data: rows, error } = await query
  if (error) throw new Error(`[getAuditLog] ${error.message}`)
  if (!rows || rows.length === 0) return []

  // Cargar perfiles para mostrar nombres
  const userIds = [...new Set(rows.map((r) => r.changed_by).filter((id): id is string => !!id))]
  let userMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)
    userMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]))
  }

  return rows.map((r) => ({
    ...r,
    changed_by_name: r.changed_by ? (userMap[r.changed_by] ?? null) : null,
  }))
}

/** Resultado genérico de operaciones de borrado seguro */
export interface SafeDeleteResult {
  deleted: boolean
  reason?: string
  transactions?: number
  settlements?: number
  expenses?: number
  advances?: number
  weeks_deleted?: number
  months_deleted?: number
}

/** Borra una semana si no tiene datos asociados */
export async function deleteWeekSafe(weekId: string): Promise<SafeDeleteResult> {
  const { data, error } = await supabase.rpc('delete_week_safe', { p_week_id: weekId })
  if (error) throw new Error(`[deleteWeekSafe] ${error.message}`)
  return data as SafeDeleteResult
}

/** Borra un mes y todas sus semanas si ninguna tiene datos */
export async function deleteMonthSafe(monthId: string): Promise<SafeDeleteResult> {
  const { data, error } = await supabase.rpc('delete_month_safe', { p_month_id: monthId })
  if (error) throw new Error(`[deleteMonthSafe] ${error.message}`)
  return data as SafeDeleteResult
}

/** Borra todos los meses + semanas de un año si nada tiene datos */
export async function deleteYearSafe(branchId: string, year: number): Promise<SafeDeleteResult> {
  const { data, error } = await supabase.rpc('delete_year_safe', { p_branch_id: branchId, p_year: year })
  if (error) throw new Error(`[deleteYearSafe] ${error.message}`)
  return data as SafeDeleteResult
}

/** ⚠ Borra una semana Y todos sus datos asociados (cascada controlada) */
export async function deleteWeekForce(weekId: string): Promise<SafeDeleteResult> {
  const { data, error } = await supabase.rpc('delete_week_force', { p_week_id: weekId })
  if (error) throw new Error(`[deleteWeekForce] ${error.message}`)
  return data as SafeDeleteResult
}

/** ⚠ Borra un mes Y todos sus datos asociados (cascada controlada) */
export async function deleteMonthForce(monthId: string): Promise<SafeDeleteResult> {
  const { data, error } = await supabase.rpc('delete_month_force', { p_month_id: monthId })
  if (error) throw new Error(`[deleteMonthForce] ${error.message}`)
  return data as SafeDeleteResult
}

/** ⚠ Borra un año entero Y todos sus datos asociados (cascada controlada) */
export async function deleteYearForce(branchId: string, year: number): Promise<SafeDeleteResult> {
  const { data, error } = await supabase.rpc('delete_year_force', { p_branch_id: branchId, p_year: year })
  if (error) throw new Error(`[deleteYearForce] ${error.message}`)
  return data as SafeDeleteResult
}

/**
 * ¿Existe al menos un mes cargado para esta sucursal y este año?
 * Útil para mostrar banner "El año X no está cargado".
 */
export async function yearHasMonths(branchId: string, year: number): Promise<boolean> {
  const { count, error } = await supabase
    .from('months')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', branchId)
    .eq('year', year)
  if (error) throw new Error(`[yearHasMonths] ${error.message}`)
  return (count ?? 0) > 0
}

export async function reopenWeek(weekId: string): Promise<void> {
  const { error } = await supabase
    .from('weeks')
    .update({ status: 'open', closed_at: null, closed_by: null } satisfies WeekUpdate)
    .eq('id', weekId)

  if (error) throw new Error(`[reopenWeek] ${error.message}`)
}

/** Edita fechas de inicio/fin de una semana existente (modo carga manual del admin) */
export async function updateWeekDates(
  weekId: string,
  startDate: string,
  endDate: string
): Promise<void> {
  if (startDate > endDate) throw new Error('La fecha de inicio no puede ser mayor que la de fin')
  const { error } = await supabase
    .from('weeks')
    .update({ start_date: startDate, end_date: endDate } satisfies WeekUpdate)
    .eq('id', weekId)
  if (error) throw new Error(`[updateWeekDates] ${error.message}`)
}

/**
 * Crea una semana manualmente para una sucursal con fechas arbitrarias.
 * Auto-detecta o crea el mes correspondiente al startDate.
 */
export async function createManualWeek(
  branchId: string,
  startDate: string,
  endDate: string,
  status: 'open' | 'closed' = 'open'
): Promise<Week> {
  if (startDate > endDate) throw new Error('La fecha de inicio no puede ser mayor que la de fin')

  // Verificar que no exista una semana con esa fecha de inicio
  const { data: existing } = await supabase
    .from('weeks')
    .select('id')
    .eq('branch_id', branchId)
    .eq('start_date', startDate)
    .maybeSingle()
  if (existing) throw new Error('Ya existe una semana con esa fecha de inicio para esta sucursal')

  // Determinar mes a partir del startDate
  const [y, m] = startDate.split('-').map(Number)

  let monthId: string
  const { data: existingMonth } = await supabase
    .from('months')
    .select('id')
    .eq('branch_id', branchId)
    .eq('year', y)
    .eq('month', m)
    .maybeSingle()

  if (existingMonth) {
    monthId = existingMonth.id
  } else {
    const { data: newMonth, error: mErr } = await supabase
      .from('months')
      .insert({ branch_id: branchId, year: y, month: m, status: 'active' } satisfies MonthInsert)
      .select('id')
      .single()
    if (mErr) throw new Error(`[createManualWeek/month] ${mErr.message}`)
    monthId = newMonth.id
  }

  // week_number: siguiente en ese mes
  const { data: maxRow } = await supabase
    .from('weeks')
    .select('week_number')
    .eq('branch_id', branchId)
    .eq('month_id', monthId)
    .order('week_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextWeekNumber = (maxRow?.week_number ?? 0) + 1

  const insertPayload: WeekInsert = {
    branch_id: branchId,
    month_id: monthId,
    week_number: nextWeekNumber,
    start_date: startDate,
    end_date: endDate,
    status,
  }
  // closed requiere closed_at por check constraint
  if (status === 'closed') {
    insertPayload.closed_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('weeks')
    .insert(insertPayload)
    .select()
    .single()

  if (error) throw new Error(`[createManualWeek] ${error.message}`)
  return data
}

export async function markWeekPaid(weekId: string): Promise<void> {
  const { error } = await supabase
    .from('weeks')
    .update({ status: 'paid' } satisfies WeekUpdate)
    .eq('id', weekId)
    .eq('status', 'closed')

  if (error) throw new Error(`[markWeekPaid] ${error.message}`)
}

// ============================================================
// MONTHS
// ============================================================

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
export { MONTH_NAMES }

// ─── Helpers de fecha local (evita bug de timezone con toISOString) ───
/** Convierte una Date a YYYY-MM-DD usando la zona horaria LOCAL (no UTC) */
export function dateToLocalString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Devuelve la fecha de hoy en formato YYYY-MM-DD usando la zona horaria LOCAL */
export function todayLocal(): string {
  return dateToLocalString(new Date())
}

/** Genera rangos lunes-domingo para todas las semanas que tocan el mes */
function generateWeekRangesForMonth(year: number, month: number): Array<{ start_date: string; end_date: string }> {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay  = new Date(year, month, 0)

  // Retroceder al lunes anterior o igual al primer día del mes
  const dow = firstDay.getDay() // 0=Dom, 1=Lun, ..., 6=Sáb
  const daysBack = dow === 0 ? 6 : dow - 1
  const weekStart = new Date(firstDay)
  weekStart.setDate(firstDay.getDate() - daysBack)

  const ranges: Array<{ start_date: string; end_date: string }> = []
  const cur = new Date(weekStart)

  while (cur <= lastDay) {
    const end = new Date(cur)
    end.setDate(cur.getDate() + 6)
    ranges.push({
      start_date: dateToLocalString(cur),
      end_date:   dateToLocalString(end),
    })
    cur.setDate(cur.getDate() + 7)
  }
  return ranges
}

export async function getMonthsWithWeeks(branchId: string): Promise<MonthWithWeeks[]> {
  const { data, error } = await supabase
    .from('months')
    .select(`
      id, branch_id, year, month, status, created_at,
      weeks ( id, branch_id, month_id, week_number, start_date, end_date, status, closed_at, closed_by, created_at )
    `)
    .eq('branch_id', branchId)
    .order('year',  { ascending: true })
    .order('month', { ascending: true })

  if (error) throw new Error(`[getMonthsWithWeeks] ${error.message}`)

  // Ordenar semanas por start_date dentro de cada mes
  return (data as MonthWithWeeks[]).map((m) => ({
    ...m,
    weeks: [...m.weeks].sort((a, b) => a.start_date.localeCompare(b.start_date)),
  }))
}

export async function createMonth(
  branchId: string,
  year: number,
  month: number
): Promise<MonthWithWeeks> {
  // 1. Verificar que no exista
  const { data: existing } = await supabase
    .from('months')
    .select('id')
    .eq('branch_id', branchId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle()

  if (existing) throw new Error(`El mes ${MONTH_NAMES[month-1]} ${year} ya existe`)

  // 2. Insertar mes
  const { data: monthData, error: monthErr } = await supabase
    .from('months')
    .insert({ branch_id: branchId, year, month, status: 'active' } satisfies MonthInsert)
    .select()
    .single()

  if (monthErr) throw new Error(`[createMonth] ${monthErr.message}`)

  // 3. Generar e insertar semanas — numeración 1..N por mes (nueva unique constraint per-month)
  const ranges = generateWeekRangesForMonth(year, month)
  const weekInserts: WeekInsert[] = ranges.map((r, i) => ({
    branch_id:   branchId,
    month_id:    monthData.id,
    week_number: i + 1,
    start_date:  r.start_date,
    end_date:    r.end_date,
    status:      'open' as const,   // todas arrancan abiertas; el admin las cierra manualmente
  }))

  const { data: weeksData, error: weeksErr } = await supabase
    .from('weeks')
    .insert(weekInserts)
    .select()

  if (weeksErr) {
    await supabase.from('months').delete().eq('id', monthData.id)
    throw new Error(`[createMonth/weeks] ${weeksErr.message}`)
  }

  return {
    ...monthData,
    weeks: (weeksData as Week[]).sort((a, b) => a.start_date.localeCompare(b.start_date)),
  }
}

export async function closeMonth(monthId: string): Promise<void> {
  const { error } = await supabase
    .from('months')
    .update({ status: 'closed' })
    .eq('id', monthId)

  if (error) throw new Error(`[closeMonth] ${error.message}`)
}

export async function reopenMonth(monthId: string): Promise<void> {
  const { error } = await supabase
    .from('months')
    .update({ status: 'active' })
    .eq('id', monthId)

  if (error) throw new Error(`[reopenMonth] ${error.message}`)
}

// ============================================================
// TRANSACTIONS
// ============================================================

/**
 * Registra un corte. Calcula automáticamente el split y barber_already_collected.
 * Lógica Escenario B: si el pago es transfer/card, el barbero ya tiene ese dinero.
 */
export async function registerCut(
  payload: RegisterCutPayload,
  barber: Profile,
  weekId: string,
  createdBy?: string,
): Promise<Transaction> {
  const commissionRate = barber.commission_rate ?? 0.5
  // Parte del barbero: sobre el precio ORIGINAL (antes del descuento).
  // El descuento lo absorbe la barbería, no el barbero.
  const discountAmt    = payload.discount_amount ?? 0
  const fullPrice      = payload.amount + discountAmt
  const barberShareRaw = Number((fullPrice * commissionRate).toFixed(2))
  // Constraints DB: barber_share >= 0, branch_share >= 0, branch_share + barber_share = amount.
  // Si el descuento es tan grande que barberShareRaw > amount, lo capeamos.
  const barberShare = Math.min(barberShareRaw, payload.amount)
  const branchShare = Number((payload.amount - barberShare).toFixed(2))

  // ── Split payment: si vienen montos parciales, los usamos.
  // Si no, cae todo al payment_method principal.
  const cashAmount     = payload.cash_amount     ?? (payload.payment_method === 'cash'     ? payload.amount : 0)
  const transferAmount = payload.transfer_amount ?? (payload.payment_method === 'transfer' ? payload.amount : 0)
  const cardAmount     = payload.card_amount     ?? (payload.payment_method === 'card'     ? payload.amount : 0)

  // Validar que la suma coincida con el total
  const splitSum = cashAmount + transferAmount + cardAmount
  if (Math.abs(splitSum - payload.amount) > 0.01) {
    throw new Error(`La suma de los métodos (${splitSum}) no coincide con el total (${payload.amount})`)
  }

  // barber_already_collected:
  // - Transferencia: el cliente paga directo al barbero → ya cobró su parte
  // - Efectivo: queda en caja → barbero cobra en la liquidación
  // barber_already_collected <= amount está garantizado porque barberShare <= payload.amount
  const barberAlreadyCollected: number =
    payload.barber_already_collected_override !== undefined
      ? payload.barber_already_collected_override
      : payload.payment_method === 'transfer'
      ? barberShare
      : 0

  const insert: TransactionInsert = {
    branch_id: barber.branch_id,
    barber_id: barber.id,
    service_id: payload.service_id,
    week_id: weekId,
    transaction_date: payload.transaction_date,
    amount: payload.amount,
    payment_method: payload.payment_method,
    branch_share: branchShare,
    barber_share: barberShare,
    commission_rate_snapshot: commissionRate,
    barber_already_collected: barberAlreadyCollected,
    created_by: createdBy ?? barber.id,
    // NEW
    cash_amount: cashAmount,
    transfer_amount: transferAmount,
    card_amount: cardAmount,
    client_name: payload.client_name ?? null,
    discount_amount: payload.discount_amount ?? 0,
    discount_reason: payload.discount_reason ?? null,
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert(insert)
    .select()
    .single()

  if (error) throw new Error(`[registerCut] ${error.message}`)
  return data
}

/**
 * Devuelve transacciones del barbero en un rango de fechas (cruza semanas).
 * Útil para el home con filtro desde-hasta.
 */
export async function getBarberTransactionsByDateRange(
  barberId: string,
  startDate: string,
  endDate: string
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, barber_id, week_id, branch_id, service_id, transaction_date, amount, payment_method, barber_share, branch_share, barber_already_collected, commission_rate_snapshot, is_manual_override, override_notes, created_by, created_at, updated_at, cash_amount, transfer_amount, card_amount, client_name, discount_amount, discount_reason')
    .eq('barber_id', barberId)
    .gte('transaction_date', startDate)
    .lte('transaction_date', endDate)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`[getBarberTransactionsByDateRange] ${error.message}`)
  return data
}

export async function getBarberTransactionsForWeek(
  barberId: string,
  weekId: string
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, barber_id, week_id, branch_id, service_id, transaction_date, amount, payment_method, barber_share, branch_share, barber_already_collected, commission_rate_snapshot, is_manual_override, override_notes, created_by, created_at, updated_at, cash_amount, transfer_amount, card_amount, client_name, discount_amount, discount_reason')
    .eq('barber_id', barberId)
    .eq('week_id', weekId)
    .order('transaction_date', { ascending: false })

  if (error) throw new Error(`[getBarberTransactionsForWeek] ${error.message}`)
  return data
}

export async function getWeekTransactions(
  weekId: string
): Promise<TransactionWithRelations[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(`
      id, barber_id, week_id, branch_id, service_id, transaction_date,
      amount, payment_method, barber_share, branch_share, barber_already_collected,
      commission_rate_snapshot, is_manual_override, override_notes,
      created_by, created_at, updated_at, cash_amount, transfer_amount, card_amount,
      client_name, discount_amount, discount_reason,
      barber:profiles!barber_id ( id, full_name, compensation_type ),
      service:service_catalog!service_id ( id, name )
    `)
    .eq('week_id', weekId)
    .order('transaction_date', { ascending: false })

  if (error) throw new Error(`[getWeekTransactions] ${error.message}`)
  return data as unknown as TransactionWithRelations[]
}

export async function updateTransaction(
  id: string,
  updates: {
    service_id: string | null
    amount: number
    payment_method: string
    barber_share: number
    branch_share: number
    barber_already_collected: number
  }
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`[updateTransaction] ${error.message}`)
}

export async function overrideTransactionSplit(
  transactionId: string,
  branchShare: number,
  barberShare: number,
  barberAlreadyCollected: number,
  notes: string
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({
      branch_share: branchShare,
      barber_share: barberShare,
      barber_already_collected: barberAlreadyCollected,
      is_manual_override: true,
      override_notes: notes,
    })
    .eq('id', transactionId)

  if (error) throw new Error(`[overrideTransactionSplit] ${error.message}`)
}

// ============================================================
// SETTLEMENTS
// ============================================================

export async function calculateSettlement(
  weekId: string,
  barberId: string
): Promise<string> {
  const { data, error } = await supabase.rpc('calculate_settlement', {
    p_week_id: weekId,
    p_barber_id: barberId,
  })

  if (error) throw new Error(`[calculateSettlement] ${error.message}`)
  return data as string
}

export async function calculateAllSettlementsForWeek(
  weekId: string,
  barberIds: string[]
): Promise<void> {
  const results = await Promise.allSettled(
    barberIds.map((id) => calculateSettlement(weekId, id))
  )

  const failures = results.filter((r) => r.status === 'rejected')
  if (failures.length > 0) {
    console.error('[calculateAllSettlementsForWeek] Algunos settlements fallaron:', failures)
    throw new Error(`${failures.length} settlement(s) no pudieron calcularse`)
  }
}

export async function getSettlementsForWeek(
  weekId: string
): Promise<SettlementWithBarber[]> {
  const { data, error } = await supabase
    .from('settlements')
    .select(`
      *,
      barber:profiles!barber_id ( id, full_name, compensation_type ),
      week:weeks!week_id ( id, week_number, start_date, end_date, status )
    `)
    .eq('week_id', weekId)
    .order('net_payable', { ascending: false })

  if (error) throw new Error(`[getSettlementsForWeek] ${error.message}`)
  return data as SettlementWithBarber[]
}

export async function getBarberSettlements(
  barberId: string
): Promise<SettlementWithBarber[]> {
  const { data, error } = await supabase
    .from('settlements')
    .select(`
      *,
      barber:profiles!barber_id ( id, full_name, compensation_type ),
      week:weeks!week_id ( id, week_number, start_date, end_date, status )
    `)
    .eq('barber_id', barberId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`[getBarberSettlements] ${error.message}`)
  return data as SettlementWithBarber[]
}

export async function setPresentismo(
  settlementId: string,
  weekId: string,
  barberId: string,
  met: boolean
): Promise<void> {
  const { error } = await supabase
    .from('settlements')
    .update({ presentismo_met: met } satisfies SettlementUpdate)
    .eq('id', settlementId)

  if (error) throw new Error(`[setPresentismo] ${error.message}`)

  await calculateSettlement(weekId, barberId)
}

export async function confirmSettlement(settlementId: string): Promise<void> {
  const { error } = await supabase
    .from('settlements')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    } satisfies SettlementUpdate)
    .eq('id', settlementId)

  if (error) throw new Error(`[confirmSettlement] ${error.message}`)
}

export async function markSettlementPaid(settlementId: string): Promise<void> {
  // 1. Marcar settlement como pagado y obtener barber+branch para descontar adelantos
  const { data: paid, error } = await supabase
    .from('settlements')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    } satisfies SettlementUpdate)
    .eq('id', settlementId)
    .select('barber_id, branch_id')
    .single()

  if (error) throw new Error(`[markSettlementPaid] ${error.message}`)
  if (!paid) return

  // 2. Marcar adelantos pending/approved del barbero como deducted (evita doble descuento)
  const { error: advErr } = await supabase
    .from('advances')
    .update({ status: 'deducted' } satisfies AdvanceUpdate)
    .eq('barber_id', paid.barber_id)
    .eq('branch_id', paid.branch_id)
    .in('status', ['pending', 'approved'])

  if (advErr) {
    console.error('[markSettlementPaid/advances]', advErr.message)
  }
}

// ============================================================
// ADVANCES
// ============================================================
export async function createAdvance(payload: AdvanceInsert): Promise<Advance> {
  const { data, error } = await supabase
    .from('advances')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`[createAdvance] ${error.message}`)
  return data
}

export async function getPendingAdvances(barberId: string): Promise<Advance[]> {
  const { data, error } = await supabase
    .from('advances')
    .select('*')
    .eq('barber_id', barberId)
    .eq('status', 'pending')
    .order('advance_date', { ascending: false })

  if (error) throw new Error(`[getPendingAdvances] ${error.message}`)
  return data
}

export async function getAdvancesByDateRange(
  branchId: string,
  startDate: string,
  endDate: string
): Promise<AdvanceWithBarber[]> {
  const { data, error } = await supabase
    .from('advances')
    .select(`
      *,
      barber:profiles!barber_id ( id, full_name )
    `)
    .eq('branch_id', branchId)
    .gte('advance_date', startDate)
    .lte('advance_date', endDate)
    .in('status', ['pending', 'approved'])
    .order('advance_date', { ascending: false })

  if (error) throw new Error(`[getAdvancesByDateRange] ${error.message}`)
  return data as AdvanceWithBarber[]
}

export async function getPendingAdvancesByBranch(
  branchId: string
): Promise<AdvanceWithBarber[]> {
  const { data, error } = await supabase
    .from('advances')
    .select(`
      *,
      barber:profiles!barber_id ( id, full_name )
    `)
    .eq('branch_id', branchId)
    .in('status', ['pending', 'approved'])
    .order('advance_date', { ascending: false })

  if (error) throw new Error(`[getPendingAdvancesByBranch] ${error.message}`)
  return data as AdvanceWithBarber[]
}

export async function approveAdvance(advanceId: string): Promise<void> {
  const { error } = await supabase
    .from('advances')
    .update({ status: 'approved' } satisfies AdvanceUpdate)
    .eq('id', advanceId)
    .eq('status', 'pending')

  if (error) throw new Error(`[approveAdvance] ${error.message}`)
}

export async function cancelAdvance(advanceId: string): Promise<void> {
  const { error } = await supabase
    .from('advances')
    .update({ status: 'cancelled' } satisfies AdvanceUpdate)
    .eq('id', advanceId)

  if (error) throw new Error(`[cancelAdvance] ${error.message}`)
}

// ============================================================
// EXPENSES
// ============================================================
export async function createExpense(payload: ExpenseInsert): Promise<Expense> {
  const { data, error } = await supabase
    .from('expenses')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`[createExpense] ${error.message}`)
  return data
}

export async function getExpensesByBranch(
  branchId: string,
  from: string,
  to: string
): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('branch_id', branchId)
    .gte('expense_date', from)
    .lte('expense_date', to)
    .order('expense_date', { ascending: false })

  if (error) throw new Error(`[getExpensesByBranch] ${error.message}`)
  return data
}

export async function getExpensesByWeek(weekId: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('week_id', weekId)
    .order('expense_date', { ascending: false })

  if (error) throw new Error(`[getExpensesByWeek] ${error.message}`)
  return data
}

// ============================================================
// REPORTS
// ============================================================
export async function getReportByPeriod(
  branches: Pick<Branch, 'id' | 'name'>[],
  startDate: string,
  endDate: string
): Promise<BranchReport[]> {
  const branchIds = branches.map((b) => b.id)

  const [{ data: txData }, { data: expData }] = await Promise.all([
    supabase
      .from('transactions')
      .select('branch_id, amount, branch_share, barber_share')
      .in('branch_id', branchIds)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate),
    supabase
      .from('expenses')
      .select('branch_id, amount, category')
      .in('branch_id', branchIds)
      .gte('expense_date', startDate)
      .lte('expense_date', endDate),
  ])

  return branches.map((branch) => {
    const txs = (txData ?? []).filter((t) => t.branch_id === branch.id)
    const exps = (expData ?? []).filter((e) => e.branch_id === branch.id)

    const totalIncome   = txs.reduce((s, t) => s + t.amount, 0)
    const branchShare   = txs.reduce((s, t) => s + t.branch_share, 0)
    const barberShare   = txs.reduce((s, t) => s + t.barber_share, 0)
    const totalExpenses = exps.reduce((s, e) => s + e.amount, 0)
    const netProfit     = branchShare - totalExpenses
    const profitMargin  = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0

    const expensesByCategory: Record<string, number> = {}
    exps.forEach((e) => {
      expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + e.amount
    })

    return {
      branchId: branch.id,
      branchName: branch.name,
      cutCount: txs.length,
      totalIncome,
      branchShare,
      barberShare,
      totalExpenses,
      expensesByCategory,
      netProfit,
      profitMargin,
    }
  })
}

// ============================================================
// PROFILES (Admin)
// ============================================================
export async function getBarbersByBranch(branchId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('branch_id', branchId)
    .eq('role', 'barber')
    .eq('is_active', true)
    .order('full_name')

  if (error) throw new Error(`[getBarbersByBranch] ${error.message}`)
  return data
}

export async function getAllBarbersByBranch(branchId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('branch_id', branchId)
    .eq('role', 'barber')
    .order('full_name')

  if (error) throw new Error(`[getAllBarbersByBranch] ${error.message}`)
  return data
}

export async function updateBarberProfile(
  id: string,
  updates: ProfileUpdate
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`[updateBarberProfile] ${error.message}`)
}
