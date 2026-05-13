// ============================================================
// VALHALLA BARBERSHOP — Supabase Client + Query Helpers
// Usa createBrowserClient de @supabase/ssr para que las cookies
// de sesión sean accesibles desde el servidor (proxy.ts).
// ============================================================

import { createBrowserClient } from '@supabase/ssr'
import type {
  Branch,
  Profile,
  Transaction,
  TransactionInsert,
  TransactionWithRelations,
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

// ============================================================
// SERVICE CATALOG
// ============================================================
export async function getServicesByBranch(branchId: string): Promise<ServiceCatalog[]> {
  const { data, error } = await supabase
    .from('service_catalog')
    .select('*')
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
  const { data, error } = await supabase
    .from('weeks')
    .select('*')
    .eq('branch_id', branchId)
    .eq('status', 'open')
    .order('week_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`[getOpenWeek] ${error.message}`)
  return data
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
  const { error } = await supabase
    .from('weeks')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: closedBy,
    } satisfies WeekUpdate)
    .eq('id', weekId)
    .eq('status', 'open')

  if (error) throw new Error(`[closeWeek] ${error.message}`)
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
// TRANSACTIONS
// ============================================================

/**
 * Registra un corte. Calcula automáticamente el split y barber_already_collected.
 * Lógica Escenario B: si el pago es transfer/card, el barbero ya tiene ese dinero.
 */
export async function registerCut(
  payload: RegisterCutPayload,
  barber: Profile,
  weekId: string
): Promise<Transaction> {
  const commissionRate = barber.commission_rate ?? 0.5
  const barberShare = Number((payload.amount * commissionRate).toFixed(2))
  const branchShare = Number((payload.amount - barberShare).toFixed(2))

  const barberAlreadyCollected: number =
    payload.payment_method === 'cash' ? 0 : barberShare

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
    created_by: barber.id,
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert(insert)
    .select()
    .single()

  if (error) throw new Error(`[registerCut] ${error.message}`)
  return data
}

export async function getBarberTransactionsForWeek(
  barberId: string,
  weekId: string
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
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
      *,
      barber:profiles!barber_id ( id, full_name, compensation_type ),
      service:service_catalog!service_id ( id, name )
    `)
    .eq('week_id', weekId)
    .order('transaction_date', { ascending: false })

  if (error) throw new Error(`[getWeekTransactions] ${error.message}`)
  return data as TransactionWithRelations[]
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
  const { error } = await supabase
    .from('settlements')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    } satisfies SettlementUpdate)
    .eq('id', settlementId)

  if (error) throw new Error(`[markSettlementPaid] ${error.message}`)
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
    .eq('status', 'pending')
    .order('advance_date', { ascending: false })

  if (error) throw new Error(`[getPendingAdvancesByBranch] ${error.message}`)
  return data as AdvanceWithBarber[]
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
