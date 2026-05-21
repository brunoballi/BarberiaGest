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
  type Expense,
  type ExpenseInsert,
  PAYMENT_METHOD_LABELS,
  WEEK_STATUS_LABELS,
  SETTLEMENT_STATUS_LABELS,
  EXPENSE_CATEGORIES,
} from '@/lib/supabase/database.types'
import {
  getBranches,
  getMyBranches,
  getMonthsWithWeeks,
  yearHasMonths,
  MONTH_NAMES,
  getBarbersByBranch,
  getSettlementsForWeek,
  getWeekTransactions,
  getAdvancesByDateRange,
  getExpensesByWeek,
  closeWeek,
  calculateAllSettlementsForWeek,
  setPresentismo,
  confirmSettlement,
  markSettlementPaid,
  createExpense,
  overrideTransactionSplit,
  getCurrentProfile,
  todayLocal,
  supabase,
} from '@/lib/supabase/supabase.client'
import './admin-dashboard.css'

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
type Tab = 'live' | 'liquidaciones' | 'transacciones' | 'gastos'
const TAB_LABELS: Record<Tab, string> = {
  live: '🔴 En vivo',
  liquidaciones: 'Liquidaciones',
  transacciones: 'Transacciones',
  gastos: 'Gastos',
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string>('')

  // Semanas del mes seleccionado (derivado)
  const weeks: Week[] = months[selectedMonthIdx]?.weeks ?? []

  const [settlements, setSettlements] = useState<SettlementWithBarber[]>([])
  const [transactions, setTransactions] = useState<TransactionWithRelations[]>([])
  const [weekAdvances, setWeekAdvances] = useState<AdvanceWithBarber[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [overrideTx, setOverrideTx] = useState<TransactionWithRelations | null>(null)

  // Live view
  const [liveTransactions, setLiveTransactions] = useState<TransactionWithRelations[]>([])

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
  const [filterDate, setFilterDate] = useState('')
  const [filterBarber, setFilterBarber] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [filterService, setFilterService] = useState('')

  // ─── Carga inicial ─────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const [profile, branchList] = await Promise.all([
          getCurrentProfile(),
          getMyBranches(),
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
        // Apuntar al mes que tiene semana abierta, o el último mes
        const openIdx = ms.findIndex((m) => m.weeks.some((w) => w.status === 'open'))
        const idx = openIdx >= 0 ? openIdx : Math.max(0, ms.length - 1)
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

  async function handleMarkPaid(settlementId: string) {
    try {
      setActionLoading(`paid-${settlementId}`)
      await markSettlementPaid(settlementId)
      await loadTabData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error marcando como pagado')
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
    transferTotal: settlements.reduce((s, x) => s + x.transfer_amount, 0),
    cardTotal: settlements.reduce((s, x) => s + x.card_amount, 0),
    expensesTotal: expenses.reduce((s, x) => s + x.amount, 0),
  }

  // ─── RENDER ────────────────────────────────────────────────────────
  if (loading) return <AdminLoadingScreen />
  if (error) return <AdminErrorScreen message={error} onRetry={() => setError(null)} />

  return (
    <div className="admin-app">
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
            <Link href="/admin/reportes" className="admin-btn admin-btn--ghost">Reportes</Link>

            {/* Dropdown Configuración */}
            <button
              ref={configBtnRef}
              onClick={openConfigMenu}
              className={`admin-btn admin-btn--ghost admin-dropdown-trigger${showConfigMenu ? ' admin-btn--active' : ''}`}
            >
              Configuración
              <span className="admin-dropdown-arrow">{showConfigMenu ? '▴' : '▾'}</span>
            </button>
            {showConfigMenu && (
              <div
                ref={configMenuRef}
                className="admin-dropdown-menu"
                style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
              >
                <Link href="/admin/configuracion" onClick={() => setShowConfigMenu(false)} className="admin-dropdown-item">
                  Calendario
                </Link>
                <Link href="/admin/barberos" onClick={() => setShowConfigMenu(false)} className="admin-dropdown-item">
                  Barberos
                </Link>
                <Link href="/admin/servicios" onClick={() => setShowConfigMenu(false)} className="admin-dropdown-item">
                  Servicios
                </Link>
                <Link href="/admin/auditoria" onClick={() => setShowConfigMenu(false)} className="admin-dropdown-item">
                  Auditoría
                </Link>
              </div>
            )}


            <Link href="/admin/adelantos" className="admin-btn admin-btn--ghost">Adelantos</Link>
            <button onClick={handleLogout} className="admin-btn admin-btn--ghost">Salir</button>
          </div>
        </header>

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

      {/* ── TABS ── */}
      <div className="admin-tabs">
        {((['live', 'liquidaciones', 'transacciones', 'gastos'] as Tab[])
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

      {/* ── CONTENT ── */}
      <main className="admin-content">

        {/* ─── TAB: LIVE ─── */}
        {tab === 'live' && selectedWeek && (
          <LiveDashboard transactions={liveTransactions} weekNumber={weeks.length - weeks.findIndex((w) => w.id === selectedWeek.id)} />
        )}

        {/* ─── TAB: LIQUIDACIONES ─── */}
        {tab === 'liquidaciones' && (
          <div>
          {selectedWeek && (
            <div className="kpi-strip">
              <KpiCard label="Facturado bruto" value={formatARS(kpis.grossTotal)} sub={`${kpis.totalCuts} cortes`} />
              <KpiCard label="Para la barbería" value={formatARS(kpis.branchTotal)} accent="positive" />
              <KpiCard label="A pagar barberos" value={formatARS(kpis.totalPayable)} accent="warning" />
              <KpiCard label="Efectivo" value={formatARS(kpis.cashTotal)} sub="en caja" />
              <KpiCard label="Transferencias" value={formatARS(kpis.transferTotal)} />
              <KpiCard label="Tarjetas" value={formatARS(kpis.cardTotal)} />
              <KpiCard label="Gastos semana" value={formatARS(kpis.expensesTotal)} accent="negative" />
            </div>
          )}
          <div className="admin-table-wrap">
            {settlements.length === 0 ? (
              <EmptyState message="No hay liquidaciones para esta semana. Cerrá la semana para generarlas." />
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
                    <th>Total ganado</th>
                    <th>Ya cobrado</th>
                    <th>Adelantos</th>
                    <th className="th-highlight">A pagar</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => {
                    const isSalary = s.barber.compensation_type === 'salary'
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
                          {isSalary ? (
                            <button
                              onClick={() => handlePresentismo(s.id, s.week_id, s.barber_id, s.presentismo_met ?? false)}
                              disabled={loadingKey === `presentismo-${s.id}`}
                              className={`toggle-btn ${s.presentismo_met ? 'toggle-btn--on' : 'toggle-btn--off'}`}
                            >
                              {s.presentismo_met ? 'Sí' : 'No'} · {formatARS(s.bonus_presentismo)}
                            </button>
                          ) : (
                            <span className="td-na">—</span>
                          )}
                        </td>
                        <td>
                          {isSalary ? (
                            <span className={`badge ${s.objetivo_met ? 'badge--green' : 'badge--red'}`}>
                              {s.objetivo_met ? `Sí · ${formatARS(s.bonus_objetivo)}` : 'No'}
                            </span>
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
                          {s.advances_deducted > 0
                            ? <span className="td-advance">{formatARS(s.advances_deducted)}</span>
                            : '—'}
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
                                onClick={() => handleConfirmSettlement(s.id)}
                                disabled={loadingKey === `confirm-${s.id}`}
                                className="action-btn action-btn--confirm"
                              >
                                Confirmar
                              </button>
                            )}
                            {s.status === 'confirmed' && (
                              <button
                                onClick={() => handleMarkPaid(s.id)}
                                disabled={loadingKey === `paid-${s.id}`}
                                className="action-btn action-btn--pay"
                              >
                                Marcar pagado
                              </button>
                            )}
                            {s.status === 'paid' && (
                              <span className="action-done">✓ Pagado</span>
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
                    <td><strong>{formatARS(kpis.grossTotal)}</strong></td>
                    <td colSpan={4}></td>
                    <td><strong>{formatARS(settlements.reduce((s, x) => s + x.already_collected, 0))}</strong></td>
                    <td><strong>{formatARS(settlements.reduce((s, x) => s + x.advances_deducted, 0))}</strong></td>
                    <td><strong className="net-payable--pos">{formatARS(kpis.totalPayable)}</strong></td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          </div>
        )}

        {/* ─── TAB: TRANSACCIONES ─── */}
        {tab === 'transacciones' && (() => {
          // Opciones únicas para los selects
          const barberOptions = Array.from(new Map(transactions.map((t) => [t.barber_id, t.barber.full_name])))
          const serviceOptions = Array.from(new Set(transactions.map((t) => t.service?.name).filter(Boolean))) as string[]
          const hasFilters = filterDate || filterBarber || filterMethod || filterService
          const filtered = transactions.filter((tx) => {
            if (filterDate && tx.transaction_date !== filterDate) return false
            if (filterBarber && tx.barber_id !== filterBarber) return false
            if (filterMethod && tx.payment_method !== filterMethod) return false
            if (filterService && (tx.service?.name ?? '') !== filterService) return false
            return true
          })
          return (
          <div>
            {/* Barra de filtros */}
            <div className="filter-bar">
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="filter-input"
                title="Filtrar por fecha"
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
                <option value="card">Tarjeta</option>
              </select>
              <select value={filterService} onChange={(e) => setFilterService(e.target.value)} className="filter-input">
                <option value="">Todos los servicios</option>
                {serviceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {hasFilters && (
                <button onClick={() => { setFilterDate(''); setFilterBarber(''); setFilterMethod(''); setFilterService('') }}
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
                    <th>Fecha</th>
                    <th>Barbero</th>
                    <th>Servicio</th>
                    <th>Método</th>
                    <th>Total</th>
                    <th>Barbería</th>
                    <th>Barbero</th>
                    <th>Ya cobrado</th>
                    <th>Override</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx) => (
                    <tr key={tx.id} className={tx.is_manual_override ? 'tr-override' : ''}>
                      <td className="td-date">{formatDate(tx.transaction_date)}</td>
                      <td>{tx.barber.full_name}</td>
                      <td>{tx.service?.name ?? '—'}</td>
                      <td>
                        <span className={`dot-badge dot-badge--${tx.payment_method}`}>
                          {PAYMENT_METHOD_LABELS[tx.payment_method]}
                        </span>
                      </td>
                      <td className="td-bold">{formatARS(tx.amount)}</td>
                      <td>{formatARS(tx.branch_share)}</td>
                      <td className="td-amber">{formatARS(tx.barber_share)}</td>
                      <td>
                        {tx.barber_already_collected > 0
                          ? <span className="td-collected">{formatARS(tx.barber_already_collected)}</span>
                          : '—'}
                      </td>
                      <td>
                        {tx.is_manual_override
                          ? <span className="badge badge--orange" title={tx.override_notes ?? ''}>Editado</span>
                          : '—'}
                      </td>
                      <td>
                        <button
                          onClick={() => setOverrideTx(tx)}
                          className="action-btn action-btn--confirm"
                        >
                          Editar split
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="tfoot-row">
                    <td colSpan={4}><strong>{filtered.length} transacción{filtered.length !== 1 ? 'es' : ''}</strong></td>
                    <td><strong>{formatARS(filtered.reduce((s, t) => s + t.amount, 0))}</strong></td>
                    <td><strong>{formatARS(filtered.reduce((s, t) => s + t.branch_share, 0))}</strong></td>
                    <td><strong className="td-amber">{formatARS(filtered.reduce((s, t) => s + t.barber_share, 0))}</strong></td>
                    <td><strong>{formatARS(filtered.reduce((s, t) => s + t.barber_already_collected, 0))}</strong></td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            )}
            </div>{/* /admin-table-wrap */}

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
        {tab === 'gastos' && (
          <div className="admin-table-wrap">
            <div className="table-toolbar">
              <span className="toolbar-total">
                Total gastos: <strong>{formatARS(kpis.expensesTotal)}</strong>
              </span>
              <button
                onClick={() => setShowExpenseForm(true)}
                className="admin-btn admin-btn--primary"
              >
                + Registrar gasto
              </button>
            </div>
            {expenses.length === 0 ? (
              <EmptyState message="No hay gastos registrados en este período." />
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th>Categoría</th>
                    <th>Monto</th>
                    <th>Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td className="td-date">{formatDate(e.expense_date)}</td>
                      <td>{e.concept}</td>
                      <td>
                        <span className="badge badge--gray">{e.category ?? '—'}</span>
                      </td>
                      <td className="td-danger">{formatARS(e.amount)}</td>
                      <td className="td-muted">{e.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      </main>

      {/* ── MODALES ── */}
      {showExpenseForm && selectedWeek && (
        <ExpenseFormModal
          branchId={selectedBranch}
          weekId={selectedWeek.id}
          registeredBy={currentUserId}
          onClose={() => setShowExpenseForm(false)}
          onSaved={async () => {
            setShowExpenseForm(false)
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
}: {
  label: string
  value: string
  sub?: string
  accent?: 'positive' | 'negative' | 'warning'
}) {
  const colorMap = {
    positive: '#34d399',
    negative: '#f87171',
    warning: '#f59e0b',
  }
  const color = accent ? colorMap[accent] : 'inherit'
  return (
    <div className="kpi-card">
      <p className="kpi-label">{label}</p>
      <p className="kpi-value" style={{ color }}>{value}</p>
      {sub && <p className="kpi-sub">{sub}</p>}
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

// ─── Modal: Nuevo gasto ────────────────────────────────────────────────────
function ExpenseFormModal({
  branchId,
  weekId,
  registeredBy,
  onClose,
  onSaved,
}: {
  branchId: string
  weekId: string
  registeredBy: string
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    concept: '',
    expense_date: todayLocal(),
    amount: '',
    category: '',
    notes: '',
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
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Registrar gasto</h3>
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
              <input
                type="number"
                className="form-input"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
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
              <option key={c} value={c}>{c}</option>
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
            {saving ? 'Guardando...' : 'Guardar gasto'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Editar split de transacción ───────────────────────────────────
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
    <div className="modal-overlay" onClick={onClose}>
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
              <input
                type="number"
                className="form-input"
                value={branchShare}
                onChange={(e) => setBranchShare(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Parte barbero</label>
              <input
                type="number"
                className="form-input"
                value={barberShare}
                onChange={(e) => setBarberShare(e.target.value)}
              />
            </div>
          </div>
          {!splitOk && bShop + bBarber > 0 && (
            <p className="form-error">Suma actual: {formatARS(bShop + bBarber)} · Diferencia: {formatARS(bShop + bBarber - total)}</p>
          )}
          <label className="form-label">Ya cobrado por barbero</label>
          <input
            type="number"
            className="form-input"
            value={alreadyCollected}
            onChange={(e) => setAlreadyCollected(e.target.value)}
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      <p className="text-xs text-zinc-500 text-right">
        Actualización automática · {transactions.length} transacciones cargadas
      </p>
    </div>
  )
}
