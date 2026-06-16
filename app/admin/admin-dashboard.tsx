'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  type Branch,
  type Week,
  type MonthWithWeeks,
  type SettlementWithBarber,
  type TransactionWithRelations,
  type AdvanceWithBarber,
  type Advance,
  type ExpenseInsert,
  type ExpenseUpdate,
  type ExpenseCategory,
  type RevenueBalance,
  type ServiceCatalog,
  type PaymentMethod,
  PAYMENT_METHOD_LABELS,
  WEEK_STATUS_LABELS,
  SETTLEMENT_STATUS_LABELS,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
} from '@/lib/supabase/database.types'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import {
  getMonthsWithWeeks,
  yearHasMonths,
  MONTH_NAMES,
  getBarbersByBranch,
  getSettlementsForWeek,
  getWeekTransactions,
  getAdvancesByDateRange,
  getExpensesByWeek,
  type ExpenseWithUser,
  closeWeek,
  calculateAllSettlementsForWeek,
  setPresentismo,
  recalculateSettlementFull,
  setObjetivo,
  setBoxRent,
  setBonusPresentismoOverride,
  setBonusObjetivoOverride,
  deleteTransaction,
  confirmSettlement,
  markSettlementPaid,
  deleteSettlement,
  cancelSettlement,
  createExpense,
  updateExpense,
  deleteExpense,
  getInitialBalance,
  setInitialBalance,
  getMonthFinancials,
  type MonthFinancials,
  overrideTransactionSplit,
  fullEditTransaction,
  getServicesByBranch,
  getWeeksByBranch,
  getCurrentProfile,
  getAdvancesPendingForBarber,
  todayLocal,
  supabase,
} from '@/lib/supabase/supabase.client'
import './admin-dashboard.css'
import ManualCutModal from './manual-cut-modal'
import { DebtPaymentModal } from '@/app/components/debt-payment-modal'
import AdvancesTab from './advances-tab'
import { PaginationControls } from '@/app/components/pagination-controls'
import { CurrencyInput } from '@/app/components/currency-input'
import { CurrencyInputInline } from '@/app/components/currency-input-inline'
import { TextInput } from '@/app/components/text-input'
import { AdminSideDrawer } from '@/app/components/admin-side-drawer'

// ─── Utilidades ────────────────────────────────────────────────────────────
function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

// ─── Tipos de tab ──────────────────────────────────────────────────────────
type Tab = 'live' | 'liquidaciones' | 'transacciones' | 'gastos' | 'saldo' | 'adelantos'
const TAB_LABELS: Record<Tab, string> = {
  live: '🔴 En vivo',
  liquidaciones: 'Liquidaciones',
  transacciones: 'Transacciones',
  gastos: 'Gastos',
  saldo: '💵 Saldo inicial',
  adelantos: '💰 Adelantos',
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter()
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [months, setMonths] = useState<MonthWithWeeks[]>([])
  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(0)
  const [selectedWeek, setSelectedWeek] = useState<Week | null>(null)
  const [tab, setTab] = useState<Tab>('liquidaciones')
  // Paginación grillas dashboard (default 20)
  const [txPage, setTxPage] = useState(1)
  const [txPageSize, setTxPageSize] = useState(20)
  const [gastosPage, setGastosPage] = useState(1)
  const [gastosPageSize, setGastosPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [adminName, setAdminName]         = useState<string>('')
  const [showManualCut, setShowManualCut] = useState(false)
  const [debtModal, setDebtModal] = useState<{ settlementId: string; barberId: string; branchId: string; barberName: string; outstanding: number } | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Semanas del mes seleccionado (derivado)
  const weeks: Week[] = months[selectedMonthIdx]?.weeks ?? []
  // Saldo inicial del mes seleccionado (capital con el que arranca el mes)
  const selectedMonthId: string | undefined = months[selectedMonthIdx]?.id
  const [initialBalance, setInitialBalanceState] = useState<RevenueBalance | null>(null)
  const [editingBalance, setEditingBalance] = useState(false)
  const [balanceInput, setBalanceInput] = useState('')
  const [savingBalance, setSavingBalance] = useState(false)
  // Resumen financiero del mes (Ganancia neta)
  const [monthFin, setMonthFin] = useState<MonthFinancials | null>(null)

  const [settlements, setSettlements] = useState<SettlementWithBarber[]>([])
  const [transactions, setTransactions] = useState<TransactionWithRelations[]>([])
  const [weekAdvances, setWeekAdvances] = useState<AdvanceWithBarber[]>([])
  const [expenses, setExpenses] = useState<ExpenseWithUser[]>([])

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [editExpense, setEditExpense] = useState<ExpenseWithUser | null>(null)
  const [confirmDeleteExpId, setConfirmDeleteExpId] = useState<string | null>(null)
  const [overrideTx, setOverrideTx] = useState<TransactionWithRelations | null>(null)
  const [editTx, setEditTx] = useState<TransactionWithRelations | null>(null)
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<string | null>(null)

  // Live view
  const [liveTransactions, setLiveTransactions] = useState<TransactionWithRelations[]>([])

  // Detalle de adelantos en liquidación
  const [advancesDetail, setAdvancesDetail] = useState<{
    barberName: string
    advances: Advance[]
    loading: boolean
  } | null>(null)

  async function openAdvancesDetail(barberId: string, branchIdParam: string, barberName: string) {
    setAdvancesDetail({ barberName, advances: [], loading: true })
    try {
      const list = await getAdvancesPendingForBarber(barberId, branchIdParam)
      setAdvancesDetail({ barberName, advances: list, loading: false })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando adelantos')
      setAdvancesDetail(null)
    }
  }

  // Banner: año próximo no cargado (cuando estamos en Nov/Dic)
  const [showYearBanner, setShowYearBanner] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  useEffect(() => {
    if (!selectedBranch || bannerDismissed) return
    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const nextYear = now.getFullYear() + 1
    // Solo mostrar en noviembre o diciembre
    if (currentMonth < 11) { setShowYearBanner(false); return }
    yearHasMonths(selectedBranch, nextYear)
      .then((hasIt) => setShowYearBanner(!hasIt))
      .catch(() => {})
  }, [selectedBranch, bannerDismissed])

  // Dropdown configuración
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const configBtnRef = useRef<HTMLButtonElement>(null)
  const configMenuRef = useRef<HTMLDivElement>(null)

  function openConfigMenu() {
    if (configBtnRef.current) {
      const rect = configBtnRef.current.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      })
    }
    setShowConfigMenu((v) => !v)
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (
        configMenuRef.current && !configMenuRef.current.contains(target) &&
        configBtnRef.current  && !configBtnRef.current.contains(target)
      ) {
        setShowConfigMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Filtros tab transacciones
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterBarber, setFilterBarber] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [filterService, setFilterService] = useState('')

  // Filtros tab liquidaciones
  const [settlFilterBarber, setSettlFilterBarber] = useState('')
  const [settlFilterObjetivo, setSettlFilterObjetivo] = useState('')
  const [settlFilterPresentismo, setSettlFilterPresentismo] = useState('')
  const [settlFilterAdelantos, setSettlFilterAdelantos] = useState('')
  const [settlFilterAPagar, setSettlFilterAPagar] = useState('')
  const [settlFilterEstado, setSettlFilterEstado] = useState('')
  const [confirmDeleteSettlId, setConfirmDeleteSettlId] = useState<string | null>(null)
  const [confirmCancelSettlId, setConfirmCancelSettlId] = useState<string | null>(null)
  // Paginación tab liquidaciones
  const [settlPage, setSettlPage] = useState(1)
  const [settlPageSize, setSettlPageSize] = useState(20)

  // Filtros tab gastos
  const [expFilterDateFrom, setExpFilterDateFrom] = useState('')
  const [expFilterDateTo, setExpFilterDateTo] = useState('')
  const [expFilterCategory, setExpFilterCategory] = useState('')

  // ─── Carga inicial ─────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const [profile, branchList] = await Promise.all([
          getCurrentProfile(),
          getMyBranchesCached(),
        ])
        if (!profile || profile.role !== 'admin') {
          setError('Acceso denegado. Se requiere rol Admin.')
          return
        }
        if (branchList.length === 0) {
          setError('No tenés sucursales asignadas. Contactá al administrador.')
          return
        }
        setCurrentUserId(profile.id)
        setAdminName(profile.full_name ?? '')
        setBranches(branchList)

        // Validar sucursal almacenada contra las sucursales asignadas
        const stored = getStoredBranch()
        const valid = stored && branchList.some((b) => b.id === stored)
        if (!valid) {
          // Forzar al admin a elegir sucursal
          router.replace('/admin/select-branch')
          return
        }
        setSelectedBranch(stored)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error de inicialización')
      } finally {
        setLoading(false)
      }
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Carga de meses/semanas al cambiar sucursal ────────────────────
  useEffect(() => {
    if (!selectedBranch) return
    async function loadMonths() {
      try {
        // Reset inmediato para no mostrar datos de la sucursal anterior
        setSelectedMonthIdx(0)
        setSelectedWeek(null)
        setMonths([])
        const ms = await getMonthsWithWeeks(selectedBranch)
        setMonths(ms)
        // Prioridad: 1) mes actual (hoy), 2) mes con semana abierta, 3) último mes
        const today = new Date()
        const curMonth = today.getMonth() + 1 // 1-12
        const curYear = today.getFullYear()
        const currentIdx = ms.findIndex((m) => m.month === curMonth && m.year === curYear)
        const openIdx = ms.findIndex((m) => m.weeks.some((w) => w.status === 'open'))
        const idx =
          currentIdx >= 0 ? currentIdx : openIdx >= 0 ? openIdx : Math.max(0, ms.length - 1)
        setSelectedMonthIdx(idx)
        const ws = ms[idx]?.weeks ?? []
        setSelectedWeek(ws.find((w) => w.status === 'open') ?? ws[ws.length - 1] ?? null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error cargando meses')
      }
    }
    loadMonths()
  }, [selectedBranch])

  // ─── Carga de datos al cambiar semana/tab ─────────────────────────
  const loadTabData = useCallback(async () => {
    if (!selectedWeek) return
    try {
      if (tab === 'live') {
        const data = await getWeekTransactions(selectedWeek.id)
        setLiveTransactions(data)
      } else if (tab === 'liquidaciones') {
        const [settlData, expData] = await Promise.all([
          getSettlementsForWeek(selectedWeek.id),
          getExpensesByWeek(selectedWeek.id),
        ])
        setSettlements(settlData)
        setExpenses(expData)
      } else if (tab === 'transacciones') {
        const [txData, advData] = await Promise.all([
          getWeekTransactions(selectedWeek.id),
          getAdvancesByDateRange(selectedBranch, selectedWeek.start_date, selectedWeek.end_date),
        ])
        setTransactions(txData)
        setWeekAdvances(advData)
      } else if (tab === 'gastos') {
        const data = await getExpensesByWeek(selectedWeek.id)
        setExpenses(data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando datos')
    }
  }, [selectedWeek, tab, selectedBranch])

  useEffect(() => { loadTabData() }, [loadTabData])

  // ─── Al cambiar de semana: pre-cargar el filtro de fechas de Transacciones
  // con el rango de la semana, para que el usuario vea que la grilla ya está
  // filtrada por la semana seleccionada (evita confusión con el filtro vacío). ─
  useEffect(() => {
    if (selectedWeek) {
      setFilterDateFrom(selectedWeek.start_date)
      setFilterDateTo(selectedWeek.end_date)
    } else {
      setFilterDateFrom('')
      setFilterDateTo('')
    }
    setTxPage(1)
  }, [selectedWeek?.id, selectedWeek?.start_date, selectedWeek?.end_date])

  // ─── Saldo inicial del mes (se recarga al cambiar sucursal/mes) ─────
  useEffect(() => {
    if (!selectedBranch || !selectedMonthId) { setInitialBalanceState(null); return }
    let cancel = false
    getInitialBalance(selectedBranch, selectedMonthId)
      .then((rb) => { if (!cancel) setInitialBalanceState(rb) })
      .catch(() => { if (!cancel) setInitialBalanceState(null) })
    return () => { cancel = true }
  }, [selectedBranch, selectedMonthId])

  // ─── Resumen financiero del mes (Ganancia neta). Se recalcula al cambiar
  // sucursal/mes, saldo inicial, gastos o liquidaciones (box_rent). ─────
  useEffect(() => {
    if (!selectedBranch || !selectedMonthId) { setMonthFin(null); return }
    let cancel = false
    getMonthFinancials(selectedBranch, selectedMonthId)
      .then((f) => { if (!cancel) setMonthFin(f) })
      .catch(() => { if (!cancel) setMonthFin(null) })
    return () => { cancel = true }
  }, [selectedBranch, selectedMonthId, initialBalance, expenses, settlements])

  // ─── Realtime: suscripción live cuando la semana está abierta ─────
  useEffect(() => {
    if (tab !== 'live' || !selectedWeek || selectedWeek.status !== 'open') return
    const channel = supabase
      .channel(`live-week-${selectedWeek.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `week_id=eq.${selectedWeek.id}` },
        async () => {
          const data = await getWeekTransactions(selectedWeek.id)
          setLiveTransactions(data)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tab, selectedWeek])

  // ─── Realtime: auto-refresh en pestaña transacciones ──────────────
  useEffect(() => {
    if (tab !== 'transacciones' || !selectedWeek || selectedWeek.status !== 'open') return
    const channel = supabase
      .channel(`tx-tab-week-${selectedWeek.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `week_id=eq.${selectedWeek.id}` },
        async () => {
          const [txData, advData] = await Promise.all([
            getWeekTransactions(selectedWeek.id),
            getAdvancesByDateRange(selectedBranch, selectedWeek.start_date, selectedWeek.end_date),
          ])
          setTransactions(txData)
          setWeekAdvances(advData)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tab, selectedWeek, selectedBranch])

  // ─── Realtime: pestaña liquidaciones (settlements + expenses de la semana) ──
  // Sin guard de 'open': las liquidaciones se confirman/pagan en semanas cerradas.
  useEffect(() => {
    if (tab !== 'liquidaciones' || !selectedWeek) return
    const reload = async () => {
      const [settlData, expData] = await Promise.all([
        getSettlementsForWeek(selectedWeek.id),
        getExpensesByWeek(selectedWeek.id),
      ])
      setSettlements(settlData)
      setExpenses(expData)
    }
    const channel = supabase
      .channel(`liq-week-${selectedWeek.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `week_id=eq.${selectedWeek.id}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `week_id=eq.${selectedWeek.id}` }, reload)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tab, selectedWeek])

  // ─── Realtime: pestaña gastos (expenses de la semana) ──────────────
  useEffect(() => {
    if (tab !== 'gastos' || !selectedWeek) return
    const channel = supabase
      .channel(`exp-week-${selectedWeek.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `week_id=eq.${selectedWeek.id}` }, async () => {
        const data = await getExpensesByWeek(selectedWeek.id)
        setExpenses(data)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tab, selectedWeek])

  // ─── Acciones ──────────────────────────────────────────────────────

  async function handleCloseWeek() {
    if (!selectedWeek || !currentUserId) return
    const weekIdx = weeks.findIndex((w) => w.id === selectedWeek.id)
    const weekDisplayNum = weekIdx + 1
    if (!confirm(`¿Cerrar la Semana ${weekDisplayNum}? Se calcularán todas las liquidaciones.`)) return
    try {
      setActionLoading('close-week')
      const barbers = await getBarbersByBranch(selectedBranch)
      await closeWeek(selectedWeek.id, currentUserId)
      await calculateAllSettlementsForWeek(selectedWeek.id, barbers.map((b) => b.id))
      const ms = await getMonthsWithWeeks(selectedBranch)
      setMonths(ms)
      const updatedWeeks = ms[selectedMonthIdx]?.weeks ?? []
      setSelectedWeek(updatedWeeks.find((w) => w.id === selectedWeek.id) ?? null)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cerrando semana')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleRecalculate() {
    if (!selectedWeek) return
    try {
      setActionLoading('recalc')
      const barbers = await getBarbersByBranch(selectedBranch)
      await calculateAllSettlementsForWeek(selectedWeek.id, barbers.map((b) => b.id))
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error recalculando')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleRecalcularSettlement(
    settlementId: string,
    weekId: string,
    barberId: string
  ) {
    try {
      setActionLoading(`recalc-${settlementId}`)
      await recalculateSettlementFull(weekId, barberId)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error recalculando la liquidación')
    } finally {
      setActionLoading(null)
    }
  }

  async function handlePresentismo(
    settlementId: string,
    weekId: string,
    barberId: string,
    current: boolean
  ) {
    try {
      setActionLoading(`presentismo-${settlementId}`)
      await setPresentismo(settlementId, weekId, barberId, !current)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error actualizando presentismo')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleObjetivo(
    settlementId: string,
    weekId: string,
    barberId: string,
    current: boolean
  ) {
    try {
      setActionLoading(`objetivo-${settlementId}`)
      await setObjetivo(settlementId, weekId, barberId, !current)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error actualizando objetivo')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDeleteTransaction(txId: string) {
    setConfirmDeleteTxId(null)
    try {
      setActionLoading(`tx-del-${txId}`)
      await deleteTransaction(txId)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar la transacción')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSetBoxRent(
    settlementId: string,
    weekId: string,
    barberId: string,
    amount: number
  ) {
    try {
      setActionLoading(`boxrent-${settlementId}`)
      await setBoxRent(settlementId, weekId, barberId, amount)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error actualizando alquiler de box')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSetPresentismoOverride(
    settlementId: string,
    weekId: string,
    barberId: string,
    amount: number | null
  ) {
    try {
      setActionLoading(`presentismo-${settlementId}`)
      await setBonusPresentismoOverride(settlementId, weekId, barberId, amount)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error ajustando presentismo')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSetObjetivoOverride(
    settlementId: string,
    weekId: string,
    barberId: string,
    amount: number | null
  ) {
    try {
      setActionLoading(`objetivo-${settlementId}`)
      await setBonusObjetivoOverride(settlementId, weekId, barberId, amount)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error ajustando objetivo')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSaveInitialBalance() {
    if (!selectedBranch || !selectedMonthId) return
    const amount = parseFloat(balanceInput)
    if (Number.isNaN(amount)) { setError('Ingresá un monto válido (puede ser negativo)'); return }
    try {
      setSavingBalance(true)
      const rb = await setInitialBalance(selectedBranch, selectedMonthId, amount)
      setInitialBalanceState(rb)
      setEditingBalance(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando el saldo inicial')
    } finally {
      setSavingBalance(false)
    }
  }

  async function handleConfirmSettlement(settlementId: string) {
    try {
      setActionLoading(`confirm-${settlementId}`)
      await confirmSettlement(settlementId)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error confirmando liquidación')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleMarkPaid(s: SettlementWithBarber) {
    // Si el barbero debía (liquidación negativa), abrir primero el modal de
    // devolución. Marcar como pagada se hace recién al confirmar dentro del
    // modal (cancelar o cerrar NO cambia el estado). Opción C.
    if (s.net_payable < 0) {
      setDebtModal({
        settlementId: s.id,
        barberId:     s.barber_id,
        branchId:     s.branch_id,
        barberName:   s.barber.full_name,
        outstanding:  -s.net_payable,
      })
      return
    }
    try {
      setActionLoading(`paid-${s.id}`)
      await markSettlementPaid(s.id)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error marcando como pagado')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDeleteSettlement(settlementId: string) {
    setConfirmDeleteSettlId(null)
    try {
      setActionLoading(`delete-${settlementId}`)
      const { weekReverted } = await deleteSettlement(settlementId)
      if (weekReverted && selectedWeek) {
        const ms = await getMonthsWithWeeks(selectedBranch)
        setMonths(ms)
        const updatedWeeks = ms[selectedMonthIdx]?.weeks ?? []
        setSelectedWeek(updatedWeeks.find((w) => w.id === selectedWeek.id) ?? null)
      }
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar liquidación')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleCancelSettlement(settlementId: string) {
    setConfirmCancelSettlId(null)
    try {
      setActionLoading(`cancel-${settlementId}`)
      const { weekReverted } = await cancelSettlement(settlementId)
      if (weekReverted && selectedWeek) {
        const ms = await getMonthsWithWeeks(selectedBranch)
        setMonths(ms)
        const updatedWeeks = ms[selectedMonthIdx]?.weeks ?? []
        setSelectedWeek(updatedWeeks.find((w) => w.id === selectedWeek.id) ?? null)
      }
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al anular liquidación')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDeleteExpense(expenseId: string) {
    setConfirmDeleteExpId(null)
    try {
      setActionLoading(`exp-del-${expenseId}`)
      await deleteExpense(expenseId)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar gasto')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // ─── KPIs de la semana ─────────────────────────────────────────────
  const kpis = {
    grossTotal: settlements.reduce((s, x) => s + x.gross_amount, 0),
    branchTotal: settlements.reduce((s, x) => s + (x.gross_amount - x.barber_gross - x.bonus_presentismo - x.bonus_objetivo), 0),
    totalPayable: settlements.reduce((s, x) => s + Math.max(x.net_payable, 0), 0),
    totalCuts: settlements.reduce((s, x) => s + x.total_cuts, 0),
    cashTotal: settlements.reduce((s, x) => s + x.cash_amount, 0),
    // Efectivo que los barberos devolvieron al saldar deudas (liquidaciones
    // negativas ya pagadas). Es informativo: NO suma a la ganancia neta porque
    // ese dinero ya está contado por devengado (comisión / alquiler de box).
    cashReturnedByBarbers: settlements.reduce((s, x) => s + (x.status === 'paid' && x.net_payable < 0 ? -x.net_payable : 0), 0),
    transferTotal: settlements.reduce((s, x) => s + x.transfer_amount, 0),
    cardTotal: settlements.reduce((s, x) => s + x.card_amount, 0),
    expensesTotal: expenses.reduce((s, x) => s + x.amount, 0),
    barberCount: new Set(settlements.map((s) => s.barber_id)).size,
    // Gastos operativos (sin retiros de socios) y retiros de socios por separado
    operationalExpenses: expenses.filter((e) => e.category !== 'retiro_socio').reduce((s, e) => s + e.amount, 0),
    partnerWithdrawals: expenses.filter((e) => e.category === 'retiro_socio').reduce((s, e) => s + e.amount, 0),
  }

  // ─── RENDER ────────────────────────────────────────────────────────
  if (loading) return <AdminLoadingScreen />
  if (error) return <AdminErrorScreen message={error} onRetry={() => setError(null)} />

  return (
    <div className="admin-app">
      <AdminSideDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onLogout={handleLogout}
        onRegisterCut={() => { setIsDrawerOpen(false); setShowManualCut(true) }}
        adminName={adminName}
        isWeekClosed={selectedWeek?.status !== 'open'}
      />
      {/* ── HEADER WRAPPER (sticky) ── */}
      <div className="admin-header-wrapper">

        {/* ── Barra de marca ── */}
        <div className="admin-brand-bar">
          <span className="admin-logo">VALHALLA</span>
          <span className="admin-badge">Admin</span>
          <span className="admin-brand-separator">·</span>
          <span className="admin-brand-branch">
            {branches.find((b) => b.id === selectedBranch)?.name ?? '—'}
          </span>
          {branches.length > 1 && (
            <button
              onClick={() => router.push('/admin/select-branch')}
              className="admin-brand-switch"
              title="Cambiar de sucursal"
            >
              cambiar
            </button>
          )}
          {adminName && (
            <span className="admin-brand-greeting" title={adminName}>
              Hola, {adminName.split(' ')[0]} <span aria-hidden="true">👋</span>
            </span>
          )}
        </div>

        {/* ── Barra de controles ── */}
        <header className="admin-topbar">
          {/* Izquierda: semana */}
          <div className="admin-topbar-left">
            {months.length > 0 && (
              <div className="month-nav">
                <button
                  className="month-nav-arrow"
                  disabled={selectedMonthIdx === 0}
                  onClick={() => {
                    const idx = selectedMonthIdx - 1
                    setSelectedMonthIdx(idx)
                    const ws = months[idx]?.weeks ?? []
                    setSelectedWeek(ws.find((w) => w.status === 'open') ?? ws[ws.length - 1] ?? null)
                  }}
                >‹</button>
                <span className="month-nav-label">
                  {MONTH_NAMES[(months[selectedMonthIdx]?.month ?? 1) - 1]}{' '}
                  {months[selectedMonthIdx]?.year}
                </span>
                <button
                  className="month-nav-arrow"
                  disabled={selectedMonthIdx === months.length - 1}
                  onClick={() => {
                    const idx = selectedMonthIdx + 1
                    setSelectedMonthIdx(idx)
                    const ws = months[idx]?.weeks ?? []
                    setSelectedWeek(ws.find((w) => w.status === 'open') ?? ws[ws.length - 1] ?? null)
                  }}
                >›</button>
              </div>
            )}
            {weeks.length > 0 && (
              <div className="week-pills">
                {weeks.map((w, i) => (
                  <button
                    key={w.id}
                    onClick={() => setSelectedWeek(w)}
                    title={`${formatDate(w.start_date)} – ${formatDate(w.end_date)} · ${WEEK_STATUS_LABELS[w.status]}`}
                    className={[
                      'week-pill',
                      selectedWeek?.id === w.id ? 'week-pill--active' : '',
                      w.status === 'open' ? 'week-pill--open' : '',
                      w.status === 'paid' ? 'week-pill--paid' : '',
                    ].join(' ')}
                  >
                    S{i + 1}
                  </button>
                ))}
              </div>
            )}
            {selectedWeek?.status === 'open' && (
              <button
                onClick={handleCloseWeek}
                disabled={actionLoading === 'close-week'}
                className="admin-btn admin-btn--danger"
              >
                {actionLoading === 'close-week' ? 'Cerrando...' : 'Cerrar semana'}
              </button>
            )}
            {selectedWeek && selectedWeek.status !== 'open' && (
              <button
                onClick={handleRecalculate}
                disabled={actionLoading === 'recalc'}
                className="admin-btn admin-btn--ghost"
              >
                {actionLoading === 'recalc' ? 'Recalculando...' : '↺ Recalcular'}
              </button>
            )}
          </div>

          {/* Derecha: navegación a secciones */}
          <div className="admin-topbar-right">
            {selectedWeek?.status === 'open' && (
              <button
                onClick={() => setShowManualCut(true)}
                className="admin-btn admin-btn--primary"
                title="Registrar un corte de un barbero en cualquier día de la semana"
              >
                + Registrar corte
              </button>
            )}
            {/* Botón hamburguesa para menú lateral */}
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="admin-btn admin-btn--ghost"
              aria-label="Abrir menú"
              title="Menú"
            >
              ≡
            </button>
          </div>
        </header>

        {/* ── TABS (dentro del sticky para que no se oculten al scrollear) ── */}
        <div className="admin-tabs">
          {((['live', 'liquidaciones', 'transacciones', 'gastos', 'saldo', 'adelantos'] as Tab[])
            .filter((t) => t !== 'live' || selectedWeek?.status === 'open')
          ).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`admin-tab ${tab === t ? 'admin-tab--active' : ''}`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* ── KPIs de liquidaciones: dentro del header sticky para que queden fijos ── */}
        {tab === 'liquidaciones' && selectedWeek && (
          <div className="kpi-strip">
            <KpiCard
              label="Facturado bruto"
              value={formatARS(kpis.grossTotal)}
              sub={`${kpis.totalCuts} cortes`}
              tooltip="Lo facturado en los cortes de la semana."
            />
            <KpiCard
              label="Para la barbería"
              value={formatARS(kpis.branchTotal)}
              accent="positive"
              tooltip="Lo que queda del facturado tras comisiones y bonos."
            />
            <KpiCard
              label="A pagar barberos"
              value={formatARS(kpis.totalPayable)}
              accent="warning"
              tooltip="Neto a pagar a los barberos."
            />
            <KpiCard
              label="Efectivo"
              value={formatARS(kpis.cashTotal)}
              sub="en caja"
              tooltip="Total cobrado en efectivo."
            />
            <KpiCard
              label="Transferencias"
              value={formatARS(kpis.transferTotal)}
              tooltip="Total cobrado por transferencia."
            />
            <KpiCard
              label="Devuelto x barberos"
              value={formatARS(kpis.cashReturnedByBarbers)}
              sub="entró a caja"
              tooltip="Efectivo que los barberos devolvieron al saldar deudas (liquidaciones negativas ya marcadas como pagadas). Es informativo: NO suma a la ganancia neta, porque ese dinero ya está contado por devengado (comisión de cortes o alquiler de box)."
            />
            <KpiCard
              label="Barberos"
              value={String(kpis.barberCount)}
              tooltip="Cantidad de barberos con liquidación esta semana."
            />
            <KpiCard
              label="Gastos semana"
              value={formatARS(kpis.operationalExpenses)}
              accent="negative"
              tooltip="Gastos de la semana, sin contar retiros de socios."
            />
            <KpiCard
              label="Retiros socios"
              value={formatARS(kpis.partnerWithdrawals)}
              tooltip="Retiros de los socios (ganancia x socios)."
            />
          </div>
        )}

      </div>

      {/* ── Banner: alerta de año próximo no cargado ── */}
      {showYearBanner && (
        <div className="year-banner">
          <div className="year-banner__msg">
            <span className="year-banner__icon">⚠</span>
            <span>
              El año <strong>{new Date().getFullYear() + 1}</strong> todavía no está cargado en esta sucursal.
              Creá el calendario antes de fin de año para no perder continuidad.
            </span>
          </div>
          <div className="year-banner__actions">
            <Link href="/admin/configuracion" className="year-banner__btn">
              Ir a Configuración
            </Link>
            <button onClick={() => setBannerDismissed(true)} className="year-banner__dismiss" title="Ocultar">✕</button>
          </div>
        </div>
      )}

      {/* ── CONTENT ── */}
      <main className="admin-content">

        {/* ─── TAB: LIVE ─── */}
        {tab === 'live' && selectedWeek && (
          <LiveDashboard transactions={liveTransactions} weekNumber={weeks.length - weeks.findIndex((w) => w.id === selectedWeek.id)} />
        )}

        {/* ─── TAB: LIQUIDACIONES ─── */}
        {tab === 'liquidaciones' && (() => {
          const barberOptsSettl = Array.from(new Map(settlements.map((s) => [s.barber_id, s.barber.full_name])))
          const hasSettlFilters = !!(settlFilterBarber || settlFilterObjetivo || settlFilterPresentismo || settlFilterAdelantos || settlFilterAPagar || settlFilterEstado)
          const filteredSettlements = settlements.filter((s) => {
            // Objetivo/presentismo aplican a salary y % comisión (no a alquiler de box)
            const hasBonuses = s.barber.compensation_type !== 'box_rental'
            if (settlFilterBarber && s.barber_id !== settlFilterBarber) return false
            if (settlFilterEstado && s.status !== settlFilterEstado) return false
            if (settlFilterObjetivo === 'na' && hasBonuses) return false
            if (settlFilterObjetivo === 'met' && (!hasBonuses || !s.objetivo_met)) return false
            if (settlFilterObjetivo === 'not_met' && (!hasBonuses || s.objetivo_met === true)) return false
            if (settlFilterPresentismo === 'na' && hasBonuses) return false
            if (settlFilterPresentismo === 'met' && (!hasBonuses || !s.presentismo_met)) return false
            if (settlFilterPresentismo === 'not_met' && (!hasBonuses || s.presentismo_met === true)) return false
            if (settlFilterAdelantos === 'with' && s.advances_deducted <= 0) return false
            if (settlFilterAdelantos === 'without' && s.advances_deducted > 0) return false
            if (settlFilterAPagar === 'positive' && s.net_payable < 0) return false
            if (settlFilterAPagar === 'negative' && s.net_payable >= 0) return false
            return true
          })
          // Paginación: recorta la grilla a la página actual (los TOTALES siguen sobre todo el filtro)
          const settlTotalPages = Math.max(1, Math.ceil(filteredSettlements.length / settlPageSize))
          const settlCurrentPage = Math.min(settlPage, settlTotalPages)
          const settlStartIdx = (settlCurrentPage - 1) * settlPageSize
          const pagedSettlements = filteredSettlements.slice(settlStartIdx, settlStartIdx + settlPageSize)
          // Número de semana visible (igual que en las pills "S{n}")
          const settlWeekNumber = selectedWeek ? weeks.findIndex((w) => w.id === selectedWeek.id) + 1 : 0
          return (
          <div>
          {settlements.length > 0 && (
            <div className="filter-bar">
              {selectedWeek && (
                <span className="week-chip" title={`Liquidaciones de la Semana ${settlWeekNumber}`}>
                  📅 Semana {settlWeekNumber} · {formatDate(selectedWeek.start_date)}–{formatDate(selectedWeek.end_date)}
                </span>
              )}
              <select value={settlFilterBarber} onChange={(e) => setSettlFilterBarber(e.target.value)} className="filter-input">
                <option value="">Todos los barberos</option>
                {barberOptsSettl.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
              <select value={settlFilterEstado} onChange={(e) => setSettlFilterEstado(e.target.value)} className="filter-input">
                <option value="">Todos los estados</option>
                <option value="draft">Borrador</option>
                <option value="confirmed">Confirmado</option>
                <option value="paid">Pagado</option>
              </select>
              <select value={settlFilterObjetivo} onChange={(e) => setSettlFilterObjetivo(e.target.value)} className="filter-input">
                <option value="">Objetivo (todos)</option>
                <option value="met">Objetivo cumplido</option>
                <option value="not_met">No cumplido</option>
                <option value="na">No aplica</option>
              </select>
              <select value={settlFilterPresentismo} onChange={(e) => setSettlFilterPresentismo(e.target.value)} className="filter-input">
                <option value="">Presentismo (todos)</option>
                <option value="met">Presentismo ok</option>
                <option value="not_met">Sin presentismo</option>
                <option value="na">No aplica</option>
              </select>
              <select value={settlFilterAdelantos} onChange={(e) => setSettlFilterAdelantos(e.target.value)} className="filter-input">
                <option value="">Adelantos (todos)</option>
                <option value="with">Con adelantos</option>
                <option value="without">Sin adelantos</option>
              </select>
              <select value={settlFilterAPagar} onChange={(e) => setSettlFilterAPagar(e.target.value)} className="filter-input">
                <option value="">A pagar (todos)</option>
                <option value="positive">A cobrar</option>
                <option value="negative">Debe</option>
              </select>
              {hasSettlFilters && (
                <button
                  onClick={() => { setSettlFilterBarber(''); setSettlFilterObjetivo(''); setSettlFilterPresentismo(''); setSettlFilterAdelantos(''); setSettlFilterAPagar(''); setSettlFilterEstado(''); setSettlPage(1) }}
                  className="filter-clear"
                >
                  ✕ Limpiar
                </button>
              )}
              <span className="filter-count">{filteredSettlements.length} resultado{filteredSettlements.length !== 1 ? 's' : ''}</span>
            </div>
          )}
          <div className="admin-table-wrap">
            {settlements.length === 0 ? (
              <EmptyState message="No hay liquidaciones para esta semana. Cerrá la semana para generarlas." />
            ) : filteredSettlements.length === 0 ? (
              <EmptyState message="Sin resultados para los filtros aplicados." />
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Barbero</th>
                    <th>Cortes</th>
                    <th>Facturado</th>
                    <th>Comisión base</th>
                    <th>Presentismo</th>
                    <th>Objetivo</th>
                    <th>Alquiler box</th>
                    <th>Total ganado</th>
                    <th>Ya cobrado</th>
                    <th>Adelantos</th>
                    <th className="th-highlight">A pagar</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSettlements.map((s) => {
                    const hasBonuses = s.barber.compensation_type !== 'box_rental'
                    const isPositive = s.net_payable >= 0
                    const loadingKey = actionLoading
                    return (
                      <tr key={s.id} className={!isPositive ? 'tr-danger' : ''}>
                        <td>
                          <div className="barber-cell">
                            <div className="barber-avatar">
                              {s.barber.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                            </div>
                            <div>
                              <p className="barber-name">{s.barber.full_name}</p>
                              <p className="barber-type">
                                {s.barber.compensation_type === 'percentage' ? '% comisión' : 'Salario'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="td-center">{s.total_cuts}</td>
                        <td>{formatARS(s.gross_amount)}</td>
                        <td>{formatARS(s.barber_gross)}</td>
                        <td>
                          {hasBonuses ? (
                            s.status === 'draft' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <button
                                  onClick={() => handlePresentismo(s.id, s.week_id, s.barber_id, s.presentismo_met ?? false)}
                                  disabled={loadingKey === `presentismo-${s.id}`}
                                  className={`toggle-btn ${s.presentismo_met ? 'toggle-btn--on' : 'toggle-btn--off'}`}
                                >
                                  {s.presentismo_met ? 'Sí' : 'No'}
                                </button>
                                {s.presentismo_met && (
                                  <>
                                    <CurrencyInputInline
                                      key={`pres-${s.id}-${s.bonus_presentismo}`}
                                      defaultValue={s.bonus_presentismo || ''}
                                      disabled={loadingKey === `presentismo-${s.id}`}
                                      onCommit={(next) => {
                                        if (Math.abs(next - s.bonus_presentismo) > 0.001) {
                                          handleSetPresentismoOverride(s.id, s.week_id, s.barber_id, next)
                                        }
                                      }}
                                      className="filter-input"
                                      style={{ width: 96 }}
                                      title="Monto del bono (editable a mano)"
                                    />
                                    {s.bonus_presentismo_override != null && (
                                      <button
                                        type="button"
                                        title="Volver al cálculo automático"
                                        onClick={() => handleSetPresentismoOverride(s.id, s.week_id, s.barber_id, null)}
                                        className="admin-btn admin-btn--ghost"
                                        style={{ padding: '0.25rem 0.5rem' }}
                                      >↺ auto</button>
                                    )}
                                  </>
                                )}
                              </div>
                            ) : (
                              <span className={`badge ${s.presentismo_met ? 'badge--green' : 'badge--red'}`}>
                                {s.presentismo_met ? `Sí · ${formatARS(s.bonus_presentismo)}` : 'No'}
                              </span>
                            )
                          ) : (
                            <span className="td-na">—</span>
                          )}
                        </td>
                        <td>
                          {hasBonuses ? (
                            s.status === 'draft' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <button
                                  onClick={() => handleObjetivo(s.id, s.week_id, s.barber_id, s.objetivo_met ?? false)}
                                  disabled={loadingKey === `objetivo-${s.id}`}
                                  className={`toggle-btn ${s.objetivo_met ? 'toggle-btn--on' : 'toggle-btn--off'}`}
                                >
                                  {s.objetivo_met ? 'Sí' : 'No'}
                                </button>
                                {s.objetivo_met && (
                                  <>
                                    <CurrencyInputInline
                                      key={`obj-${s.id}-${s.bonus_objetivo}`}
                                      defaultValue={s.bonus_objetivo || ''}
                                      disabled={loadingKey === `objetivo-${s.id}`}
                                      onCommit={(next) => {
                                        if (Math.abs(next - s.bonus_objetivo) > 0.001) {
                                          handleSetObjetivoOverride(s.id, s.week_id, s.barber_id, next)
                                        }
                                      }}
                                      className="filter-input"
                                      style={{ width: 96 }}
                                      title="Monto del bono (editable a mano)"
                                    />
                                    {s.bonus_objetivo_override != null && (
                                      <button
                                        type="button"
                                        title="Volver al cálculo automático"
                                        onClick={() => handleSetObjetivoOverride(s.id, s.week_id, s.barber_id, null)}
                                        className="admin-btn admin-btn--ghost"
                                        style={{ padding: '0.25rem 0.5rem' }}
                                      >↺ auto</button>
                                    )}
                                  </>
                                )}
                              </div>
                            ) : (
                              <span className={`badge ${s.objetivo_met ? 'badge--green' : 'badge--red'}`}>
                                {s.objetivo_met ? `Sí · ${formatARS(s.bonus_objetivo)}` : 'No'}
                              </span>
                            )
                          ) : (
                            <span className="td-na">—</span>
                          )}
                        </td>
                        <td>
                          {s.barber.compensation_type === 'box_rental' ? (
                            s.status === 'draft' ? (
                              <CurrencyInputInline
                                defaultValue={s.box_rent || ''}
                                placeholder="0"
                                disabled={loadingKey === `boxrent-${s.id}`}
                                onCommit={(v) => {
                                  if (v !== s.box_rent) handleSetBoxRent(s.id, s.week_id, s.barber_id, v)
                                }}
                                className="filter-input"
                                style={{ width: 90 }}
                                title="Alquiler del box que paga el barbero esta semana"
                              />
                            ) : (
                              <span className="td-muted">{formatARS(s.box_rent)}</span>
                            )
                          ) : (
                            <span className="td-na">—</span>
                          )}
                        </td>
                        <td className="td-bold">{formatARS(s.total_earned)}</td>
                        <td className="td-muted">
                          {s.already_collected > 0
                            ? <span className="td-collected">{formatARS(s.already_collected)}</span>
                            : '—'}
                        </td>
                        <td className="td-muted">
                          {s.advances_deducted > 0 ? (
                            <button
                              type="button"
                              onClick={() => openAdvancesDetail(s.barber_id, s.branch_id, s.barber.full_name)}
                              className="td-advance td-advance--btn"
                              title="Ver detalle de adelantos aplicados"
                            >
                              {formatARS(s.advances_deducted)} <span className="td-advance__icon">›</span>
                            </button>
                          ) : '—'}
                        </td>
                        <td>
                          <span className={`net-payable ${isPositive ? 'net-payable--pos' : 'net-payable--neg'}`}>
                            {isPositive ? '' : '↑ Debe '}
                            {formatARS(Math.abs(s.net_payable))}
                          </span>
                        </td>
                        <td>
                          <span className={`badge badge--${s.status}`}>
                            {SETTLEMENT_STATUS_LABELS[s.status]}
                          </span>
                        </td>
                        <td>
                          <div className="action-group">
                            {s.status === 'draft' && (
                              <button
                                onClick={() => handleRecalcularSettlement(s.id, s.week_id, s.barber_id)}
                                disabled={loadingKey === `recalc-${s.id}`}
                                className="action-btn"
                                title="Recalcular con los datos actuales del barbero (comisión, presentismo, objetivo)"
                              >
                                {loadingKey === `recalc-${s.id}` ? 'Recalculando…' : 'Recalcular'}
                              </button>
                            )}
                            {s.status === 'draft' && (
                              <button
                                onClick={() => handleConfirmSettlement(s.id)}
                                disabled={loadingKey === `confirm-${s.id}`}
                                className="action-btn action-btn--confirm"
                              >
                                Confirmar
                              </button>
                            )}
                            {s.status === 'confirmed' && (
                              <button
                                onClick={() => handleMarkPaid(s)}
                                disabled={loadingKey === `paid-${s.id}`}
                                className="action-btn action-btn--pay"
                              >
                                Marcar pagado
                              </button>
                            )}
                            {s.status === 'paid' && (
                              <span className="action-done">✓ Pagado</span>
                            )}
                            {(s.status === 'confirmed' || s.status === 'paid') && (
                              confirmCancelSettlId === s.id ? (
                                <span className="flex items-center gap-1 text-xs">
                                  <span className="td-muted">¿Anular?</span>
                                  <button
                                    onClick={() => handleCancelSettlement(s.id)}
                                    disabled={loadingKey === `cancel-${s.id}`}
                                    className="action-btn action-btn--warn"
                                  >
                                    Sí
                                  </button>
                                  <button
                                    onClick={() => setConfirmCancelSettlId(null)}
                                    className="action-btn"
                                  >
                                    No
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => setConfirmCancelSettlId(s.id)}
                                  disabled={!!loadingKey}
                                  className="action-btn action-btn--warn"
                                  title="Devolver a borrador para corregir"
                                >
                                  Anular
                                </button>
                              )
                            )}
                            {confirmDeleteSettlId === s.id ? (
                              <span className="flex items-center gap-1 text-xs">
                                <span className="td-muted">¿Eliminar?</span>
                                <button
                                  onClick={() => handleDeleteSettlement(s.id)}
                                  disabled={loadingKey === `delete-${s.id}`}
                                  className="action-btn action-btn--danger"
                                >
                                  Sí
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteSettlId(null)}
                                  className="action-btn"
                                >
                                  No
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteSettlId(s.id)}
                                disabled={!!loadingKey}
                                className="action-btn action-btn--danger"
                              >
                                Eliminar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="tfoot-row">
                    <td colSpan={2}><strong>TOTALES</strong></td>
                    <td><strong>{formatARS(filteredSettlements.reduce((s, x) => s + x.gross_amount, 0))}</strong></td>
                    <td colSpan={5}></td>
                    <td><strong>{formatARS(filteredSettlements.reduce((s, x) => s + x.already_collected, 0))}</strong></td>
                    <td><strong>{formatARS(filteredSettlements.reduce((s, x) => s + x.advances_deducted, 0))}</strong></td>
                    <td><strong className="net-payable--pos">{formatARS(filteredSettlements.reduce((s, x) => s + Math.max(x.net_payable, 0), 0))}</strong></td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          <PaginationControls
            currentPage={settlCurrentPage}
            totalPages={settlTotalPages}
            pageSize={settlPageSize}
            totalItems={filteredSettlements.length}
            startIdx={filteredSettlements.length === 0 ? 0 : settlStartIdx + 1}
            endIdx={Math.min(settlStartIdx + settlPageSize, filteredSettlements.length)}
            canGoPrevious={settlCurrentPage > 1}
            canGoNext={settlCurrentPage < settlTotalPages}
            onPageChange={setSettlPage}
            onPageSizeChange={(s) => { setSettlPageSize(s); setSettlPage(1) }}
            itemLabel="liquidaciones"
          />
          </div>
          )
        })()}

        {/* ─── TAB: TRANSACCIONES ─── */}
        {tab === 'transacciones' && (() => {
          // Opciones únicas para los selects
          const barberOptions = Array.from(new Map(transactions.map((t) => [t.barber_id, t.barber.full_name])))
          const serviceOptions = Array.from(new Set(transactions.map((t) => t.service?.name).filter(Boolean))) as string[]
          const hasFilters = filterDateFrom || filterDateTo || filterBarber || filterMethod || filterService
          const filtered = transactions.filter((tx) => {
            if (filterDateFrom && tx.transaction_date < filterDateFrom) return false
            if (filterDateTo && tx.transaction_date > filterDateTo) return false
            if (filterBarber && tx.barber_id !== filterBarber) return false
            if (filterMethod && tx.payment_method !== filterMethod) return false
            if (filterService && (tx.service?.name ?? '') !== filterService) return false
            return true
          })
          const txTotalPages = Math.max(1, Math.ceil(filtered.length / txPageSize))
          const txCurrent = Math.min(txPage, txTotalPages)
          const txPaged = filtered.slice((txCurrent - 1) * txPageSize, txCurrent * txPageSize)
          return (
          <div>
            {/* Barra de filtros */}
            <div className="filter-bar">
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="filter-input"
                title="Desde"
              />
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="filter-input"
                title="Hasta"
              />
              <select value={filterBarber} onChange={(e) => setFilterBarber(e.target.value)} className="filter-input">
                <option value="">Todos los barberos</option>
                {barberOptions.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
              <select value={filterMethod} onChange={(e) => setFilterMethod(e.target.value)} className="filter-input">
                <option value="">Todos los métodos</option>
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
                <option value="mixed">Mixto</option>
              </select>
              <select value={filterService} onChange={(e) => setFilterService(e.target.value)} className="filter-input">
                <option value="">Todos los servicios</option>
                {serviceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {hasFilters && (
                <button onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterBarber(''); setFilterMethod(''); setFilterService('') }}
                  className="filter-clear">
                  ✕ Limpiar
                </button>
              )}
              <span className="filter-count">{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="admin-table-wrap">
            {filtered.length === 0 ? (
              <EmptyState message="Sin resultados para los filtros aplicados." />
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>Fecha</th>
                    <th rowSpan={2}>Barbero</th>
                    <th rowSpan={2}>Servicio</th>
                    <th rowSpan={2}>Cliente</th>
                    <th rowSpan={2}>Método</th>
                    <th rowSpan={2}>Total</th>
                    <th colSpan={2} style={{ textAlign: 'center' }}>Detalle</th>
                    <th rowSpan={2}>Modificado</th>
                    <th rowSpan={2}></th>
                  </tr>
                  <tr>
                    <th>Barbería</th>
                    <th>Barbero</th>
                  </tr>
                </thead>
                <tbody>
                  {txPaged.map((tx) => (
                    <tr key={tx.id} className={tx.is_manual_override ? 'tr-override' : ''}>
                      <td className="td-date td-left">{formatDate(tx.transaction_date)}</td>
                      <td className="td-left">{tx.barber.full_name}</td>
                      <td className="td-left">{tx.service?.name ?? '—'}</td>
                      <td className="td-muted td-left">{[tx.client_name, tx.client_surname].filter(Boolean).join(' ') || '—'}</td>
                      <td>
                        <span className={`dot-badge dot-badge--${tx.payment_method}`}>
                          {PAYMENT_METHOD_LABELS[tx.payment_method]}
                        </span>
                      </td>
                      <td className="td-bold">{formatARS(tx.amount)}</td>
                      <td>{formatARS(tx.amount - tx.barber_already_collected)}</td>
                      <td>
                        {tx.barber_already_collected > 0
                          ? <span className="td-collected">{formatARS(tx.barber_already_collected)}</span>
                          : formatARS(0)}
                      </td>
                      <td>
                        {tx.is_manual_override
                          ? <span className="badge badge--orange" title={tx.override_notes ?? ''}>Editado</span>
                          : '—'}
                      </td>
                      <td>
                        <div className="action-group">
                          <button
                            onClick={() => setEditTx(tx)}
                            className="action-btn action-btn--confirm"
                          >
                            Editar
                          </button>
                          {confirmDeleteTxId === tx.id ? (
                            <span className="flex items-center gap-1 text-xs">
                              <span className="td-muted">¿Eliminar?</span>
                              <button
                                onClick={() => handleDeleteTransaction(tx.id)}
                                disabled={actionLoading === `tx-del-${tx.id}`}
                                className="action-btn action-btn--danger"
                              >
                                Sí
                              </button>
                              <button
                                onClick={() => setConfirmDeleteTxId(null)}
                                className="action-btn"
                              >
                                No
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteTxId(tx.id)}
                              disabled={!!actionLoading}
                              className="action-btn action-btn--danger"
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="tfoot-row">
                    <td colSpan={5}><strong>{filtered.length} transacción{filtered.length !== 1 ? 'es' : ''}</strong></td>
                    <td><strong>{formatARS(filtered.reduce((s, t) => s + t.amount, 0))}</strong></td>
                    <td><strong>{formatARS(filtered.reduce((s, t) => s + (t.amount - t.barber_already_collected), 0))}</strong></td>
                    <td><strong>{formatARS(filtered.reduce((s, t) => s + t.barber_already_collected, 0))}</strong></td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            )}
            </div>{/* /admin-table-wrap */}
            <PaginationControls
              currentPage={txCurrent}
              totalPages={txTotalPages}
              pageSize={txPageSize}
              totalItems={filtered.length}
              startIdx={filtered.length === 0 ? 0 : (txCurrent - 1) * txPageSize + 1}
              endIdx={Math.min(txCurrent * txPageSize, filtered.length)}
              canGoPrevious={txCurrent > 1}
              canGoNext={txCurrent < txTotalPages}
              onPageChange={setTxPage}
              onPageSizeChange={(s) => { setTxPageSize(s); setTxPage(1) }}
              itemLabel="transacciones"
            />

            {/* ── Adelantos del período ─────────────────────────── */}
            {weekAdvances.length > 0 && (
              <div className="advances-section">
                <div className="advances-section__header">
                  <span className="advances-section__title">Adelantos del período</span>
                  <span className="advances-section__total">
                    Total: <strong>{formatARS(weekAdvances.reduce((s, a) => s + a.amount, 0))}</strong>
                  </span>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Barbero</th>
                        <th>Motivo</th>
                        <th>Estado</th>
                        <th>Monto</th>
                        <th>Origen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekAdvances.map((adv) => (
                        <tr key={adv.id}>
                          <td className="td-date">{formatDate(adv.advance_date)}</td>
                          <td>{adv.barber.full_name}</td>
                          <td>{adv.reason ?? '—'}</td>
                          <td>
                            <span className={`badge ${adv.status === 'approved' ? 'badge--green' : 'badge--violet'}`}>
                              {adv.status === 'approved' ? 'Autorizado' : 'Pendiente'}
                            </span>
                          </td>
                          <td className="td-amber"><strong>{formatARS(adv.amount)}</strong></td>
                          <td>
                            <span className="text-xs text-zinc-500">
                              {adv.registered_by === adv.barber_id ? 'Barbero' : 'Admin'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="tfoot-row">
                        <td colSpan={4}><strong>{weekAdvances.length} adelanto{weekAdvances.length !== 1 ? 's' : ''}</strong></td>
                        <td><strong className="td-amber">{formatARS(weekAdvances.reduce((s, a) => s + a.amount, 0))}</strong></td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
          )
        })()}

        {/* ─── TAB: GASTOS ─── */}
        {tab === 'adelantos' && selectedBranch && (
          <AdvancesTab branchId={selectedBranch} />
        )}

        {/* ─── TAB: SALDO INICIAL ─── */}
        {tab === 'saldo' && (
          <div>
            <div className="balance-panel">
              <span className="balance-panel__label">
                Saldo inicial de {MONTH_NAMES[(months[selectedMonthIdx]?.month ?? 1) - 1]} {months[selectedMonthIdx]?.year}
              </span>
              {editingBalance ? (
                <span className="balance-panel__edit">
                  <CurrencyInput
                    value={balanceInput}
                    onChange={setBalanceInput}
                    allowNegative
                    className="filter-input"
                    placeholder="0 (puede ser negativo)"
                    autoFocus
                    style={{ width: 180 }}
                  />
                  <button onClick={handleSaveInitialBalance} disabled={savingBalance} className="admin-btn admin-btn--primary">
                    {savingBalance ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button onClick={() => setEditingBalance(false)} className="admin-btn admin-btn--ghost">Cancelar</button>
                </span>
              ) : (
                <span className="balance-panel__value">
                  <strong className={(initialBalance?.initial_balance ?? 0) < 0 ? 'net-payable--neg' : ''}>
                    {formatARS(initialBalance?.initial_balance ?? 0)}
                  </strong>
                  <button
                    onClick={() => { setBalanceInput(String(initialBalance?.initial_balance ?? '')); setEditingBalance(true) }}
                    className="admin-btn admin-btn--ghost"
                  >
                    {initialBalance ? 'Editar' : 'Cargar'}
                  </button>
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-500 mt-3">
              Capital con el que arranca el mes. El detalle de ganancia neta (saldo + ingresos − gastos)
              se ve en el módulo <strong>Reportes</strong>.
            </p>
          </div>
        )}

        {tab === 'gastos' && (() => {
          const hasExpFilters = !!(expFilterDateFrom || expFilterDateTo || expFilterCategory)
          const filteredExpenses = expenses.filter((e) => {
            if (expFilterDateFrom && e.expense_date < expFilterDateFrom) return false
            if (expFilterDateTo && e.expense_date > expFilterDateTo) return false
            if (expFilterCategory && e.category !== expFilterCategory) return false
            return true
          })
          const filteredTotal = filteredExpenses.reduce((s, e) => s + e.amount, 0)
          const gTotalPages = Math.max(1, Math.ceil(filteredExpenses.length / gastosPageSize))
          const gCurrent = Math.min(gastosPage, gTotalPages)
          const gPaged = filteredExpenses.slice((gCurrent - 1) * gastosPageSize, gCurrent * gastosPageSize)
          return (
          <div>
            <div className="filter-bar">
              <input
                type="date"
                value={expFilterDateFrom}
                onChange={(e) => setExpFilterDateFrom(e.target.value)}
                className="filter-input"
                title="Desde"
              />
              <input
                type="date"
                value={expFilterDateTo}
                onChange={(e) => setExpFilterDateTo(e.target.value)}
                className="filter-input"
                title="Hasta"
              />
              <select value={expFilterCategory} onChange={(e) => setExpFilterCategory(e.target.value)} className="filter-input">
                <option value="">Todas las categorías</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
              {hasExpFilters && (
                <button
                  onClick={() => { setExpFilterDateFrom(''); setExpFilterDateTo(''); setExpFilterCategory('') }}
                  className="filter-clear"
                >
                  ✕ Limpiar
                </button>
              )}
              {hasExpFilters && (
                <span className="filter-count">{filteredExpenses.length} resultado{filteredExpenses.length !== 1 ? 's' : ''}</span>
              )}
              <button
                onClick={() => setShowExpenseForm(true)}
                className="admin-btn admin-btn--primary"
                style={{ marginLeft: 'auto' }}
              >
                + Registrar gasto
              </button>
            </div>
            <div className="admin-table-wrap">
              {expenses.length === 0 ? (
                <EmptyState message="No hay gastos registrados en este período." />
              ) : filteredExpenses.length === 0 ? (
                <EmptyState message="Sin resultados para los filtros aplicados." />
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Concepto</th>
                      <th>Categoría</th>
                      <th>Monto</th>
                      <th>Notas</th>
                      <th>Registrado por</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gPaged.map((e) => (
                      <tr key={e.id}>
                        <td className="td-date">{formatDate(e.expense_date)}</td>
                        <td>{e.concept}</td>
                        <td>
                          <span className={`badge ${e.category === 'retiro_socio' ? 'badge--violet' : 'badge--gray'}`}>
                            {e.category
                              ? (EXPENSE_CATEGORY_LABELS[e.category as ExpenseCategory] ?? e.category)
                              : '—'}
                          </span>
                        </td>
                        <td className="td-danger">{formatARS(e.amount)}</td>
                        <td className="td-muted">{e.notes ?? '—'}</td>
                        <td className="td-muted">{e.registered_by_name ?? '—'}</td>
                        <td>
                          <div className="action-group">
                            <button
                              onClick={() => setEditExpense(e)}
                              disabled={!!actionLoading}
                              className="action-btn"
                            >
                              Editar
                            </button>
                            {confirmDeleteExpId === e.id ? (
                              <span className="flex items-center gap-1 text-xs">
                                <span className="td-muted">¿Eliminar?</span>
                                <button
                                  onClick={() => handleDeleteExpense(e.id)}
                                  disabled={actionLoading === `exp-del-${e.id}`}
                                  className="action-btn action-btn--danger"
                                >
                                  Sí
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteExpId(null)}
                                  className="action-btn"
                                >
                                  No
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteExpId(e.id)}
                                disabled={!!actionLoading}
                                className="action-btn action-btn--danger"
                              >
                                Eliminar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="tfoot-row">
                      <td colSpan={3}>
                        <strong>{filteredExpenses.length} gasto{filteredExpenses.length !== 1 ? 's' : ''}</strong>
                        {hasExpFilters && expenses.length !== filteredExpenses.length && (
                          <span style={{ color: '#a1a1aa', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                            (de {expenses.length})
                          </span>
                        )}
                      </td>
                      <td><strong className="td-danger">{formatARS(hasExpFilters ? filteredTotal : kpis.expensesTotal)}</strong></td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
            <PaginationControls
              currentPage={gCurrent}
              totalPages={gTotalPages}
              pageSize={gastosPageSize}
              totalItems={filteredExpenses.length}
              startIdx={filteredExpenses.length === 0 ? 0 : (gCurrent - 1) * gastosPageSize + 1}
              endIdx={Math.min(gCurrent * gastosPageSize, filteredExpenses.length)}
              canGoPrevious={gCurrent > 1}
              canGoNext={gCurrent < gTotalPages}
              onPageChange={setGastosPage}
              onPageSizeChange={(s) => { setGastosPageSize(s); setGastosPage(1) }}
              itemLabel="gastos"
            />
          </div>
          )
        })()}

      </main>

      {/* ── MODALES ── */}
      {(showExpenseForm || editExpense) && selectedWeek && (
        <ExpenseFormModal
          expense={editExpense}
          branchId={selectedBranch}
          weekId={selectedWeek.id}
          registeredBy={currentUserId}
          onClose={() => { setShowExpenseForm(false); setEditExpense(null) }}
          onSaved={async () => {
            setShowExpenseForm(false)
            setEditExpense(null)
            await loadTabData()
          }}
        />
      )}
      {editTx && (
        <EditTransactionModal
          tx={editTx}
          onClose={() => setEditTx(null)}
          onSaved={async () => {
            setEditTx(null)
            await loadTabData()
          }}
        />
      )}
      {overrideTx && (
        <OverrideSplitModal
          tx={overrideTx}
          onClose={() => setOverrideTx(null)}
          onSaved={async () => {
            setOverrideTx(null)
            await loadTabData()
          }}
        />
      )}

      {/* ── Marca de agua Flowi (fija en el centro) ── */}
      {/* ── Modal detalle de adelantos ── */}
      {advancesDetail && (
        <div className="modal-overlay" onClick={() => setAdvancesDetail(null)}>
          <div className="modal-box" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Adelantos · {advancesDetail.barberName}</h3>
              <button className="modal-close" onClick={() => setAdvancesDetail(null)}>✕</button>
            </div>
            <div className="modal-body">
              {advancesDetail.loading ? (
                <div className="flex-center" style={{ padding: '2rem' }}>
                  <div className="admin-loader" />
                </div>
              ) : advancesDetail.advances.length === 0 ? (
                <div className="empty-state"><p>Sin adelantos pendientes/autorizados.</p></div>
              ) : (
                <>
                  <p style={{ fontSize: '0.8rem', color: '#a1a1aa', margin: '0 0 0.75rem' }}>
                    Estos {advancesDetail.advances.length} adelantos se restan del neto a pagar.
                    Al marcar la liquidación como <strong>pagada</strong>, pasan a estado <code>deducted</code>.
                  </p>
                  <div className="advances-detail-list">
                    {advancesDetail.advances.map((a) => (
                      <div key={a.id} className="advances-detail-row">
                        <div className="advances-detail-row__left">
                          <span className="advances-detail-row__date">
                            {new Date(a.advance_date + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                          </span>
                          <span className={`badge badge--${a.status === 'approved' ? 'green' : 'violet'}`}>
                            {a.status === 'approved' ? 'Autorizado' : 'Pendiente'}
                          </span>
                          {a.reason && <span className="advances-detail-row__reason">{a.reason}</span>}
                        </div>
                        <span className="advances-detail-row__amount">{formatARS(a.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="advances-detail-total">
                    <span>Total descontado</span>
                    <strong>{formatARS(advancesDetail.advances.reduce((s, a) => s + a.amount, 0))}</strong>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="admin-btn admin-btn--ghost" onClick={() => setAdvancesDetail(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Registrar corte manual (admin) */}
      {showManualCut && selectedWeek && selectedBranch && currentUserId && (
        <ManualCutModal
          branchId={selectedBranch}
          weekId={selectedWeek.id}
          weekStartDate={selectedWeek.start_date}
          weekEndDate={selectedWeek.end_date}
          adminId={currentUserId}
          onClose={() => setShowManualCut(false)}
          onSuccess={() => {
            setShowManualCut(false)
            // Forzar reload de transactions via cambio de referencia
            setSelectedWeek((w) => (w ? { ...w } : null))
          }}
        />
      )}

      {/* Modal: Registrar devolución de deuda del barbero (Opción C).
          Marcar la liquidación como pagada se ejecuta al confirmar (no al abrir),
          para que cancelar/cerrar no deje la liquidación en pagada sin querer. */}
      {debtModal && currentUserId && (
        <DebtPaymentModal
          barberId={debtModal.barberId}
          branchId={debtModal.branchId}
          barberName={debtModal.barberName}
          registeredBy={currentUserId}
          outstanding={debtModal.outstanding}
          beforeSubmit={() => markSettlementPaid(debtModal.settlementId)}
          onMarkPaidOnly={async () => {
            await markSettlementPaid(debtModal.settlementId)
            setDebtModal(null)
            await loadTabData()
          }}
          onClose={() => setDebtModal(null)}
          onSuccess={() => { setDebtModal(null); loadTabData() }}
        />
      )}

      <div className="admin-watermark" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" className="admin-watermark__icon">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 8.5h3.5M5 6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className="admin-watermark__text">Flowi Management</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTES
// ─────────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
  tooltip,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'positive' | 'negative' | 'warning'
  tooltip?: string
}) {
  const colorMap = {
    positive: '#34d399',
    negative: '#f87171',
    warning: '#f59e0b',
  }
  const color = accent ? colorMap[accent] : 'inherit'
  return (
    <div className={`kpi-card${tooltip ? ' kpi-card--tip' : ''}`}>
      <p className="kpi-label">
        {label}
        {tooltip && <span className="kpi-info" aria-hidden="true">ⓘ</span>}
      </p>
      <p className="kpi-value" style={{ color }}>{value}</p>
      {sub && <p className="kpi-sub">{sub}</p>}
      {tooltip && <span className="kpi-tooltip" role="tooltip">{tooltip}</span>}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <p>{message}</p>
    </div>
  )
}

function AdminLoadingScreen() {
  return (
    <div className="admin-app flex-center">
      <div className="admin-loader" />
    </div>
  )
}

function AdminErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="admin-app flex-center">
      <div className="error-box">
        <p className="error-msg">{message}</p>
        <button onClick={onRetry} className="admin-btn admin-btn--primary">Reintentar</button>
      </div>
    </div>
  )
}

// ─── Modal: Nuevo / Editar gasto ───────────────────────────────────────────
function ExpenseFormModal({
  expense,
  branchId,
  weekId,
  registeredBy,
  onClose,
  onSaved,
}: {
  expense?: ExpenseWithUser | null
  branchId: string
  weekId: string
  registeredBy: string
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!expense
  const [form, setForm] = useState({
    concept: expense?.concept ?? '',
    expense_date: expense?.expense_date ?? todayLocal(),
    amount: expense ? String(expense.amount) : '',
    category: expense?.category ?? '',
    notes: expense?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave() {
    if (!form.concept || !form.amount || parseFloat(form.amount) <= 0) {
      setErr('Concepto y monto son obligatorios.')
      return
    }
    try {
      setSaving(true)
      if (isEdit && expense) {
        const patch: ExpenseUpdate = {
          concept: form.concept,
          expense_date: form.expense_date,
          amount: parseFloat(form.amount),
          category: form.category || null,
          notes: form.notes || null,
        }
        await updateExpense(expense.id, patch)
      } else {
        const payload: ExpenseInsert = {
          branch_id: branchId,
          week_id: weekId,
          concept: form.concept,
          expense_date: form.expense_date,
          amount: parseFloat(form.amount),
          category: form.category || null,
          notes: form.notes || null,
          registered_by: registeredBy,
          paid_by: null,
        }
        await createExpense(payload)
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isEdit ? 'Editar gasto' : 'Registrar gasto'}</h3>
          <button onClick={onClose} className="modal-close">✕</button>
        </div>
        <div className="modal-body">
          {err && <p className="form-error">{err}</p>}
          <label className="form-label">Concepto *</label>
          <input
            className="form-input"
            value={form.concept}
            onChange={(e) => setForm({ ...form, concept: e.target.value })}
            placeholder="Ej: Alquiler local"
          />
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Fecha *</label>
              <input
                type="date"
                className="form-input"
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Monto *</label>
              <CurrencyInput
                className="form-input"
                value={form.amount}
                onChange={(v) => setForm({ ...form, amount: v })}
                placeholder="0"
              />
            </div>
          </div>
          <label className="form-label">Categoría</label>
          <select
            className="form-input"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            <option value="">Sin categoría</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <label className="form-label">Notas</label>
          <textarea
            className="form-input"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Opcional"
          />
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="admin-btn admin-btn--ghost">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="admin-btn admin-btn--primary">
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Guardar gasto'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Editar split de transacción ───────────────────────────────────
// ─── EditTransactionModal helpers ────────────────────────────────────────
const EDIT_DAY_NAMES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const EDIT_MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function buildEditScrollDays(center: string, back = 60, forward = 7) {
  const [y, m, d] = center.split('-').map(Number)
  return Array.from({ length: back + forward + 1 }, (_, i) => {
    const dt  = new Date(y, m - 1, d - back + i)
    const str = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    return { date: str, label: EDIT_DAY_NAMES[dt.getDay()], dayNum: dt.getDate(), month: EDIT_MONTH_NAMES[dt.getMonth()] }
  })
}

function EditSvcChip({ label, price, active, onClick }: { label: string; price: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ padding: '0.55rem 0.4rem', borderRadius: '0.5rem', textAlign: 'center', cursor: 'pointer', background: active ? '#a78bfa' : '#18181b', border: `1px solid ${active ? '#a78bfa' : '#27272a'}`, color: active ? '#0d0d0d' : '#e4e4e7', fontSize: '0.78rem', fontWeight: 600, transition: 'background 0.1s' }}>
      {label}
      {price > 0 && <span style={{ display: 'block', fontSize: '0.65rem', opacity: 0.6, marginTop: '0.15rem' }}>{formatARS(price)}</span>}
    </button>
  )
}

function EditPayChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: 1, padding: '0.55rem', borderRadius: '0.5rem', background: active ? '#a78bfa' : '#18181b', border: `1px solid ${active ? '#a78bfa' : '#27272a'}`, color: active ? '#0d0d0d' : '#e4e4e7', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.1s' }}>
      {label}
    </button>
  )
}

// ─── EditTransactionModal ─────────────────────────────────────────────────
function EditTransactionModal({
  tx,
  onClose,
  onSaved,
}: {
  tx: TransactionWithRelations
  onClose: () => void
  onSaved: () => void
}) {
  const commissionRate = tx.commission_rate_snapshot ?? 0.5
  const todayStr = todayLocal()

  const [services,  setServices]  = useState<ServiceCatalog[]>([])
  const [allWeeks,  setAllWeeks]  = useState<Week[]>([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [err,       setErr]       = useState<string | null>(null)

  const [date,          setDate]          = useState(tx.transaction_date)
  const [serviceId,     setServiceId]     = useState(tx.service_id ?? '')
  const [customAmt,     setCustomAmt]     = useState(String(tx.amount + (tx.discount_amount ?? 0)))
  const [clientName,    setClientName]    = useState(tx.client_name ?? '')
  const [clientSurname, setClientSurname] = useState(tx.client_surname ?? '')
  const [discount,      setDiscount]      = useState(String(tx.discount_amount ?? 0))
  const [discountReason, setDiscountReason] = useState(tx.discount_reason ?? '')
  const [method,        setMethod]        = useState<PaymentMethod | ''>(tx.payment_method === 'mixed' ? '' : tx.payment_method as PaymentMethod)
  const [splitPayment,  setSplitPayment]  = useState(tx.payment_method === 'mixed')
  const [cashPart,      setCashPart]      = useState(String(tx.cash_amount ?? ''))
  const [transferPart,  setTransferPart]  = useState(String(tx.transfer_amount ?? ''))

  const [effectiveWeekId,    setEffectiveWeekId]    = useState(tx.week_id)
  const [effectiveWeekLabel, setEffectiveWeekLabel] = useState<string | null>(null)

  const scrollDays = buildEditScrollDays(date)
  const dayRef  = useRef<HTMLButtonElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  function slideLeft()  { stripRef.current?.scrollBy({ left: -132, behavior: 'smooth' }) }
  function slideRight() { stripRef.current?.scrollBy({ left:  132, behavior: 'smooth' }) }

  useEffect(() => {
    async function load() {
      try {
        const [svcs, weeks] = await Promise.all([
          getServicesByBranch(tx.branch_id),
          getWeeksByBranch(tx.branch_id),
        ])
        setServices(svcs.filter((s) => s.is_active))
        setAllWeeks(weeks)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error cargando datos')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [tx.branch_id])

  useEffect(() => {
    if (allWeeks.length === 0) return
    const match = allWeeks.find((w) => w.start_date <= date && date <= w.end_date)
    if (match) {
      setEffectiveWeekId(match.id)
      setEffectiveWeekLabel(match.id === tx.week_id ? null : `Semana ${match.start_date} → ${match.end_date}`)
    } else {
      setEffectiveWeekId(tx.week_id)
      setEffectiveWeekLabel('⚠️ Esta fecha no pertenece a ninguna semana registrada')
    }
  }, [date, allWeeks, tx.week_id])

  useEffect(() => {
    dayRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' })
  }, [loading])

  const selectedService = services.find((s) => s.id === serviceId)
  const resolvedAmount  = customAmt ? parseFloat(customAmt) : (selectedService?.base_price ?? 0)
  const discountNum     = parseFloat(discount) || 0
  const effectiveAmount = Math.max(0, resolvedAmount - discountNum)
  const cashNum         = parseFloat(cashPart) || 0
  const transferNum     = parseFloat(transferPart) || 0

  const barberShareCalc = Math.max(0, Math.min(
    Number((resolvedAmount * commissionRate - discountNum * 0.5).toFixed(2)),
    effectiveAmount
  ))
  const branchShareCalc = Number((effectiveAmount - barberShareCalc).toFixed(2))

  useEffect(() => {
    if (!splitPayment || effectiveAmount < 0) return
    if (effectiveAmount === 0) { setCashPart('0'); setTransferPart('0'); return }
    const half = Math.round(effectiveAmount / 2)
    setCashPart(String(half))
    setTransferPart(String(effectiveAmount - half))
  }, [effectiveAmount, splitPayment])

  const splitValid = splitPayment
    ? effectiveAmount === 0 || (cashNum + transferNum > 0 && Math.abs(cashNum + transferNum - effectiveAmount) <= 1)
    : !!method
  const weekError = effectiveWeekLabel?.startsWith('⚠️')
  const isValid = !!serviceId && effectiveAmount >= 0 && !!date && splitValid && !weekError

  async function handleSave() {
    setErr(null)
    if (!serviceId)                     { setErr('Seleccioná un servicio'); return }
    if (discountNum > resolvedAmount)   { setErr('El descuento no puede superar el precio del servicio'); return }
    if (resolvedAmount < 0)             { setErr('Ingresá un monto válido'); return }
    if (weekError)                      { setErr('La fecha no pertenece a ninguna semana registrada'); return }

    let paymentMethodFinal: PaymentMethod
    let cashAmt = 0
    let transferAmt = 0

    if (effectiveAmount === 0) {
      paymentMethodFinal = 'cash'
    } else if (splitPayment) {
      if (!splitValid) { setErr(`La suma (${formatARS(cashNum + transferNum)}) debe ser igual al total (${formatARS(effectiveAmount)})`); return }
      paymentMethodFinal = 'mixed'
      cashAmt = cashNum; transferAmt = transferNum
    } else {
      if (!method) { setErr('Seleccioná un método de pago'); return }
      paymentMethodFinal = method as PaymentMethod
      cashAmt     = method === 'cash'     ? effectiveAmount : 0
      transferAmt = method === 'transfer' ? effectiveAmount : 0
    }

    // Alquiler de box: el barbero se queda el 100%; la barbería no toma nada del corte.
    const isBox = tx.barber.compensation_type === 'box_rental'
    const barberShareFinal = isBox ? effectiveAmount : barberShareCalc
    const branchShareFinal = isBox ? 0 : branchShareCalc
    // box_rental ya tiene el 100%. Si recibe transferencias, retiene el TOTAL transferido;
    // efectivo/tarjeta o transfer-a-Valhalla → 0.
    const barberAlreadyCollected = isBox
      ? effectiveAmount
      : (tx.barber.receives_transfers ? transferAmt : 0)

    try {
      setSaving(true)
      await fullEditTransaction(tx.id, {
        transaction_date: date,
        week_id:          effectiveWeekId,
        service_id:       serviceId || null,
        amount:           effectiveAmount,
        discount_amount:  discountNum,
        discount_reason:  discountReason.trim() || null,
        payment_method:   paymentMethodFinal,
        cash_amount:      cashAmt,
        transfer_amount:  transferAmt,
        card_amount:      0,
        client_name:      clientName.trim() || null,
        client_surname:   clientSurname.trim() || null,
        barber_share:     barberShareFinal,
        branch_share:     branchShareFinal,
        barber_already_collected: barberAlreadyCollected,
        override_notes:   'Editado manualmente',
      })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  const barberName = (tx.barber as { full_name: string } | null)?.full_name ?? '—'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Editar corte · {barberName}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
            <div className="admin-loader" style={{ margin: '0 auto' }} />
          </div>
        ) : (
          <>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {err && <p className="form-error">{err}</p>}

              {/* Barbero (readonly) */}
              <div>
                <label className="form-label">Barbero</label>
                <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '0.5rem', padding: '0.55rem 0.75rem', color: '#a1a1aa', fontSize: '0.9rem' }}>{barberName}</div>
              </div>

              {/* Día (slider) */}
              <div>
                <label className="form-label">Día *</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <button type="button" onClick={slideLeft} style={{ flexShrink: 0, width: '1.6rem', height: '1.6rem', borderRadius: '50%', background: '#27272a', border: '1px solid #3f3f46', color: '#a1a1aa', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                  <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '1.25rem', zIndex: 1, background: 'linear-gradient(to right, #1a1a1a, transparent)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '1.25rem', zIndex: 1, background: 'linear-gradient(to left, #1a1a1a, transparent)', pointerEvents: 'none' }} />
                    <div ref={stripRef} style={{ display: 'flex', gap: '0.3rem', overflowX: 'auto', padding: '0.1rem 0 4px', scrollbarWidth: 'none' }}>
                      {scrollDays.map((d) => {
                        const isToday  = d.date === todayStr
                        const selected = d.date === date
                        return (
                          <button key={d.date} ref={selected ? dayRef : undefined} type="button" onClick={() => setDate(d.date)}
                            style={{ flex: '0 0 auto', width: '2.75rem', padding: '0.45rem 0.2rem', borderRadius: '0.5rem', textAlign: 'center', cursor: 'pointer', background: selected ? '#a78bfa' : '#18181b', border: `1px solid ${selected ? '#a78bfa' : isToday ? '#52525b' : '#27272a'}`, boxShadow: selected ? '0 0 0 2px rgba(167,139,250,0.35)' : 'none', transition: 'background 0.12s' }}
                          >
                            <div style={{ fontSize: '0.62rem', fontWeight: 600, color: selected ? '#2e006c' : '#71717a' }}>{d.label}</div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: selected ? '#0d0d0d' : '#e4e4e7' }}>{d.dayNum}</div>
                            <div style={{ fontSize: '0.58rem', color: selected ? '#2e006c' : isToday ? '#a78bfa' : '#3f3f46' }}>{isToday ? 'hoy' : d.month}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <button type="button" onClick={slideRight} style={{ flexShrink: 0, width: '1.6rem', height: '1.6rem', borderRadius: '50%', background: '#27272a', border: '1px solid #3f3f46', color: '#a1a1aa', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                </div>
                {effectiveWeekLabel && (
                  <p style={{ fontSize: '0.73rem', marginTop: '0.35rem', color: weekError ? '#f87171' : '#34d399' }}>
                    {weekError ? effectiveWeekLabel : `✓ Se moverá a: ${effectiveWeekLabel}`}
                  </p>
                )}
              </div>

              {/* Servicio (chips) */}
              <div>
                <label className="form-label">Servicio *</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
                  {services.map((s) => (
                    <EditSvcChip key={s.id} label={s.name} price={s.base_price} active={serviceId === s.id}
                      onClick={() => { setServiceId(s.id); setCustomAmt('') }} />
                  ))}
                </div>
              </div>

              {/* Monto */}
              <div>
                <label className="form-label">Monto cobrado</label>
                <CurrencyInput className="form-input"
                  placeholder={selectedService ? String(selectedService.base_price) : '0'}
                  value={customAmt} onChange={setCustomAmt} />
              </div>

              {/* Cliente */}
              <div>
                <label className="form-label">Cliente <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
                <TextInput className="form-input" placeholder="Nombre del cliente" value={clientName}
                  onChange={setClientName} maxLength={60} />
                <TextInput className="form-input" placeholder="Apellido del cliente" value={clientSurname}
                  onChange={setClientSurname} maxLength={60} style={{ marginTop: 8 }} />
              </div>

              {/* Descuento */}
              <div>
                <label className="form-label">Descuento <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '0.5rem' }}>
                  <CurrencyInput className="form-input" placeholder="$0"
                    value={discount} onChange={setDiscount} />
                  <input className="form-input" placeholder="Motivo del descuento" value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)} disabled={discountNum <= 0} maxLength={80} />
                </div>
                {discountNum > 0 && resolvedAmount > 0 && (
                  <p style={{ color: '#f59e0b', fontSize: '0.75rem', marginTop: '0.3rem' }}>
                    {formatARS(resolvedAmount)} − {formatARS(discountNum)} = <strong>{formatARS(effectiveAmount)}</strong>
                  </p>
                )}
              </div>

              {/* Método de pago */}
              <div>
                <label className="form-label">Método de pago *</label>
                {!splitPayment && (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <EditPayChip label="Efectivo"      active={method === 'cash'}     onClick={() => setMethod('cash')} />
                    <EditPayChip label="Transferencia" active={method === 'transfer'} onClick={() => setMethod('transfer')} />
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.6rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={splitPayment}
                    onChange={(e) => {
                      setSplitPayment(e.target.checked)
                      if (e.target.checked) {
                        setMethod('')
                        if (effectiveAmount > 0) { const h = Math.round(effectiveAmount / 2); setCashPart(String(h)); setTransferPart(String(effectiveAmount - h)) }
                      } else { setCashPart(''); setTransferPart('') }
                    }}
                    style={{ width: '1rem', height: '1rem', accentColor: '#a78bfa' }} />
                  <span style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Pago mixto (efectivo + transferencia)</span>
                </label>
                {splitPayment && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <div>
                      <p style={{ fontSize: '0.72rem', color: '#71717a', marginBottom: '0.25rem' }}>Efectivo $</p>
                      <CurrencyInput className="form-input" placeholder="0" value={cashPart}
                        onChange={(v) => { setCashPart(v); const r = effectiveAmount - (parseFloat(v) || 0); if (r >= 0) setTransferPart(String(Math.round(r))) }} />
                    </div>
                    <div>
                      <p style={{ fontSize: '0.72rem', color: '#71717a', marginBottom: '0.25rem' }}>Transferencia $</p>
                      <CurrencyInput className="form-input" placeholder="0" value={transferPart}
                        onChange={(v) => { setTransferPart(v); const r = effectiveAmount - (parseFloat(v) || 0); if (r >= 0) setCashPart(String(Math.round(r))) }} />
                    </div>
                    {(cashNum + transferNum) > 0 && (
                      <p style={{ gridColumn: '1/-1', fontSize: '0.75rem', textAlign: 'right', color: Math.abs(cashNum + transferNum - effectiveAmount) <= 1 ? '#34d399' : '#f87171' }}>
                        Suma: {formatARS(cashNum + transferNum)} · Total: {formatARS(effectiveAmount)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Preview */}
              {isValid && (
                <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '0.5rem', padding: '0.65rem 0.85rem', fontSize: '0.84rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#a1a1aa' }}>Total a cobrar</span>
                    <strong style={{ color: '#fff' }}>{formatARS(effectiveAmount)}</strong>
                  </div>
                  {splitPayment && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#71717a' }}>
                      <span>Ef {formatARS(cashNum)} + Transf {formatARS(transferNum)}</span>
                    </div>
                  )}
                  {discountNum > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', fontSize: '0.75rem' }}>
                      <span>Descuento (50/50)</span><span>−{formatARS(discountNum)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem' }}>
                    <span style={{ color: '#a1a1aa' }}>Parte barbero ({Math.round(commissionRate * 100)}%)</span>
                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>{formatARS(barberShareCalc)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#a1a1aa' }}>Parte barbería</span>
                    <span style={{ color: '#fff' }}>{formatARS(branchShareCalc)}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={onClose} className="admin-btn admin-btn--ghost">Cancelar</button>
              <button onClick={handleSave} disabled={saving || !isValid} className="admin-btn admin-btn--primary">
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function OverrideSplitModal({
  tx,
  onClose,
  onSaved,
}: {
  tx: TransactionWithRelations
  onClose: () => void
  onSaved: () => void
}) {
  const [branchShare, setBranchShare] = useState(String(tx.branch_share))
  const [barberShare, setBarberShare] = useState(String(tx.barber_share))
  const [alreadyCollected, setAlreadyCollected] = useState(String(tx.barber_already_collected))
  const [notes, setNotes] = useState(tx.override_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const total = tx.amount
  const bShop = parseFloat(branchShare) || 0
  const bBarber = parseFloat(barberShare) || 0
  const splitOk = Math.abs(bShop + bBarber - total) < 0.01

  async function handleSave() {
    if (!splitOk) { setErr('La suma del split debe ser igual al total del corte.'); return }
    if (!notes.trim()) { setErr('Agregá una nota explicando el cambio.'); return }
    try {
      setSaving(true)
      await overrideTransactionSplit(
        tx.id,
        bShop,
        bBarber,
        parseFloat(alreadyCollected) || 0,
        notes.trim()
      )
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  function formatARS(n: number) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Editar split · {tx.barber.full_name}</h3>
          <button onClick={onClose} className="modal-close">✕</button>
        </div>
        <div className="modal-body">
          <p className="form-label" style={{ marginBottom: 12 }}>
            Total del corte: <strong>{formatARS(total)}</strong>
            {tx.service && <span style={{ color: '#a1a1aa' }}> · {tx.service.name}</span>}
          </p>
          {err && <p className="form-error">{err}</p>}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Parte barbería</label>
              <CurrencyInput
                className="form-input"
                value={branchShare}
                onChange={setBranchShare}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Parte barbero</label>
              <CurrencyInput
                className="form-input"
                value={barberShare}
                onChange={setBarberShare}
              />
            </div>
          </div>
          {!splitOk && bShop + bBarber > 0 && (
            <p className="form-error">Suma actual: {formatARS(bShop + bBarber)} · Diferencia: {formatARS(bShop + bBarber - total)}</p>
          )}
          <label className="form-label">Ya cobrado por barbero</label>
          <CurrencyInput
            className="form-input"
            value={alreadyCollected}
            onChange={setAlreadyCollected}
          />
          <label className="form-label">Motivo del ajuste *</label>
          <textarea
            className="form-input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Descuento acordado con el cliente"
          />
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="admin-btn admin-btn--ghost">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !splitOk} className="admin-btn admin-btn--primary">
            {saving ? 'Guardando...' : 'Guardar cambio'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── LiveDashboard ────────────────────────────────────────────────────────
function LiveDashboard({
  transactions,
  weekNumber,
}: {
  transactions: TransactionWithRelations[]
  weekNumber: number
}) {
  const today = todayLocal()

  // Agrupar por barbero
  const byBarber = transactions.reduce<Record<string, {
    name: string
    todayCuts: number
    todayAmount: number
    weekCuts: number
    weekAmount: number
    weekBarberShare: number
  }>>((acc, tx) => {
    const bid = tx.barber_id
    const name = (tx.barber as { full_name: string } | null)?.full_name ?? bid
    if (!acc[bid]) acc[bid] = { name, todayCuts: 0, todayAmount: 0, weekCuts: 0, weekAmount: 0, weekBarberShare: 0 }
    acc[bid].weekCuts++
    acc[bid].weekAmount += tx.amount
    acc[bid].weekBarberShare += tx.barber_share
    if (tx.transaction_date === today) {
      acc[bid].todayCuts++
      acc[bid].todayAmount += tx.amount
    }
    return acc
  }, {})

  const rows = Object.values(byBarber).sort((a, b) => b.weekAmount - a.weekAmount)

  const totalToday = transactions.filter((t) => t.transaction_date === today).reduce((s, t) => s + t.amount, 0)
  const totalTodayCuts = transactions.filter((t) => t.transaction_date === today).length
  const totalWeek = transactions.reduce((s, t) => s + t.amount, 0)
  const totalWeekCuts = transactions.length

  return (
    <div className="space-y-5">
      {/* KPIs globales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mx-5 mt-5">
        {[
          { label: 'Hoy — cortes', value: String(totalTodayCuts) },
          { label: 'Hoy — facturado', value: formatARS(totalToday) },
          { label: `Semana ${weekNumber} — cortes`, value: String(totalWeekCuts) },
          { label: `Semana ${weekNumber} — facturado`, value: formatARS(totalWeek) },
        ].map((k) => (
          <div key={k.label} className="admin-kpi-card">
            <p className="admin-kpi-label">{k.label}</p>
            <p className="admin-kpi-value">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tabla por barbero */}
      {rows.length === 0 ? (
        <EmptyState message="Sin cortes registrados todavía en esta semana." />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Barbero</th>
                <th>Cortes hoy</th>
                <th>Facturado hoy</th>
                <th>Cortes semana</th>
                <th>Facturado semana</th>
                <th className="th-highlight">Comisión semana</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="font-semibold">{r.name}</td>
                  <td>{r.todayCuts}</td>
                  <td>{formatARS(r.todayAmount)}</td>
                  <td>{r.weekCuts}</td>
                  <td>{formatARS(r.weekAmount)}</td>
                  <td className="td-highlight">{formatARS(r.weekBarberShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-500 text-right mx-5 mb-5">
        Actualización automática · {transactions.length} transacciones cargadas
      </p>
    </div>
  )
}
