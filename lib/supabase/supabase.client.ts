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
  SettlementStatus,
  SettlementWithBarber,
  SettlementUpdate,
  Advance,
  AdvanceInsert,
  AdvanceUpdate,
  AdvanceWithBarber,
  Expense,
  ExpenseInsert,
  ExpenseUpdate,
  RevenueBalance,
  BarberDebtPayment,
  BarberDebtPaymentInsert,
  BarberDebtSummary,
  PaymentMethod,
  ProfileUpdate,
  WeekUpdate,
  ServiceCatalog,
  ServiceCatalogInsert,
  RegisterCutPayload,
  Benefit,
  BenefitInsert,
  BenefitUpdate,
  MaintenanceSettings,
  MaintenanceTemplateBlockWithTasks,
  MaintenanceSheetWithItems,
  MaintenanceSheetItem,
  MaintenanceTemplateDraftBlock,
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
// BENEFITS (Mejora 1)
// ============================================================

/** Todos los beneficios de la sucursal (para ABM admin) */
export async function getBenefitsByBranch(branchId: string): Promise<Benefit[]> {
  const { data, error } = await supabase
    .from('benefits')
    .select('id, branch_id, name, description, discount_type, discount_value, is_active, created_at, full_amount_to_barber')
    .eq('branch_id', branchId)
    .order('name')

  if (error) throw new Error(`[getBenefitsByBranch] ${error.message}`)
  return data
}

/** Solo beneficios activos (para el dropdown al registrar cortes) */
export async function getActiveBenefitsByBranch(branchId: string): Promise<Benefit[]> {
  const { data, error } = await supabase
    .from('benefits')
    .select('id, branch_id, name, description, discount_type, discount_value, is_active, created_at, full_amount_to_barber')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('name')

  if (error) throw new Error(`[getActiveBenefitsByBranch] ${error.message}`)
  return data
}

export async function createBenefit(payload: BenefitInsert): Promise<Benefit> {
  const { data, error } = await supabase
    .from('benefits')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`[createBenefit] ${error.message}`)
  return data
}

export async function updateBenefit(id: string, updates: BenefitUpdate): Promise<void> {
  const { error } = await supabase
    .from('benefits')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`[updateBenefit] ${error.message}`)
}

/**
 * Calcula el monto de descuento ($) que aplica un beneficio sobre un precio.
 * 'fixed' → monto fijo (acotado al precio). 'percentage' → % del precio.
 */
export function computeBenefitDiscount(benefit: Benefit, price: number): number {
  if (price <= 0) return 0
  const raw =
    benefit.discount_type === 'percentage'
      ? price * (benefit.discount_value / 100)
      : benefit.discount_value
  return Number(Math.min(Math.max(raw, 0), price).toFixed(2))
}

// ============================================================
// WEEKS
// ============================================================
export async function getOpenWeek(branchId: string): Promise<Week | null> {
  const today = todayLocal()
  // Resolvemos la prioridad en SQL (no en JS). Antes traíamos solo 10 semanas
  // abiertas ordenadas por start_date asc y filtrábamos en memoria; con muchas
  // semanas abiertas (cientos en prod) la semana que contiene hoy quedaba fuera
  // del límite y el barbero no podía cargar cortes. Cada prioridad es 1 query
  // acotada a 1 fila, así no depende de cuántas semanas abiertas existan.
  const base = () =>
    supabase
      .from('weeks')
      .select('*')
      .eq('branch_id', branchId)
      .eq('status', 'open')

  // Las 3 prioridades se disparan en paralelo (esta función está en el camino
  // crítico del arranque del mobile): 1 RTT en vez de hasta 3 secuenciales.
  const [
    { data: current, error: e1 },
    { data: future, error: e2 },
    { data: past, error: e3 },
  ] = await Promise.all([
    // Prioridad 1: semana abierta que contiene hoy
    base()
      .lte('start_date', today)
      .gte('end_date', today)
      .order('start_date', { ascending: false })
      .limit(1),
    // Prioridad 2: próxima semana abierta futura (la más cercana)
    base()
      .gt('start_date', today)
      .order('start_date', { ascending: true })
      .limit(1),
    // Prioridad 3: semana abierta pasada más reciente
    base()
      .lt('start_date', today)
      .order('start_date', { ascending: false })
      .limit(1),
  ])
  const err = e1 ?? e2 ?? e3
  if (err) throw new Error(`[getOpenWeek] ${err.message}`)
  return current?.[0] ?? future?.[0] ?? past?.[0] ?? null
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

/**
 * Mejora 2: habilita/deshabilita días dom-lun puntuales para que los barberos
 * puedan cargar cortes esa fecha. `dates` es la lista completa de fechas (YYYY-MM-DD)
 * habilitadas para la semana. Devuelve la semana actualizada.
 */
export async function updateBarberExtraDays(
  weekId: string,
  dates: string[]
): Promise<Week> {
  const { data, error } = await supabase
    .from('weeks')
    .update({ barber_extra_days: dates } satisfies WeekUpdate)
    .eq('id', weekId)
    .select('*')
    .single()

  if (error) throw new Error(`[updateBarberExtraDays] ${error.message}`)
  return data as Week
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

/**
 * Mejora 2: genera rangos martes-sábado (5 días hábiles) para todas las
 * semanas que tocan el mes. Refleja el horario real del negocio: la
 * barbería trabaja de martes a sábado (domingo y lunes cerrado).
 * Cada semana arranca un martes y termina el sábado siguiente.
 */
function generateWeekRangesForMonth(year: number, month: number): Array<{ start_date: string; end_date: string }> {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay  = new Date(year, month, 0)

  // Retroceder al martes anterior o igual al primer día del mes (0=Dom ... 2=Mar ... 6=Sáb)
  const dow = firstDay.getDay()
  const daysBack = (dow - 2 + 7) % 7
  const weekStart = new Date(firstDay)
  weekStart.setDate(firstDay.getDate() - daysBack)

  const ranges: Array<{ start_date: string; end_date: string }> = []
  const cur = new Date(weekStart)

  while (cur <= lastDay) {
    const end = new Date(cur)
    end.setDate(cur.getDate() + 4) // martes (+0) → sábado (+4)
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
  const isBoxRental = barber.compensation_type === 'box_rental'
  // La comisión del barbero es el % sobre el monto facturado (ya con el
  // descuento aplicado). El descuento lo absorben barbero y barbería en
  // proporción a su split: cada uno su % sobre el monto efectivamente cobrado.
  const barberShareRaw = Number((payload.amount * commissionRate).toFixed(2))

  // Constraints DB: barber_share >= 0, branch_share >= 0, branch_share + barber_share = amount.
  let barberShare: number
  let branchShare: number
  if (isBoxRental) {
    // Alquiler de box DIARIO: los primeros $box_rental_amount de cortes de cada día
    // saldan el alquiler (van a la barbería); lo que exceda ese monto es del barbero.
    // Partimos ESTE corte según el acumulado del día previo a él.
    const dailyRent = barber.box_rental_amount ?? 0
    const { data: prior, error: pErr } = await supabase
      .from('transactions')
      .select('amount')
      .eq('barber_id', barber.id)
      .eq('transaction_date', payload.transaction_date)
    if (pErr) throw new Error(`[registerCut] acumulado del día: ${pErr.message}`)
    const accumulatedToday = (prior ?? []).reduce((s, t) => s + Number(t.amount), 0)
    const toShop = Math.min(payload.amount, Math.max(0, dailyRent - accumulatedToday))
    branchShare = Number(toShop.toFixed(2))
    barberShare = Number((payload.amount - toShop).toFixed(2))
  } else if (payload.benefit_full_amount_to_barber && barber.compensation_type === 'percentage') {
    // Beneficio VIP: el monto ya descontado va 100% al barbero, la barbería no
    // gana nada de este corte. Solo aplica a comisión % (sueldo fijo y alquiler
    // de box no reparten por corte, así que se comportan como beneficio normal).
    barberShare = payload.amount
    branchShare = 0
  } else {
    barberShare = Math.max(0, Math.min(barberShareRaw, payload.amount))
    branchShare = Number((payload.amount - barberShare).toFixed(2))
  }

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

  // barber_already_collected = plata que el barbero ya tiene físicamente en su cuenta.
  // Si el barbero RECIBE transferencias, el cliente le transfiere directo → el barbero
  // retiene el TOTAL transferido del corte (no solo su comisión). En la liquidación se
  // compara ese "ya cobrado" contra lo que realmente le corresponde (total_earned):
  //   - ya cobrado > lo que le corresponde  → el barbero le debe a la barbería
  //   - ya cobrado < lo que le corresponde  → la barbería le debe al barbero
  // Si NO recibe transferencias, la plata va a la cuenta de Valhalla → ya cobrado = 0.
  // Efectivo/tarjeta no se acreditan a la cuenta del barbero → no suman a "ya cobrado".
  // box_rental: se queda su parte del corte (lo que excede el alquiler diario),
  // ya sea efectivo o transferencia; la parte de alquiler (branchShare) va a la barbería.
  const barberAlreadyCollected: number =
    payload.barber_already_collected_override !== undefined
      ? payload.barber_already_collected_override
      : isBoxRental
      ? barberShare
      : barber.receives_transfers
      ? transferAmount
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
    client_surname: payload.client_surname ?? null,
    discount_amount: payload.discount_amount ?? 0,
    discount_reason: payload.discount_reason ?? null,
    benefit_id: payload.benefit_id ?? null,
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
 * Edita un corte existente reusando EXACTAMENTE la misma lógica financiera que
 * registerCut (comisión, split, ya cobrado). No cambia week_id ni barber_id:
 * solo actualiza los campos editables del corte. Se usa cuando el barbero (o el
 * admin) corrige un corte de una semana NO liquidada.
 */
export async function updateCut(
  txId: string,
  payload: RegisterCutPayload,
  barber: Profile,
): Promise<Transaction> {
  const commissionRate = barber.commission_rate ?? 0.5
  const isBoxRental = barber.compensation_type === 'box_rental'
  const barberShareRaw = Number((payload.amount * commissionRate).toFixed(2))

  let barberShare: number
  let branchShare: number
  if (isBoxRental) {
    // Alquiler de box DIARIO (mismo criterio que registerCut). Acumulado del día
    // considerando los OTROS cortes de esa fecha (excluye el que estamos editando).
    const dailyRent = barber.box_rental_amount ?? 0
    const { data: prior, error: pErr } = await supabase
      .from('transactions')
      .select('amount')
      .eq('barber_id', barber.id)
      .eq('transaction_date', payload.transaction_date)
      .neq('id', txId)
    if (pErr) throw new Error(`[updateCut] acumulado del día: ${pErr.message}`)
    const accumulatedToday = (prior ?? []).reduce((s, t) => s + Number(t.amount), 0)
    const toShop = Math.min(payload.amount, Math.max(0, dailyRent - accumulatedToday))
    branchShare = Number(toShop.toFixed(2))
    barberShare = Number((payload.amount - toShop).toFixed(2))
  } else if (payload.benefit_full_amount_to_barber && barber.compensation_type === 'percentage') {
    // Beneficio VIP: ver comentario equivalente en registerCut.
    barberShare = payload.amount
    branchShare = 0
  } else {
    barberShare = Math.max(0, Math.min(barberShareRaw, payload.amount))
    branchShare = Number((payload.amount - barberShare).toFixed(2))
  }

  const cashAmount     = payload.cash_amount     ?? (payload.payment_method === 'cash'     ? payload.amount : 0)
  const transferAmount = payload.transfer_amount ?? (payload.payment_method === 'transfer' ? payload.amount : 0)
  const cardAmount     = payload.card_amount     ?? (payload.payment_method === 'card'     ? payload.amount : 0)

  const splitSum = cashAmount + transferAmount + cardAmount
  if (Math.abs(splitSum - payload.amount) > 0.01) {
    throw new Error(`La suma de los métodos (${splitSum}) no coincide con el total (${payload.amount})`)
  }

  const barberAlreadyCollected: number =
    payload.barber_already_collected_override !== undefined
      ? payload.barber_already_collected_override
      : isBoxRental
      ? barberShare
      : barber.receives_transfers
      ? transferAmount
      : 0

  const update = {
    service_id: payload.service_id,
    transaction_date: payload.transaction_date,
    amount: payload.amount,
    payment_method: payload.payment_method,
    branch_share: branchShare,
    barber_share: barberShare,
    commission_rate_snapshot: commissionRate,
    barber_already_collected: barberAlreadyCollected,
    cash_amount: cashAmount,
    transfer_amount: transferAmount,
    card_amount: cardAmount,
    client_name: payload.client_name ?? null,
    client_surname: payload.client_surname ?? null,
    discount_amount: payload.discount_amount ?? 0,
    discount_reason: payload.discount_reason ?? null,
    benefit_id: payload.benefit_id ?? null,
    // Una edición del barbero NO es un override de admin: reseteamos el flag para
    // cumplir la RLS del barbero (WITH CHECK exige is_manual_override = false) y
    // permitir re-editar cortes que el admin haya tocado antes.
    is_manual_override: false,
  }

  const { data, error } = await supabase
    .from('transactions')
    .update(update)
    .eq('id', txId)
    .select()
    .single()

  if (error) throw new Error(`[updateCut] ${error.message}`)

  // Box_rental: editar un corte cambia el umbral del día, así que el split (alquiler
  // vs barbero) de TODOS los cortes de esa fecha se puede correr. Recalculamos el día
  // completo en orden cronológico; el resync devuelve los splits finales, así que
  // armamos el corte actualizado en memoria sin un refetch extra.
  if (isBoxRental) {
    const splits = await resyncBoxRentalDaySplits(barber.id, payload.transaction_date, barber.box_rental_amount ?? 0, true)
    const s = splits.get(txId)
    return s ? { ...data, ...s } : data
  }
  return data
}

/**
 * Recalcula el reparto alquiler/barbero de TODOS los cortes de un barbero box_rental
 * en un día, en orden cronológico: los primeros $dailyRent van a la barbería y el
 * resto al barbero. Se usa tras editar un corte (el umbral del día se corre).
 */
async function resyncBoxRentalDaySplits(
  barberId: string,
  date: string,
  dailyRent: number,
  // Edición del barbero: resetea is_manual_override para cumplir su RLS (WITH CHECK
  // exige false). Edición del admin: lo deja como está (preserva el flag de auditoría).
  clearOverride: boolean,
): Promise<Map<string, { branch_share: number; barber_share: number; barber_already_collected: number }>> {
  const { data: cuts, error } = await supabase
    .from('transactions')
    .select('id, amount, branch_share, barber_share, barber_already_collected, is_manual_override')
    .eq('barber_id', barberId)
    .eq('transaction_date', date)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new Error(`[resyncBoxRentalDaySplits] ${error.message}`)
  let acc = 0
  const splits = new Map<string, { branch_share: number; barber_share: number; barber_already_collected: number }>()
  const updates: PromiseLike<void>[] = []
  for (const c of cuts ?? []) {
    const amt = Number(c.amount)
    const toShop = Math.min(amt, Math.max(0, dailyRent - acc))
    const branch = Number(toShop.toFixed(2))
    const barber = Number((amt - toShop).toFixed(2))
    acc += amt
    splits.set(c.id, { branch_share: branch, barber_share: barber, barber_already_collected: barber })
    // Solo se escriben los cortes cuyo split realmente cambió (una edición suele
    // mover 1-2 cortes del día), y todos los updates salen en paralelo.
    const unchanged =
      Number(c.branch_share) === branch &&
      Number(c.barber_share) === barber &&
      Number(c.barber_already_collected) === barber &&
      (!clearOverride || !c.is_manual_override)
    if (unchanged) continue
    const patch: Record<string, number | boolean> = {
      branch_share: branch, barber_share: barber, barber_already_collected: barber,
    }
    if (clearOverride) patch.is_manual_override = false
    updates.push(
      supabase
        .from('transactions')
        .update(patch)
        .eq('id', c.id)
        .then(({ error: uErr }) => {
          if (uErr) throw new Error(`[resyncBoxRentalDaySplits] ${uErr.message}`)
        })
    )
  }
  await Promise.all(updates)
  return splits
}

/**
 * Dado un set de week_ids, devuelve los que están liquidados (confirmed/paid)
 * para ese barbero. Sirve para bloquear la edición de cortes de semanas cerradas
 * en la vista de cortes filtrados por fecha.
 */
export async function getBarberClosedWeekIds(
  barberId: string,
  // Sin weekIds devuelve TODAS las semanas liquidadas del barbero (son pocas),
  // lo que permite pedirlas en paralelo con las transacciones del rango.
  weekIds?: string[],
): Promise<string[]> {
  if (weekIds && weekIds.length === 0) return []
  let query = supabase
    .from('settlements')
    .select('week_id')
    .eq('barber_id', barberId)
    .in('status', ['confirmed', 'paid'])
  if (weekIds) query = query.in('week_id', weekIds)
  const { data, error } = await query
  if (error) throw new Error(`[getBarberClosedWeekIds] ${error.message}`)
  return (data ?? []).map((r) => r.week_id as string)
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
    .select('id, barber_id, week_id, branch_id, service_id, transaction_date, amount, payment_method, barber_share, branch_share, barber_already_collected, commission_rate_snapshot, is_manual_override, override_notes, created_by, created_at, updated_at, cash_amount, transfer_amount, card_amount, client_name, client_surname, discount_amount, discount_reason, benefit_id')
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
    .select('id, barber_id, week_id, branch_id, service_id, transaction_date, amount, payment_method, barber_share, branch_share, barber_already_collected, commission_rate_snapshot, is_manual_override, override_notes, created_by, created_at, updated_at, cash_amount, transfer_amount, card_amount, client_name, client_surname, discount_amount, discount_reason, benefit_id')
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
      client_name, client_surname, discount_amount, discount_reason, benefit_id,
      barber:profiles!barber_id ( id, full_name, compensation_type, receives_transfers, box_rental_amount ),
      service:service_catalog!service_id ( id, name )
    `)
    .eq('week_id', weekId)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })

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

export async function fullEditTransaction(
  txId: string,
  updates: {
    transaction_date: string
    week_id: string
    service_id: string | null
    amount: number
    discount_amount: number
    discount_reason: string | null
    payment_method: string
    cash_amount: number
    transfer_amount: number
    card_amount: number
    client_name: string | null
    client_surname: string | null
    barber_share: number
    branch_share: number
    barber_already_collected: number
    override_notes: string
    benefit_id?: string | null
  }
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ ...updates, is_manual_override: true })
    .eq('id', txId)
  if (error) throw new Error(`[fullEditTransaction] ${error.message}`)

  // Box_rental: editar corre el umbral del día → recalcular el reparto alquiler/barbero
  // de TODOS los cortes de esa fecha (fuente de verdad del split diario).
  const { data: row } = await supabase
    .from('transactions')
    .select('barber_id, transaction_date, barber:profiles!barber_id ( compensation_type, box_rental_amount )')
    .eq('id', txId)
    .single()
  const b = (row as { barber?: { compensation_type?: string; box_rental_amount?: number | null } } | null)?.barber
  if (b?.compensation_type === 'box_rental') {
    await resyncBoxRentalDaySplits(
      (row as { barber_id: string }).barber_id,
      (row as { transaction_date: string }).transaction_date,
      Number(b.box_rental_amount ?? 0),
      false, // admin: preserva el flag is_manual_override que ya fijó fullEditTransaction
    )
  }
}

/**
 * Suma facturada (amount) de un barbero en una fecha. `excludeTxId` permite excluir
 * el corte que se está editando para calcular el acumulado "previo" del día.
 */
export async function getBarberDayGross(
  barberId: string,
  date: string,
  excludeTxId?: string,
): Promise<number> {
  let q = supabase
    .from('transactions')
    .select('amount')
    .eq('barber_id', barberId)
    .eq('transaction_date', date)
  if (excludeTxId) q = q.neq('id', excludeTxId)
  const { data, error } = await q
  if (error) throw new Error(`[getBarberDayGross] ${error.message}`)
  return (data ?? []).reduce((s, t) => s + Number(t.amount), 0)
}

/**
 * Mejora 3: elimina una transacción (solo admin, vía RPC SECURITY DEFINER).
 * El RPC recalcula automáticamente la liquidación en borrador del barbero/semana
 * si existe; las liquidaciones confirmadas/pagadas no se tocan.
 */
export async function deleteTransaction(transactionId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_transaction_admin', {
    p_tx_id: transactionId,
  })
  if (error) throw new Error(`[deleteTransaction] ${error.message}`)
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
  if (barberIds.length === 0) return
  // Un solo RPC server-side itera los barberos dentro de Postgres (1 round-trip,
  // 1 transacción) en vez de N llamadas calculate_settlement desde el cliente.
  const { error } = await supabase.rpc('calculate_all_settlements', {
    p_week_id: weekId,
    p_barber_ids: barberIds,
  })
  if (error) throw new Error(`[calculateAllSettlementsForWeek] ${error.message}`)
}

/**
 * Recálculo COMPLETO de una liquidación en borrador desde el ABM del barbero.
 * Recomputa el barber_share/branch_share de cada corte de la semana con la
 * comisión ACTUAL (no la congelada al registrar) y luego recalcula la
 * liquidación (comisión base + bonos de presentismo/objetivo con las tasas
 * vigentes). Solo opera sobre liquidaciones en estado 'draft'.
 */
export async function recalculateSettlementFull(
  weekId: string,
  barberId: string,
): Promise<void> {
  const { error } = await supabase.rpc('recalculate_settlement_full', {
    p_week_id: weekId,
    p_barber_id: barberId,
  })
  if (error) throw new Error(`[recalculateSettlementFull] ${error.message}`)
}

// ============================================================
// DEUDAS DE BARBEROS (saldo deudor + pagos de deuda)
// ============================================================

/**
 * Liquidaciones CONFIRMADAS con deuda de una sucursal (saldo deudor). Cada fila
 * es una liquidación negativa todavía sin pagar; al marcarla pagada deja de
 * aparecer (deuda saldada).
 */
export async function getBarberDebtSummary(branchId: string): Promise<BarberDebtSummary[]> {
  const { data, error } = await supabase.rpc('get_barber_debt_summary', {
    p_branch_id: branchId,
  })
  if (error) throw new Error(`[getBarberDebtSummary] ${error.message}`)
  type Row = { settlement_id: string; barber_id: string; full_name: string; week_start: string; week_end: string; debt: number }
  return ((data as Row[] | null) ?? []).map((r) => ({
    settlementId: r.settlement_id,
    barberId:     r.barber_id,
    fullName:     r.full_name,
    weekStart:    r.week_start,
    weekEnd:      r.week_end,
    debt:         Number(r.debt),
  }))
}

/** Registra un pago/devolución de deuda de un barbero. */
export async function recordDebtPayment(input: {
  barberId: string
  branchId: string
  amount: number
  paymentMethod: PaymentMethod
  paymentDate: string
  notes?: string | null
  registeredBy: string
}): Promise<void> {
  const insert: BarberDebtPaymentInsert = {
    barber_id:      input.barberId,
    branch_id:      input.branchId,
    amount:         input.amount,
    payment_method: input.paymentMethod,
    payment_date:   input.paymentDate,
    notes:          input.notes ?? null,
    registered_by:  input.registeredBy,
  }
  const { error } = await supabase.from('barber_debt_payments').insert(insert)
  if (error) throw new Error(`[recordDebtPayment] ${error.message}`)
}

/** Historial de pagos de deuda de un barbero en una sucursal (más reciente primero). */
export async function getBarberDebtPayments(
  barberId: string,
  branchId: string,
): Promise<BarberDebtPayment[]> {
  const { data, error } = await supabase
    .from('barber_debt_payments')
    .select('*')
    .eq('barber_id', barberId)
    .eq('branch_id', branchId)
    .order('payment_date', { ascending: false })
  if (error) throw new Error(`[getBarberDebtPayments] ${error.message}`)
  return (data as BarberDebtPayment[] | null) ?? []
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

/**
 * Estado de la liquidación de un barbero para una semana.
 * Se usa para "cerrar semana por barbero": si está 'confirmed' o 'paid',
 * la semana queda cerrada para ese barbero y no puede cargar más cortes.
 * Devuelve null si aún no hay liquidación calculada.
 */
export async function getSettlementStatusForWeek(
  weekId: string,
  barberId: string
): Promise<SettlementStatus | null> {
  const { data, error } = await supabase
    .from('settlements')
    .select('status')
    .eq('week_id', weekId)
    .eq('barber_id', barberId)
    .maybeSingle()

  if (error) throw new Error(`[getSettlementStatusForWeek] ${error.message}`)
  return (data?.status as SettlementStatus | undefined) ?? null
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

/**
 * Mejora 4: marca/desmarca el objetivo cumplido (override manual del admin).
 * Mismo patrón que setPresentismo: setea el flag y recalcula la liquidación,
 * que toma objetivo_rate del barbero sobre el total facturado para el bono.
 */
export async function setObjetivo(
  settlementId: string,
  weekId: string,
  barberId: string,
  met: boolean
): Promise<void> {
  const { error } = await supabase
    .from('settlements')
    .update({ objetivo_met: met } satisfies SettlementUpdate)
    .eq('id', settlementId)

  if (error) throw new Error(`[setObjetivo] ${error.message}`)

  await calculateSettlement(weekId, barberId)
}

/**
 * Alquiler de box: monto que el barbero (box_rental) le paga a la barbería esa
 * semana. Se setea en borrador y se descuenta del neto. Recalcula la liquidación.
 */
export async function setBoxRent(
  settlementId: string,
  weekId: string,
  barberId: string,
  amount: number
): Promise<void> {
  const { error } = await supabase
    .from('settlements')
    .update({ box_rent: amount } satisfies SettlementUpdate)
    .eq('id', settlementId)

  if (error) throw new Error(`[setBoxRent] ${error.message}`)

  await calculateSettlement(weekId, barberId)
}

/**
 * Override manual del monto de bono de presentismo. `amount = null` vuelve al
 * cálculo automático por tasa. Recalcula la liquidación (que respeta el override).
 */
export async function setBonusPresentismoOverride(
  settlementId: string,
  weekId: string,
  barberId: string,
  amount: number | null
): Promise<void> {
  const { error } = await supabase
    .from('settlements')
    .update({ bonus_presentismo_override: amount } satisfies SettlementUpdate)
    .eq('id', settlementId)

  if (error) throw new Error(`[setBonusPresentismoOverride] ${error.message}`)

  await calculateSettlement(weekId, barberId)
}

/**
 * Override manual del monto de bono de objetivo. `amount = null` vuelve al
 * cálculo automático por tasa. Recalcula la liquidación.
 */
export async function setBonusObjetivoOverride(
  settlementId: string,
  weekId: string,
  barberId: string,
  amount: number | null
): Promise<void> {
  const { error } = await supabase
    .from('settlements')
    .update({ bonus_objetivo_override: amount } satisfies SettlementUpdate)
    .eq('id', settlementId)

  if (error) throw new Error(`[setBonusObjetivoOverride] ${error.message}`)

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

export async function deleteSettlement(
  settlementId: string
): Promise<{ weekReverted: boolean }> {
  // 1. Obtener datos del settlement antes de eliminar
  const { data: s, error: e1 } = await supabase
    .from('settlements')
    .select('barber_id, branch_id, week_id, status')
    .eq('id', settlementId)
    .single()
  if (e1 || !s) throw new Error(`[deleteSettlement] ${e1?.message ?? 'no encontrado'}`)

  // 2. Eliminar el settlement
  const { error: e2 } = await supabase.from('settlements').delete().eq('id', settlementId)
  if (e2) throw new Error(`[deleteSettlement] ${e2.message}`)

  // 3. Si estaba pagado: revertir adelantos deducted → approved
  if (s.status === 'paid') {
    const { error: advErr } = await supabase
      .from('advances')
      .update({ status: 'approved' } satisfies AdvanceUpdate)
      .eq('barber_id', s.barber_id)
      .eq('branch_id', s.branch_id)
      .eq('status', 'deducted')
    if (advErr) console.error('[deleteSettlement/advances]', advErr.message)
  }

  // 4. Si la semana era "paid", revertirla a "closed"
  let weekReverted = false
  const { data: week } = await supabase
    .from('weeks')
    .select('status')
    .eq('id', s.week_id)
    .single()
  if (week?.status === 'paid') {
    await supabase.from('weeks').update({ status: 'closed' }).eq('id', s.week_id)
    weekReverted = true
  }

  return { weekReverted }
}

/**
 * Anula una liquidación confirmada o pagada: la devuelve a estado 'draft'
 * (sin eliminarla) para poder corregirla y volver a confirmar.
 * - Limpia confirmed_at / paid_at.
 * - Si estaba 'paid': revierte adelantos deducted → approved.
 * - Si la semana estaba 'paid': la revierte a 'closed'.
 */
export async function cancelSettlement(
  settlementId: string
): Promise<{ weekReverted: boolean }> {
  const { data: s, error: e1 } = await supabase
    .from('settlements')
    .select('barber_id, branch_id, week_id, status')
    .eq('id', settlementId)
    .single()
  if (e1 || !s) throw new Error(`[cancelSettlement] ${e1?.message ?? 'no encontrado'}`)

  const { error: e2 } = await supabase
    .from('settlements')
    .update({ status: 'draft', confirmed_at: null, paid_at: null } satisfies SettlementUpdate)
    .eq('id', settlementId)
  if (e2) throw new Error(`[cancelSettlement] ${e2.message}`)

  // Si estaba pagado: revertir adelantos deducted → approved
  if (s.status === 'paid') {
    const { error: advErr } = await supabase
      .from('advances')
      .update({ status: 'approved' } satisfies AdvanceUpdate)
      .eq('barber_id', s.barber_id)
      .eq('branch_id', s.branch_id)
      .eq('status', 'deducted')
    if (advErr) console.error('[cancelSettlement/advances]', advErr.message)
  }

  // Si la semana era "paid", revertirla a "closed"
  let weekReverted = false
  const { data: week } = await supabase
    .from('weeks')
    .select('status')
    .eq('id', s.week_id)
    .single()
  if (week?.status === 'paid') {
    await supabase.from('weeks').update({ status: 'closed' }).eq('id', s.week_id)
    weekReverted = true
  }

  return { weekReverted }
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

/**
 * Cancela un adelanto vía RPC server-side:
 *  - Bloquea si la liquidación de la semana del adelanto está confirmada/pagada
 *    (hay que volver la liquidación a borrador para poder borrarlo).
 *  - Marca el adelanto como cancelled y recalcula las liquidaciones en borrador
 *    del barbero (así el monto descontado se actualiza al instante).
 */
export async function cancelAdvance(advanceId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_advance', { p_advance_id: advanceId })
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

/** Gasto con el nombre del usuario que lo registró (auditoría) */
export interface ExpenseWithUser extends Expense {
  registered_by_name: string | null
}

export async function getExpensesByWeek(weekId: string): Promise<ExpenseWithUser[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('week_id', weekId)
    .order('expense_date', { ascending: false })

  if (error) throw new Error(`[getExpensesByWeek] ${error.message}`)
  const rows = data ?? []
  if (rows.length === 0) return []

  // Resolver nombres de quién registró cada gasto (mismo patrón que getAuditLog)
  const userIds = [...new Set(rows.map((r) => r.registered_by).filter((id): id is string => !!id))]
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
    registered_by_name: userMap[r.registered_by] ?? null,
  }))
}

// ============================================================
// REVENUE BALANCES (Saldo inicial del mes)
// ============================================================
/** Saldo inicial del mes para una sucursal (null si no se cargó aún). */
export async function getInitialBalance(
  branchId: string,
  monthId: string
): Promise<RevenueBalance | null> {
  const { data, error } = await supabase
    .from('revenue_balances')
    .select('*')
    .eq('branch_id', branchId)
    .eq('month_id', monthId)
    .maybeSingle()

  if (error) throw new Error(`[getInitialBalance] ${error.message}`)
  return data
}

/** Crea o actualiza el saldo inicial del mes (upsert por branch_id + month_id). */
export async function setInitialBalance(
  branchId: string,
  monthId: string,
  amount: number,
  notes?: string | null
): Promise<RevenueBalance> {
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('revenue_balances')
    .upsert(
      {
        branch_id: branchId,
        month_id: monthId,
        initial_balance: amount,
        notes: notes ?? null,
        created_by: auth.user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'branch_id,month_id' }
    )
    .select()
    .single()

  if (error) throw new Error(`[setInitialBalance] ${error.message}`)
  return data
}

/** Resumen financiero del mes (Ganancia neta = saldo inicial + ingresos barbería + inyecciones - gastos). */
export interface MonthFinancials {
  branchShareCuts: number    // comisión de la barbería en cortes
  boxRentTotal: number       // alquileres de box cobrados
  branchIncome: number       // branchShareCuts + boxRentTotal
  capitalInjections: number  // inyecciones de capital de socios
  totalExpenses: number      // gastos del mes (excluye retiro de socios)
  initialBalance: number     // saldo inicial del mes
  netProfit: number          // initialBalance + branchIncome + capitalInjections - totalExpenses
}

export async function getMonthFinancials(
  branchId: string,
  monthId: string
): Promise<MonthFinancials> {
  const { data, error } = await supabase.rpc('month_financials', {
    p_branch_id: branchId,
    p_month_id: monthId,
  })
  if (error) throw new Error(`[getMonthFinancials] ${error.message}`)

  type Row = {
    branch_share_cuts: number; box_rent_total: number; branch_income: number
    capital_injections: number; total_expenses: number; initial_balance: number; net_profit: number
  }
  const r = (data as Row[] | null)?.[0]
  return {
    branchShareCuts: Number(r?.branch_share_cuts ?? 0),
    boxRentTotal:    Number(r?.box_rent_total ?? 0),
    branchIncome:    Number(r?.branch_income ?? 0),
    capitalInjections: Number(r?.capital_injections ?? 0),
    totalExpenses:   Number(r?.total_expenses ?? 0),
    initialBalance:  Number(r?.initial_balance ?? 0),
    netProfit:       Number(r?.net_profit ?? 0),
  }
}

// ============================================================
// CAPITAL INJECTIONS
// ============================================================
export interface CapitalInjection {
  id: string
  branch_id: string
  month_id: string
  amount: number
  description?: string
  created_by: string
  created_at: string
  updated_at: string
}

export async function getCapitalInjections(branchId: string, monthId: string): Promise<CapitalInjection[]> {
  const { data, error } = await supabase
    .from('capital_injections')
    .select('*')
    .eq('branch_id', branchId)
    .eq('month_id', monthId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`[getCapitalInjections] ${error.message}`)
  return data ?? []
}

export async function createCapitalInjection(
  branchId: string,
  monthId: string,
  amount: number,
  description?: string
): Promise<CapitalInjection> {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('[createCapitalInjection] Usuario no autenticado')

  const { data, error } = await supabase
    .from('capital_injections')
    .insert([{ branch_id: branchId, month_id: monthId, amount, description, created_by: user.id }])
    .select()
    .single()

  if (error) throw new Error(`[createCapitalInjection] ${error.message}`)
  return data
}

export async function deleteCapitalInjection(injectionId: string): Promise<void> {
  const { error } = await supabase
    .from('capital_injections')
    .delete()
    .eq('id', injectionId)

  if (error) throw new Error(`[deleteCapitalInjection] ${error.message}`)
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
  if (branchIds.length === 0) return []

  // Agregación server-side: el RPC devuelve totales por sucursal (no filas crudas).
  const { data, error } = await supabase.rpc('report_by_period', {
    p_branch_ids: branchIds,
    p_start: startDate,
    p_end: endDate,
  })
  if (error) throw new Error(`[getReportByPeriod] ${error.message}`)

  type ReportRow = {
    branch_id: string
    cut_count: number
    total_income: number
    branch_share: number
    barber_share: number
    total_expenses: number
    partner_withdrawals: number
    expenses_by_category: Record<string, number> | null
    barber_total: number
    barbers: { barber_id: string; full_name: string; total: number }[] | null
  }
  const byId = new Map((data as ReportRow[] ?? []).map((r) => [r.branch_id, r]))

  return branches.map((branch) => {
    const r = byId.get(branch.id)
    const totalIncome   = Number(r?.total_income ?? 0)
    // Total Barberos = comisión por corte + bonos (lo que se lleva el barbero).
    const barberShare   = Number(r?.barber_total ?? 0)
    // Total Barbería = Ingresos − Total Barberos. Los bonos (presentismo/objetivo)
    // los resigna la barbería para dárselos al barbero, así que se descuentan acá.
    const branchShare   = totalIncome - barberShare
    const totalExpenses = Number(r?.total_expenses ?? 0)
    // Ganancia neta = Ingresos − Total Barberos − Gastos (= Total Barbería − Gastos).
    const netProfit     = totalIncome - barberShare - totalExpenses
    const expensesByCategory: Record<string, number> = {}
    for (const [k, v] of Object.entries(r?.expenses_by_category ?? {})) {
      expensesByCategory[k] = Number(v)
    }
    const barbers = (r?.barbers ?? []).map((b) => ({
      barberId: b.barber_id, fullName: b.full_name, total: Number(b.total),
    }))
    return {
      branchId: branch.id,
      branchName: branch.name,
      cutCount: Number(r?.cut_count ?? 0),
      totalIncome,
      branchShare,
      barberShare,
      barbers,
      totalExpenses,
      expensesByCategory,
      partnerWithdrawals: Number(r?.partner_withdrawals ?? 0),
      netProfit,
      profitMargin: totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0,
    }
  })
}

// ============================================================
// PROFILES (Admin)
// ============================================================
// Incluye barberos puros (role='barber') y admins-que-atienden (is_barber=true)
// de la sucursal. La capacidad de barbero se define por branch_id + (role o flag).
const BARBER_OR_DUAL = 'role.eq.barber,is_barber.eq.true'

export async function getBarbersByBranch(branchId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('branch_id', branchId)
    .or(BARBER_OR_DUAL)
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
    .or(BARBER_OR_DUAL)
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

// ============================================================
// EXPENSES CRUD
// ============================================================
export async function updateExpense(
  expenseId: string,
  patch: ExpenseUpdate
): Promise<void> {
  const { error } = await supabase.rpc('update_expense', {
    p_expense_id: expenseId,
    p_concept: patch.concept ?? null,
    p_category: patch.category ?? null,
    p_amount: patch.amount ?? null,
    p_expense_date: patch.expense_date ?? null,
    p_notes: patch.notes ?? null,
  })
  if (error) throw new Error(`[updateExpense] ${error.message}`)
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_expense', {
    p_expense_id: expenseId,
  })
  if (error) throw new Error(`[deleteExpense] ${error.message}`)
}

export async function getExpensesByBranch(
  branchId: string,
  weekId?: string
): Promise<Expense[]> {
  let query = supabase
    .from('expenses')
    .select('*')
    .eq('branch_id', branchId)

  if (weekId) {
    query = query.eq('week_id', weekId)
  }

  const { data, error } = await query.order('expense_date', { ascending: false })

  if (error) throw new Error(`[getExpensesByBranch] ${error.message}`)
  return data || []
}

// ============================================================
// MANTENIMIENTO / ORDEN SEMANAL
// ============================================================

/** Config de aprobación de la sucursal (default 100% si no hay fila). */
export async function getMaintenanceSettings(branchId: string): Promise<MaintenanceSettings> {
  const { data, error } = await supabase
    .from('maintenance_settings')
    .select('*')
    .eq('branch_id', branchId)
    .maybeSingle()
  if (error) throw new Error(`[getMaintenanceSettings] ${error.message}`)
  return data ?? { branch_id: branchId, min_approval_pct: 100, updated_at: '' }
}

export async function upsertMaintenanceSettings(branchId: string, pct: number): Promise<void> {
  const { error } = await supabase
    .from('maintenance_settings')
    .upsert({ branch_id: branchId, min_approval_pct: pct, updated_at: new Date().toISOString() }, { onConflict: 'branch_id' })
  if (error) throw new Error(`[upsertMaintenanceSettings] ${error.message}`)
}

/** Plantilla editable: bloques (barbero + zona) con sus tareas, ordenados. */
export async function getMaintenanceTemplate(branchId: string): Promise<MaintenanceTemplateBlockWithTasks[]> {
  const { data, error } = await supabase
    .from('maintenance_template_blocks')
    .select('*, barber:profiles!barber_id ( id, full_name ), tasks:maintenance_template_tasks ( * )')
    .eq('branch_id', branchId)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(`[getMaintenanceTemplate] ${error.message}`)
  const blocks = (data ?? []) as unknown as MaintenanceTemplateBlockWithTasks[]
  // Ordenar las tareas de cada bloque por sort_order (el orden embebido no está garantizado)
  blocks.forEach((b) => b.tasks.sort((a, z) => a.sort_order - z.sort_order))
  return blocks
}

/**
 * Guarda la plantilla completa (reemplazo): borra los bloques del branch (cascade a
 * tareas) y reinserta. Los ids no importan porque las planillas guardan snapshot.
 */
export async function saveMaintenanceTemplate(
  branchId: string,
  blocks: MaintenanceTemplateDraftBlock[],
): Promise<void> {
  const { error: delErr } = await supabase
    .from('maintenance_template_blocks')
    .delete()
    .eq('branch_id', branchId)
  if (delErr) throw new Error(`[saveMaintenanceTemplate:delete] ${delErr.message}`)

  if (blocks.length === 0) return

  const blockRows = blocks.map((b, i) => ({
    branch_id: branchId,
    barber_id: b.barber_id,
    zone_label: b.zone_label,
    sort_order: i,
  }))
  const { data: inserted, error: insErr } = await supabase
    .from('maintenance_template_blocks')
    .insert(blockRows)
    .select('id, barber_id')
  if (insErr) throw new Error(`[saveMaintenanceTemplate:blocks] ${insErr.message}`)

  const idByBarber = new Map((inserted ?? []).map((r) => [r.barber_id as string, r.id as string]))
  const taskRows: Array<{ branch_id: string; block_id: string; item_number: number; description: string; sort_order: number }> = []
  blocks.forEach((b) => {
    const blockId = idByBarber.get(b.barber_id)
    if (!blockId) return
    b.tasks.forEach((t, j) => {
      if (!t.description.trim()) return
      taskRows.push({
        branch_id: branchId,
        block_id: blockId,
        item_number: t.item_number,
        description: t.description.trim(),
        sort_order: j,
      })
    })
  })
  if (taskRows.length > 0) {
    const { error: tErr } = await supabase.from('maintenance_template_tasks').insert(taskRows)
    if (tErr) throw new Error(`[saveMaintenanceTemplate:tasks] ${tErr.message}`)
  }
}

/** Planilla de una semana (con sus ítems), o null si todavía no se creó. */
export async function getMaintenanceSheetByWeek(
  branchId: string,
  weekId: string,
): Promise<MaintenanceSheetWithItems | null> {
  const { data: sheet, error } = await supabase
    .from('maintenance_sheets')
    .select('*')
    .eq('branch_id', branchId)
    .eq('week_id', weekId)
    .maybeSingle()
  if (error) throw new Error(`[getMaintenanceSheetByWeek] ${error.message}`)
  if (!sheet) return null

  const { data: items, error: iErr } = await supabase
    .from('maintenance_sheet_items')
    .select('*')
    .eq('sheet_id', sheet.id)
    .order('sort_order', { ascending: true })
  if (iErr) throw new Error(`[getMaintenanceSheetByWeek:items] ${iErr.message}`)

  return { ...sheet, items: (items ?? []) as MaintenanceSheetItem[] }
}

/** Crea la planilla de la semana copiando la plantilla actual (snapshot de ítems). */
export async function createMaintenanceSheetFromTemplate(
  branchId: string,
  weekId: string,
  minPct: number,
  createdBy: string,
): Promise<MaintenanceSheetWithItems> {
  const template = await getMaintenanceTemplate(branchId)
  const hasTasks = template.some((b) => b.tasks.length > 0)
  if (!hasTasks) {
    throw new Error('La plantilla está vacía. Configurá las tareas por barbero antes de crear la planilla.')
  }

  const { data: sheet, error } = await supabase
    .from('maintenance_sheets')
    .insert({ branch_id: branchId, week_id: weekId, min_approval_pct: minPct, created_by: createdBy })
    .select()
    .single()
  if (error) throw new Error(`[createMaintenanceSheetFromTemplate] ${error.message}`)

  // sort_order es un índice GLOBAL creciente: mantiene a los barberos agrupados y en
  // el orden de la plantilla al ordenar los ítems solo por sort_order.
  const itemRows: Array<Omit<MaintenanceSheetItem, 'id' | 'created_at'>> = []
  let order = 0
  template.forEach((b) => {
    b.tasks.forEach((t) => {
      itemRows.push({
        branch_id: branchId,
        sheet_id: sheet.id,
        barber_id: b.barber_id,
        zone_label: b.zone_label,
        item_number: t.item_number,
        description: t.description,
        done: false,
        sort_order: order++,
      })
    })
  })

  let items: MaintenanceSheetItem[] = []
  if (itemRows.length > 0) {
    const { data: ins, error: iErr } = await supabase
      .from('maintenance_sheet_items')
      .insert(itemRows)
      .select()
    if (iErr) throw new Error(`[createMaintenanceSheetFromTemplate:items] ${iErr.message}`)
    items = (ins ?? []) as MaintenanceSheetItem[]
    items.sort((a, z) => a.sort_order - z.sort_order)
  }

  return { ...sheet, items }
}

/** Marca/desmarca el cumplimiento de una tarea de la planilla. */
export async function setMaintenanceItemDone(itemId: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('maintenance_sheet_items')
    .update({ done })
    .eq('id', itemId)
  if (error) throw new Error(`[setMaintenanceItemDone] ${error.message}`)
}

/** Cambia el % mínimo de aprobación de una planilla ya creada. */
export async function setMaintenanceSheetMinPct(sheetId: string, pct: number): Promise<void> {
  const { error } = await supabase
    .from('maintenance_sheets')
    .update({ min_approval_pct: pct, updated_at: new Date().toISOString() })
    .eq('id', sheetId)
  if (error) throw new Error(`[setMaintenanceSheetMinPct] ${error.message}`)
}

/**
 * Regenera los ítems de una planilla existente desde la plantilla ACTUAL del branch.
 * Borra el snapshot anterior (incluye los SÍ/NO marcados) y vuelve a copiar las
 * tareas vigentes. Conserva la planilla (id, semana, % de aprobación).
 */
export async function regenerateMaintenanceSheet(
  sheetId: string,
  branchId: string,
): Promise<MaintenanceSheetWithItems> {
  const template = await getMaintenanceTemplate(branchId)
  const hasTasks = template.some((b) => b.tasks.length > 0)
  if (!hasTasks) {
    throw new Error('La plantilla está vacía. Configurá las tareas por barbero antes de regenerar.')
  }

  const { error: delErr } = await supabase
    .from('maintenance_sheet_items')
    .delete()
    .eq('sheet_id', sheetId)
  if (delErr) throw new Error(`[regenerateMaintenanceSheet:delete] ${delErr.message}`)

  const itemRows: Array<Omit<MaintenanceSheetItem, 'id' | 'created_at'>> = []
  let order = 0
  template.forEach((b) => {
    b.tasks.forEach((t) => {
      itemRows.push({
        branch_id: branchId,
        sheet_id: sheetId,
        barber_id: b.barber_id,
        zone_label: b.zone_label,
        item_number: t.item_number,
        description: t.description,
        done: false,
        sort_order: order++,
      })
    })
  })

  const { data: ins, error: iErr } = await supabase
    .from('maintenance_sheet_items')
    .insert(itemRows)
    .select()
  if (iErr) throw new Error(`[regenerateMaintenanceSheet:items] ${iErr.message}`)

  await supabase
    .from('maintenance_sheets')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sheetId)

  const { data: sheet, error: sErr } = await supabase
    .from('maintenance_sheets')
    .select('*')
    .eq('id', sheetId)
    .single()
  if (sErr) throw new Error(`[regenerateMaintenanceSheet:sheet] ${sErr.message}`)

  const items = ((ins ?? []) as MaintenanceSheetItem[]).sort((a, z) => a.sort_order - z.sort_order)
  return { ...sheet, items }
}

/** week_ids de la sucursal que ya tienen planilla (para marcar en el selector). */
export async function getMaintenanceWeeksWithSheet(branchId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('maintenance_sheets')
    .select('week_id')
    .eq('branch_id', branchId)
  if (error) throw new Error(`[getMaintenanceWeeksWithSheet] ${error.message}`)
  return (data ?? []).map((r) => r.week_id as string)
}
