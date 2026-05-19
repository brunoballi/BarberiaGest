// ============================================================
// VALHALLA BARBERSHOP — Database Types
// Auto-generado desde schema vivo de Supabase
// Proyecto: kzctstbdudxoknjobamo
// ============================================================

// ============================================================
// ENUMS
// ============================================================
export type UserRole = 'admin' | 'barber'
export type CompensationType = 'percentage' | 'salary' | 'box_rental'
export type PaymentMethod = 'cash' | 'transfer' | 'card'
export type WeekStatus = 'open' | 'closed' | 'paid'
export type MonthStatus = 'active' | 'closed'
export type SettlementStatus = 'draft' | 'confirmed' | 'paid'
export type AdvanceStatus = 'pending' | 'approved' | 'deducted' | 'cancelled'

// ============================================================
// ROW TYPES — Tipado exacto de lo que devuelve Supabase
// ============================================================
export interface Branch {
  id: string
  name: string
  address: string | null
  is_active: boolean
  created_at: string
}

export interface Profile {
  id: string
  branch_id: string
  full_name: string
  role: UserRole
  compensation_type: CompensationType
  // Modelo 'percentage'
  commission_rate: number | null
  // Modelo 'salary'
  base_salary_rate: number | null
  presentismo_rate: number | null
  objetivo_rate: number | null
  objetivo_min_cuts: number | null
  // Modelo 'box_rental'
  box_rental_amount: number | null
  is_active: boolean
  created_at: string
}

export interface ServiceCatalog {
  id: string
  branch_id: string
  name: string
  base_price: number
  is_active: boolean
  created_at: string
}

export interface Month {
  id: string
  branch_id: string
  year: number
  month: number
  status: MonthStatus
  created_at: string
}

export interface MonthWithWeeks extends Month {
  weeks: Week[]
}

export type MonthInsert = Omit<Month, 'id' | 'created_at'>

export interface Week {
  id: string
  branch_id: string
  month_id: string | null
  week_number: number
  start_date: string
  end_date: string
  status: WeekStatus
  closed_at: string | null
  closed_by: string | null
  created_at: string
}

export interface Transaction {
  id: string
  branch_id: string
  barber_id: string
  service_id: string | null
  week_id: string
  transaction_date: string
  amount: number
  payment_method: PaymentMethod
  branch_share: number
  barber_share: number
  commission_rate_snapshot: number
  barber_already_collected: number
  is_manual_override: boolean
  override_notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface Advance {
  id: string
  barber_id: string
  branch_id: string
  week_id: string | null
  amount: number
  advance_date: string
  reason: string | null
  status: AdvanceStatus
  deducted_in: string | null
  registered_by: string
  created_at: string
}

export interface Settlement {
  id: string
  week_id: string
  barber_id: string
  branch_id: string
  total_cuts: number
  gross_amount: number
  barber_gross: number
  bonus_presentismo: number
  bonus_objetivo: number
  total_earned: number
  already_collected: number
  advances_deducted: number
  total_deductions: number
  net_payable: number
  cash_amount: number
  transfer_amount: number
  card_amount: number
  // Snapshots para auditoría (solo modelo salary)
  base_salary_rate_snap: number | null
  presentismo_rate_snap: number | null
  objetivo_rate_snap: number | null
  objetivo_min_cuts_snap: number | null
  objetivo_met: boolean | null
  presentismo_met: boolean | null
  status: SettlementStatus
  confirmed_at: string | null
  paid_at: string | null
  created_at: string
  updated_at: string
}

export interface Expense {
  id: string
  branch_id: string
  week_id: string | null
  concept: string
  expense_date: string
  amount: number
  category: string | null
  paid_by: string | null
  notes: string | null
  registered_by: string
  created_at: string
}

// ============================================================
// INSERT TYPES — Para mutations (omite campos auto-generados)
// ============================================================
export type BranchInsert = Omit<Branch, 'id' | 'created_at'>

export type ProfileInsert = Omit<Profile, 'created_at'>

export type ServiceCatalogInsert = Omit<ServiceCatalog, 'id' | 'created_at'>

export type WeekInsert = Omit<Week, 'id' | 'created_at' | 'closed_at' | 'closed_by' | 'month_id'> & {
  month_id?: string | null
}

export type TransactionInsert = Omit<
  Transaction,
  'id' | 'created_at' | 'updated_at' | 'is_manual_override' | 'override_notes'
> & {
  is_manual_override?: boolean
  override_notes?: string
}

export type AdvanceInsert = Omit<Advance, 'id' | 'created_at' | 'status' | 'deducted_in'>

export type ExpenseInsert = Omit<Expense, 'id' | 'created_at'>

// ============================================================
// UPDATE TYPES — Solo campos modificables
// ============================================================
export type TransactionUpdate = Partial<
  Pick<
    Transaction,
    | 'amount'
    | 'payment_method'
    | 'branch_share'
    | 'barber_share'
    | 'barber_already_collected'
    | 'is_manual_override'
    | 'override_notes'
    | 'service_id'
  >
>

export type SettlementUpdate = Partial<
  Pick<
    Settlement,
    | 'presentismo_met'
    | 'bonus_presentismo'
    | 'net_payable'
    | 'total_deductions'
    | 'status'
    | 'confirmed_at'
    | 'paid_at'
  >
>

export type WeekUpdate = Partial<Pick<Week, 'status' | 'closed_at' | 'closed_by'>>

export type AdvanceUpdate = Partial<Pick<Advance, 'status' | 'deducted_in' | 'reason'>>

export type ProfileUpdate = Partial<
  Pick<
    Profile,
    | 'full_name'
    | 'compensation_type'
    | 'commission_rate'
    | 'base_salary_rate'
    | 'presentismo_rate'
    | 'objetivo_rate'
    | 'objetivo_min_cuts'
    | 'box_rental_amount'
    | 'is_active'
  >
>

// ============================================================
// JOIN TYPES — Para queries con relaciones
// ============================================================

/** Transaction con datos del barbero y servicio (para admin dashboard) */
export interface TransactionWithRelations extends Transaction {
  barber: Pick<Profile, 'id' | 'full_name' | 'compensation_type'>
  service: Pick<ServiceCatalog, 'id' | 'name'> | null
}

/** Settlement con datos del barbero (para panel de liquidación) */
export interface SettlementWithBarber extends Settlement {
  barber: Pick<Profile, 'id' | 'full_name' | 'compensation_type'>
  week: Pick<Week, 'id' | 'week_number' | 'start_date' | 'end_date' | 'status'>
}

/** Week con resumen de producción (para dashboard admin) */
export interface WeekWithSummary extends Week {
  settlements: Settlement[]
  total_branch_income: number
  total_payable: number
}

/** Advance con datos del barbero (para módulo adelantos) */
export interface AdvanceWithBarber extends Advance {
  barber: Pick<Profile, 'id' | 'full_name'>
}

// ============================================================
// UTILITY TYPES — Para formularios y lógica de UI
// ============================================================

/** Reporte agregado por sucursal para un período */
export interface BranchReport {
  branchId: string
  branchName: string
  cutCount: number
  totalIncome: number        // suma de transactions.amount
  branchShare: number        // suma de transactions.branch_share (lo que queda al negocio de cortes)
  barberShare: number        // suma de transactions.barber_share (comisiones)
  totalExpenses: number      // suma de expenses.amount
  expensesByCategory: Record<string, number>
  netProfit: number          // branchShare - totalExpenses
  profitMargin: number       // netProfit / totalIncome * 100
}

/** Payload que envía el barbero al registrar un corte */
export interface RegisterCutPayload {
  service_id: string | null
  amount: number
  payment_method: PaymentMethod
  transaction_date: string
  // Opcional: override manual de barber_already_collected.
  // Si se omite, se calcula automáticamente (0 para cash, barber_share para transfer/card).
  barber_already_collected_override?: number
}

/** Resultado del cálculo de un settlement para mostrar en UI */
export interface SettlementSummary {
  barber: Pick<Profile, 'id' | 'full_name' | 'compensation_type'>
  week: Pick<Week, 'week_number' | 'start_date' | 'end_date'>
  total_cuts: number
  gross_amount: number
  total_earned: number
  total_deductions: number
  net_payable: number
  is_positive: boolean // net_payable >= 0
  breakdown: {
    barber_gross: number
    bonus_presentismo: number
    bonus_objetivo: number
    already_collected: number
    advances_deducted: number
  }
  by_payment_method: {
    cash: number
    transfer: number
    card: number
  }
}

/** Constantes de categorías de gastos */
export const EXPENSE_CATEGORIES = [
  'alquiler',
  'servicios',
  'personal',
  'insumos',
  'marketing',
  'impuestos',
  'retiro_socio',
  'otros',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/** Labels en español para métodos de pago */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
}

/** Labels en español para estados de semana */
export const WEEK_STATUS_LABELS: Record<WeekStatus, string> = {
  open: 'Abierta',
  closed: 'Cerrada',
  paid: 'Pagada',
}

/** Labels en español para estados de liquidación */
export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  paid: 'Pagada',
}

/** Labels en español para estados de adelanto */
export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = {
  pending:   'Solicitado',
  approved:  'Autorizado',
  deducted:  'Descontado',
  cancelled: 'Cancelado',
}
