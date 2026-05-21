'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import '../admin-dashboard.css'
import {
  getMonthsWithWeeks,
  createMonth,
  createYear,
  closeMonth,
  reopenMonth,
  closeWeek,
  reopenWeek,
  updateWeekDates,
  createManualWeek,
  deleteWeekSafe,
  deleteMonthSafe,
  deleteYearSafe,
  getWeekTransactions,
  getSettlementsForWeek,
  getCurrentProfile,
  getMyBranches,
  MONTH_NAMES,
} from '@/lib/supabase/supabase.client'
import type {
  MonthWithWeeks,
  Month,
  Week,
  WeekStatus,
  TransactionWithRelations,
  SettlementWithBarber,
  PaymentMethod,
} from '@/lib/supabase/database.types'
import { PAYMENT_METHOD_LABELS, WEEK_STATUS_LABELS } from '@/lib/supabase/database.types'

// ============================================================
// HELPERS
// ============================================================
function formatARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
}

function getMonthDateRange(year: number, month: number): { firstDay: string; lastDay: string } {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDayDate = new Date(year, month, 0)
  const lastDay = `${year}-${String(month).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`
  return { firstDay, lastDay }
}

function clampDate(date: string, min: string, max: string): string {
  if (date < min) return min
  if (date > max) return max
  return date
}

function getWeekActiveRange(
  week: Week,
  year: number,
  month: number
): { activeFrom: string; activeTo: string; clampedStart: boolean; clampedEnd: boolean } {
  const { firstDay, lastDay } = getMonthDateRange(year, month)
  const activeFrom = clampDate(week.start_date, firstDay, lastDay)
  const activeTo = clampDate(week.end_date, firstDay, lastDay)
  return {
    activeFrom,
    activeTo,
    clampedStart: activeFrom !== week.start_date,
    clampedEnd: activeTo !== week.end_date,
  }
}

function previewWeeksForMonth(year: number, month: number): Array<{ start: string; end: string }> {
  const { firstDay, lastDay } = getMonthDateRange(year, month)
  const first = new Date(firstDay)
  const last = new Date(lastDay)
  const weeks: Array<{ start: string; end: string }> = []

  // Start from first Monday at or before first day
  let cursor = new Date(first)
  const dayOfWeek = cursor.getDay() // 0=Sun
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  cursor.setDate(cursor.getDate() - daysSinceMonday)

  while (cursor <= last) {
    const weekStart = new Date(cursor)
    const weekEnd = new Date(cursor)
    weekEnd.setDate(weekEnd.getDate() + 6)

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    weeks.push({ start: fmt(weekStart), end: fmt(weekEnd) })
    cursor.setDate(cursor.getDate() + 7)
  }

  return weeks
}

function weekStatusBadgeClass(status: WeekStatus): string {
  if (status === 'open') return 'badge badge--week-open'
  if (status === 'closed') return 'badge badge--week-closed'
  return 'badge badge--week-paid'
}

function monthSummary(
  weeks: Week[]
): { totalCuts: number; totalAmount: number } {
  // Without settlement data at list level, we show week count only
  // Cuts/amount would require loading all transactions – skip for list view
  return { totalCuts: 0, totalAmount: 0 }
}

// ============================================================
// TYPES
// ============================================================
interface WeekDetailData {
  transactions: TransactionWithRelations[]
  settlements: SettlementWithBarber[]
}

interface BarberRow {
  barberId: string
  barberName: string
  cuts: number
  billed: number
  commission: number
  toCollect: number
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function ConfiguracionView() {
  const currentYear = new Date().getFullYear()

  // State
  const [months, setMonths] = useState<MonthWithWeeks[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([currentYear]))
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [showNewMonthModal, setShowNewMonthModal] = useState(false)
  const [showNewYearModal, setShowNewYearModal] = useState(false)
  const [showManualWeekModal, setShowManualWeekModal] = useState(false)
  const [editingWeek, setEditingWeek] = useState<Week | null>(null)
  const [detailWeek, setDetailWeek] = useState<Week | null>(null)
  const [detailWeekMonth, setDetailWeekMonth] = useState<Month | null>(null)
  const [detailData, setDetailData] = useState<WeekDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [branchId, setBranchId] = useState<string | null>(null)

  // Load data
  const loadMonths = useCallback(async (bid: string) => {
    try {
      setLoading(true)
      setError(null)
      const data = await getMonthsWithWeeks(bid)
      setMonths(data)
      // Auto-expand current month
      const now = new Date()
      const current = data.find(
        (m) => m.year === now.getFullYear() && m.month === now.getMonth() + 1
      )
      if (current) {
        setExpandedMonths((prev) => new Set([...prev, current.id]))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando meses')
    } finally {
      setLoading(false)
    }
  }, [])

  const router = useRouter()

  useEffect(() => {
    async function init() {
      const [profile, myBranches] = await Promise.all([getCurrentProfile(), getMyBranches()])
      if (!profile) return
      if (myBranches.length === 0) {
        setError('No tenés sucursales asignadas.')
        setLoading(false)
        return
      }
      setCurrentUserId(profile.id)

      // Validar sucursal almacenada contra las sucursales asignadas
      const stored = getStoredBranch()
      const bid = stored && myBranches.some((b) => b.id === stored) ? stored : null
      if (!bid) { router.replace('/admin/select-branch'); return }

      setBranchId(bid)
      loadMonths(bid)
    }
    init()
  }, [loadMonths, router])

  // Group months by year
  const byYear = months.reduce<Map<number, MonthWithWeeks[]>>((acc, m) => {
    const arr = acc.get(m.year) ?? []
    arr.push(m)
    acc.set(m.year, arr)
    return acc
  }, new Map())

  const sortedYears = [...byYear.keys()].sort((a, b) => b - a)

  // Toggle handlers
  function toggleYear(year: number) {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  function toggleMonth(monthId: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(monthId)) next.delete(monthId)
      else next.add(monthId)
      return next
    })
  }

  // Close week
  async function handleCloseWeek(week: Week) {
    if (!currentUserId) return
    if (!confirm(`¿Cerrar Semana ${week.week_number} (${formatDate(week.start_date)} – ${formatDate(week.end_date)})?`))
      return
    try {
      await closeWeek(week.id, currentUserId)
      if (branchId) await loadMonths(branchId)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error cerrando semana')
    }
  }

  // Delete week
  async function handleDeleteWeek(week: Week) {
    if (!confirm(`¿Eliminar Semana ${week.week_number} (${formatDate(week.start_date)} – ${formatDate(week.end_date)})? Esta acción no se puede deshacer.`)) return
    try {
      const res = await deleteWeekSafe(week.id)
      if (!res.deleted) {
        alert(`No se puede eliminar: ${res.reason}\n• ${res.transactions ?? 0} transacciones\n• ${res.settlements ?? 0} liquidaciones\n• ${res.expenses ?? 0} gastos\n• ${res.advances ?? 0} adelantos`)
        return
      }
      if (branchId) await loadMonths(branchId)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error eliminando semana')
    }
  }

  // Delete month
  async function handleDeleteMonth(m: MonthWithWeeks) {
    if (!confirm(`¿Eliminar ${MONTH_NAMES[m.month - 1]} ${m.year} y sus ${m.weeks.length} semanas? No se puede deshacer.`)) return
    try {
      const res = await deleteMonthSafe(m.id)
      if (!res.deleted) {
        alert(`No se puede eliminar: ${res.reason}\n• ${res.transactions ?? 0} transacciones\n• ${res.settlements ?? 0} liquidaciones\n• ${res.expenses ?? 0} gastos\n• ${res.advances ?? 0} adelantos`)
        return
      }
      if (branchId) await loadMonths(branchId)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error eliminando mes')
    }
  }

  // Delete year
  async function handleDeleteYear(year: number) {
    if (!branchId) return
    if (!confirm(`¿Eliminar TODO el año ${year} (12 meses + ~52 semanas)? Esta acción no se puede deshacer.`)) return
    try {
      const res = await deleteYearSafe(branchId, year)
      if (!res.deleted) {
        alert(`No se puede eliminar: ${res.reason}\n• ${res.transactions ?? 0} transacciones\n• ${res.settlements ?? 0} liquidaciones\n• ${res.expenses ?? 0} gastos\n• ${res.advances ?? 0} adelantos`)
        return
      }
      await loadMonths(branchId)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error eliminando año')
    }
  }

  // Reopen week
  async function handleReopenWeek(week: Week) {
    if (!confirm(`¿Reabrir Semana ${week.week_number}? Volverá a estado abierto y se podrán cargar más transacciones.`))
      return
    try {
      await reopenWeek(week.id)
      if (branchId) await loadMonths(branchId)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error reabriendo semana')
    }
  }

  // Close month
  async function handleCloseMonth(month: MonthWithWeeks) {
    if (!confirm(`¿Cerrar ${MONTH_NAMES[month.month - 1]} ${month.year}?`)) return
    try {
      await closeMonth(month.id)
      if (branchId) await loadMonths(branchId)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error cerrando mes')
    }
  }

  // Reopen month
  async function handleReopenMonth(month: MonthWithWeeks) {
    if (!confirm(`¿Reabrir ${MONTH_NAMES[month.month - 1]} ${month.year}? El mes volverá a estado activo.`))
      return
    try {
      await reopenMonth(month.id)
      if (branchId) await loadMonths(branchId)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error reabriendo mes')
    }
  }

  // Open week detail modal
  async function handleViewDetail(week: Week, month: Month) {
    setDetailWeek(week)
    setDetailWeekMonth(month)
    setDetailData(null)
    setDetailLoading(true)
    try {
      const [transactions, settlements] = await Promise.all([
        getWeekTransactions(week.id),
        getSettlementsForWeek(week.id),
      ])
      setDetailData({ transactions, settlements })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error cargando detalle')
    } finally {
      setDetailLoading(false)
    }
  }

  function closeDetail() {
    setDetailWeek(null)
    setDetailWeekMonth(null)
    setDetailData(null)
  }

  if (loading) {
    return (
      <div className="admin-app flex-center" style={{ minHeight: '60vh' }}>
        <div className="admin-loader" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="admin-app flex-center" style={{ minHeight: '60vh' }}>
        <div className="error-box">
          <p className="error-msg">{error}</p>
          <button
            className="admin-btn admin-btn--ghost"
            onClick={() => branchId && loadMonths(branchId)}
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-app">
      <div style={{ maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #2d2d2d',
          background: '#141414',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#e5e5e5', margin: 0 }}>
            Configuración
          </h1>
          <p style={{ fontSize: '0.8125rem', color: '#71717a', margin: '0.25rem 0 0' }}>
            Meses y Semanas
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="admin-btn admin-btn--ghost"
            onClick={() => setShowManualWeekModal(true)}
            title="Crear una semana suelta con fechas arbitrarias"
          >
            + Semana manual
          </button>
          <button
            className="admin-btn admin-btn--ghost"
            onClick={() => setShowNewMonthModal(true)}
            title="Crear solo un mes (uso avanzado)"
          >
            + Nuevo mes
          </button>
          <button
            className="admin-btn admin-btn--primary"
            onClick={() => setShowNewYearModal(true)}
          >
            + Crear año
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '1.25rem 1.5rem' }}>
        {sortedYears.length === 0 && (

          <div className="empty-state">
            <p>No hay meses creados aún.</p>
            <p style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
              Creá el primer mes con el botón "Nuevo mes".
            </p>
          </div>
        )}

        {sortedYears.map((year) => {
          const yearExpanded = expandedYears.has(year)
          const yearMonths = byYear.get(year) ?? []

          return (
            <div key={year} style={{ marginBottom: '1rem' }}>
              {/* Year row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  onClick={() => toggleYear(year)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#a1a1aa',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    padding: '0.5rem 0',
                    flex: 1,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ color: '#52525b' }}>{yearExpanded ? '▼' : '▶'}</span>
                  {year}
                </button>
                <button
                  className="action-btn"
                  style={{ background: 'rgba(239,68,68,0.10)', color: '#f87171', fontSize: '0.7rem', padding: '0.25rem 0.6rem' }}
                  onClick={() => handleDeleteYear(year)}
                  title="Eliminar todo el año (solo si no tiene datos)"
                >
                  🗑 Eliminar año
                </button>
              </div>

              {yearExpanded && (
                <div style={{ paddingLeft: '1rem' }}>
                  {yearMonths.map((m) => (
                    <MonthRow
                      key={m.id}
                      month={m}
                      expanded={expandedMonths.has(m.id)}
                      onToggle={() => toggleMonth(m.id)}
                      onCloseMonth={() => handleCloseMonth(m)}
                      onReopenMonth={() => handleReopenMonth(m)}
                      onDeleteMonth={() => handleDeleteMonth(m)}
                      onCloseWeek={handleCloseWeek}
                      onReopenWeek={handleReopenWeek}
                      onDeleteWeek={handleDeleteWeek}
                      onEditWeek={(w) => setEditingWeek(w)}
                      onViewDetail={handleViewDetail}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* New Month Modal */}
      {showNewMonthModal && branchId && (
        <NewMonthModal
          branchId={branchId}
          onClose={() => setShowNewMonthModal(false)}
          onCreated={() => {
            setShowNewMonthModal(false)
            if (branchId) loadMonths(branchId)
          }}
        />
      )}

      {/* Week Detail Modal */}
      {detailWeek && detailWeekMonth && (
        <WeekDetailModal
          week={detailWeek}
          month={detailWeekMonth}
          data={detailData}
          loading={detailLoading}
          onClose={closeDetail}
        />
      )}

      {/* New Year Modal */}
      {showNewYearModal && branchId && (
        <NewYearModal
          branchId={branchId}
          onClose={() => setShowNewYearModal(false)}
          onCreated={() => {
            setShowNewYearModal(false)
            if (branchId) loadMonths(branchId)
          }}
        />
      )}

      {/* Manual Week Modal */}
      {showManualWeekModal && branchId && (
        <ManualWeekModal
          branchId={branchId}
          onClose={() => setShowManualWeekModal(false)}
          onCreated={() => {
            setShowManualWeekModal(false)
            if (branchId) loadMonths(branchId)
          }}
        />
      )}

      {/* Edit Week Modal */}
      {editingWeek && (
        <EditWeekModal
          week={editingWeek}
          onClose={() => setEditingWeek(null)}
          onSaved={() => {
            setEditingWeek(null)
            if (branchId) loadMonths(branchId)
          }}
        />
      )}
      </div>{/* end max-width wrapper */}
    </div>
  )
}

// ============================================================
// MONTH ROW
// ============================================================
interface MonthRowProps {
  month: MonthWithWeeks
  expanded: boolean
  onToggle: () => void
  onCloseMonth: () => void
  onReopenMonth: () => void
  onDeleteMonth: () => void
  onCloseWeek: (week: Week) => void
  onReopenWeek: (week: Week) => void
  onDeleteWeek: (week: Week) => void
  onEditWeek: (week: Week) => void
  onViewDetail: (week: Week, month: Month) => void
}

function MonthRow({
  month,
  expanded,
  onToggle,
  onCloseMonth,
  onReopenMonth,
  onDeleteMonth,
  onCloseWeek,
  onReopenWeek,
  onDeleteWeek,
  onEditWeek,
  onViewDetail,
}: MonthRowProps) {
  const name = MONTH_NAMES[month.month - 1]
  const weekCount = month.weeks.length
  const isActive = month.status === 'active'

  return (
    <div
      style={{
        marginBottom: '0.75rem',
        background: '#1a1a1a',
        border: '1px solid #2d2d2d',
        borderRadius: '0.5rem',
        overflow: 'hidden',
      }}
    >
      {/* Month header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1rem',
          cursor: 'pointer',
          gap: '0.75rem',
        }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flex: 1 }}>
          <span style={{ color: '#52525b', fontSize: '0.75rem' }}>{expanded ? '▼' : '▶'}</span>
          <span style={{ fontWeight: 600, color: '#e5e5e5' }}>
            {name} {month.year}
          </span>
          <span
            className={`badge ${isActive ? 'badge--green' : 'badge--gray'}`}
            style={{ marginLeft: '0.25rem' }}
          >
            {isActive ? 'activo' : 'cerrado'}
          </span>
          <span style={{ color: '#71717a', fontSize: '0.8125rem', marginLeft: '0.5rem' }}>
            {weekCount} {weekCount === 1 ? 'semana' : 'semanas'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
          {isActive ? (
            <button
              className="admin-btn admin-btn--danger"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
              onClick={onCloseMonth}
            >
              Cerrar mes
            </button>
          ) : (
            <button
              className="admin-btn admin-btn--ghost"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderColor: '#f59e0b', color: '#f59e0b' }}
              onClick={onReopenMonth}
            >
              ↩ Reabrir mes
            </button>
          )}
          <button
            className="admin-btn admin-btn--ghost"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
            onClick={onDeleteMonth}
            title="Eliminar mes (solo si no tiene datos)"
          >
            🗑
          </button>
        </div>
      </div>

      {/* Weeks */}
      {expanded && (
        <div style={{ borderTop: '1px solid #2d2d2d' }}>
          {month.weeks.length === 0 && (
            <p
              style={{ padding: '1rem', color: '#52525b', fontSize: '0.8125rem', margin: 0 }}
            >
              Sin semanas asociadas a este mes.
            </p>
          )}
          {month.weeks.map((week) => (
            <WeekRow
              key={week.id}
              week={week}
              month={month}
              onCloseWeek={onCloseWeek}
              onReopenWeek={onReopenWeek}
              onDeleteWeek={onDeleteWeek}
              onEditWeek={onEditWeek}
              onViewDetail={onViewDetail}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// WEEK ROW
// ============================================================
interface WeekRowProps {
  week: Week
  month: MonthWithWeeks
  onCloseWeek: (week: Week) => void
  onReopenWeek: (week: Week) => void
  onDeleteWeek: (week: Week) => void
  onEditWeek: (week: Week) => void
  onViewDetail: (week: Week, month: Month) => void
}

function WeekRow({ week, month, onCloseWeek, onReopenWeek, onDeleteWeek, onEditWeek, onViewDetail }: WeekRowProps) {
  const { activeFrom, activeTo, clampedStart, clampedEnd } = getWeekActiveRange(
    week,
    month.year,
    month.month
  )
  const isOpen = week.status === 'open'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        padding: '0.625rem 1rem 0.625rem 1.5rem',
        borderBottom: '1px solid #1f1f1f',
        gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, flexWrap: 'wrap' }}>
        <span style={{ color: '#71717a', fontSize: '0.8125rem', minWidth: '4.5rem' }}>
          Semana {week.week_number}
        </span>
        <span style={{ fontSize: '0.8125rem' }}>
          <span style={{ color: clampedStart ? '#52525b' : '#a1a1aa' }}>
            Lun {formatDate(activeFrom)}
          </span>
          <span style={{ color: '#3f3f46', margin: '0 0.375rem' }}>–</span>
          <span style={{ color: clampedEnd ? '#52525b' : '#a1a1aa' }}>
            Dom {formatDate(activeTo)}
          </span>
        </span>
        <span className={weekStatusBadgeClass(week.status)}>
          {WEEK_STATUS_LABELS[week.status]}
        </span>
      </div>

      <div className="action-group">
        {isOpen && (
          <button
            className="action-btn action-btn--confirm"
            onClick={() => onCloseWeek(week)}
          >
            Cerrar
          </button>
        )}
        {!isOpen && (
          <button
            className="action-btn"
            style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
            onClick={() => onReopenWeek(week)}
          >
            ↩ Reabrir
          </button>
        )}
        <button
          className="action-btn"
          style={{ background: 'rgba(161,161,170,0.12)', color: '#d4d4d8' }}
          onClick={() => onEditWeek(week)}
          title="Editar fechas manualmente"
        >
          ✎ Editar
        </button>
        <button
          className="action-btn"
          style={{ background: 'rgba(239,68,68,0.10)', color: '#f87171' }}
          onClick={() => onDeleteWeek(week)}
          title="Eliminar semana (solo si no tiene datos)"
        >
          🗑
        </button>
        <button
          className="action-btn action-btn--pay"
          style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8' }}
          onClick={() => onViewDetail(week, month)}
        >
          Ver detalle
        </button>
      </div>
    </div>
  )
}

// ============================================================
// NEW MONTH MODAL
// ============================================================
interface NewMonthModalProps {
  branchId: string
  onClose: () => void
  onCreated: () => void
}

function NewMonthModal({ branchId, onClose, onCreated }: NewMonthModalProps) {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const preview = previewWeeksForMonth(selectedYear, selectedMonth)

  async function handleCreate() {
    setCreating(true)
    setCreateError(null)
    try {
      await createMonth(branchId, selectedYear, selectedMonth)
      onCreated()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Error creando mes')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        style={{ maxWidth: '520px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Nuevo mes</h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Mes</label>
              <select
                className="form-input admin-select"
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(Number(e.target.value))
                  setShowPreview(false)
                }}
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={i} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Año</label>
              <input
                type="number"
                className="form-input"
                value={selectedYear}
                min={2020}
                max={2099}
                onChange={(e) => {
                  setSelectedYear(Number(e.target.value))
                  setShowPreview(false)
                }}
              />
            </div>
          </div>

          <button
            className="admin-btn admin-btn--ghost"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? 'Ocultar preview' : 'Ver semanas que se generarán'}
          </button>

          {showPreview && (
            <div
              style={{
                background: '#0f0f0f',
                border: '1px solid #2d2d2d',
                borderRadius: '0.375rem',
                padding: '0.75rem',
              }}
            >
              <p
                style={{
                  fontSize: '0.75rem',
                  color: '#71717a',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '0.5rem',
                }}
              >
                {MONTH_NAMES[selectedMonth - 1]} {selectedYear} · {preview.length} semanas
              </p>
              {preview.map((w, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '0.3rem 0',
                    borderBottom: i < preview.length - 1 ? '1px solid #1f1f1f' : 'none',
                    fontSize: '0.8125rem',
                    color: '#a1a1aa',
                  }}
                >
                  <span>Semana {i + 1}</span>
                  <span>
                    {formatDate(w.start)} – {formatDate(w.end)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {createError && <p className="form-error">{createError}</p>}
        </div>

        <div className="modal-footer">
          <button className="admin-btn admin-btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="admin-btn admin-btn--primary"
            disabled={creating}
            onClick={handleCreate}
          >
            {creating ? 'Creando...' : 'Crear mes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// WEEK DETAIL MODAL
// ============================================================
interface WeekDetailModalProps {
  week: Week
  month: Month
  data: WeekDetailData | null
  loading: boolean
  onClose: () => void
}

function WeekDetailModal({ week, month, data, loading, onClose }: WeekDetailModalProps) {
  const monthName = MONTH_NAMES[month.month - 1]

  // Compute summary from transactions
  const summary = data
    ? (() => {
        const txs = data.transactions
        const totalCuts = txs.length
        const totalBilled = txs.reduce((s, t) => s + t.amount, 0)
        const byMethod: Record<PaymentMethod, number> = { cash: 0, transfer: 0, card: 0 }
        for (const t of txs) byMethod[t.payment_method] += t.amount
        return { totalCuts, totalBilled, byMethod }
      })()
    : null

  // Compute per-barber rows from settlements
  const barberRows: BarberRow[] = data
    ? data.settlements.map((s) => ({
        barberId: s.barber_id,
        barberName: s.barber.full_name,
        cuts: s.total_cuts,
        billed: s.gross_amount,
        commission: s.total_earned,
        toCollect: s.net_payable,
      }))
    : []

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        style={{ maxWidth: '760px', width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>
            Semana {week.week_number} · {monthName} {month.year}
            <span
              style={{ marginLeft: '0.75rem', fontSize: '0.75rem', fontWeight: 400, color: '#71717a' }}
            >
              {formatDate(week.start_date)} – {formatDate(week.end_date)}
            </span>
          </h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ gap: '1.25rem' }}>
          {loading && (
            <div className="flex-center" style={{ padding: '2rem' }}>
              <div className="admin-loader" />
            </div>
          )}

          {!loading && data && (
            <>
              {/* --- Resumen --- */}
              <section>
                <p
                  style={{
                    fontSize: '0.6875rem',
                    color: '#71717a',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '0.75rem',
                  }}
                >
                  Resumen
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <KpiMini label="Cortes" value={String(summary!.totalCuts)} />
                  <KpiMini label="Facturado" value={formatARS(summary!.totalBilled)} />
                  <KpiMini
                    label="Efectivo"
                    value={formatARS(summary!.byMethod.cash)}
                    color="#34d399"
                  />
                  <KpiMini
                    label="Transfer"
                    value={formatARS(summary!.byMethod.transfer)}
                    color="#818cf8"
                  />
                </div>
              </section>

              {/* --- Por barbero --- */}
              {barberRows.length > 0 && (
                <section>
                  <p
                    style={{
                      fontSize: '0.6875rem',
                      color: '#71717a',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Por barbero
                  </p>
                  <div className="admin-table-wrap" style={{ padding: 0 }}>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Barbero</th>
                          <th>Cortes</th>
                          <th>Facturado</th>
                          <th>Comisión</th>
                          <th>A cobrar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {barberRows.map((row) => (
                          <tr key={row.barberId}>
                            <td>{row.barberName}</td>
                            <td className="td-center">{row.cuts}</td>
                            <td>{formatARS(row.billed)}</td>
                            <td>{formatARS(row.commission)}</td>
                            <td
                              className={
                                row.toCollect >= 0 ? 'net-payable net-payable--pos' : 'net-payable net-payable--neg'
                              }
                            >
                              {formatARS(row.toCollect)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* --- Transacciones --- */}
              <section>
                <p
                  style={{
                    fontSize: '0.6875rem',
                    color: '#71717a',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '0.5rem',
                  }}
                >
                  Transacciones ({data.transactions.length})
                </p>

                {data.transactions.length === 0 && (
                  <div className="empty-state">
                    <p>Sin transacciones en esta semana.</p>
                  </div>
                )}

                {data.transactions.length > 0 && (
                  <div className="admin-table-wrap" style={{ padding: 0, maxHeight: '260px', overflowY: 'auto' }}>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Barbero</th>
                          <th>Servicio</th>
                          <th>Método</th>
                          <th>Monto</th>
                          <th>Comisión</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.transactions.map((t) => (
                          <tr key={t.id}>
                            <td className="td-date">{formatDate(t.transaction_date)}</td>
                            <td>{t.barber.full_name}</td>
                            <td className="td-muted">{t.service?.name ?? '—'}</td>
                            <td>
                              <span className={`dot-badge dot-badge--${t.payment_method}`}>
                                {PAYMENT_METHOD_LABELS[t.payment_method]}
                              </span>
                            </td>
                            <td className="td-bold">{formatARS(t.amount)}</td>
                            <td className="td-amber">{formatARS(t.barber_share)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="admin-btn admin-btn--ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// KPI MINI CARD
// ============================================================
function KpiMini({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div
      style={{
        background: '#0f0f0f',
        border: '1px solid #2d2d2d',
        borderRadius: '0.375rem',
        padding: '0.625rem 0.75rem',
      }}
    >
      <p style={{ fontSize: '0.6875rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.25rem' }}>
        {label}
      </p>
      <p style={{ fontSize: '1rem', fontWeight: 700, color: color ?? '#e5e5e5', margin: 0 }}>
        {value}
      </p>
    </div>
  )
}

// ============================================================
// NEW YEAR MODAL — crear los 12 meses + todas sus semanas
// ============================================================
interface NewYearModalProps {
  branchId: string
  onClose: () => void
  onCreated: () => void
}

function NewYearModal({ branchId, onClose, onCreated }: NewYearModalProps) {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear + 1) // default: año próximo
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ months: number; weeks: number } | null>(null)

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const res = await createYear(branchId, year)
      setResult({ months: res.months_created, weeks: res.weeks_created })
      // Esperar 1.5s mostrando resultado y cerrar
      setTimeout(onCreated, 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error creando año')
      setCreating(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={creating ? undefined : onClose}>
      <div className="modal-box" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>+ Crear año completo</h3>
          {!creating && <button className="modal-close" onClick={onClose}>✕</button>}
        </div>

        <div className="modal-body">
          {result ? (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✓</div>
              <p style={{ color: '#34d399', fontWeight: 700, marginBottom: '0.5rem' }}>
                Año {year} creado
              </p>
              <p style={{ color: '#a1a1aa', fontSize: '0.875rem' }}>
                {result.months} meses · {result.weeks} semanas
              </p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: '0.85rem', color: '#a1a1aa', margin: '0 0 0.75rem' }}>
                Crea automáticamente los <strong>12 meses</strong> del año seleccionado con <strong>todas sus semanas</strong> Lun–Dom (aprox 52).
                Si algún mes o semana ya existe, se respeta y solo se crea lo faltante.
              </p>
              <div className="form-group">
                <label className="form-label">Año</label>
                <input
                  type="number"
                  className="form-input"
                  value={year}
                  min={currentYear}
                  max={currentYear + 5}
                  onChange={(e) => setYear(Number(e.target.value))}
                  disabled={creating}
                />
              </div>
              {error && <p className="form-error">{error}</p>}
            </>
          )}
        </div>

        {!result && (
          <div className="modal-footer">
            <button className="admin-btn admin-btn--ghost" onClick={onClose} disabled={creating}>
              Cancelar
            </button>
            <button className="admin-btn admin-btn--primary" disabled={creating} onClick={handleCreate}>
              {creating ? 'Creando...' : `Crear año ${year}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// MANUAL WEEK MODAL — crear semana con fechas arbitrarias
// ============================================================
interface ManualWeekModalProps {
  branchId: string
  onClose: () => void
  onCreated: () => void
}

function ManualWeekModal({ branchId, onClose, onCreated }: ManualWeekModalProps) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [status, setStatus] = useState<'open' | 'closed'>('open')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!start || !end) { setError('Completá las dos fechas'); return }
    setCreating(true)
    setError(null)
    try {
      await createManualWeek(branchId, start, end, status)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error creando semana')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>+ Semana manual</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '0.8rem', color: '#71717a', margin: '0 0 0.75rem' }}>
            Creá una semana con fechas arbitrarias (útil para cargar datos retroactivos).
          </p>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Desde</label>
              <input
                type="date"
                className="form-input"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Hasta</label>
              <input
                type="date"
                className="form-input"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Estado inicial</label>
            <select
              className="form-input admin-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'open' | 'closed')}
            >
              <option value="open">Abierta</option>
              <option value="closed">Cerrada</option>
            </select>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>

        <div className="modal-footer">
          <button className="admin-btn admin-btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="admin-btn admin-btn--primary" disabled={creating} onClick={handleCreate}>
            {creating ? 'Creando...' : 'Crear semana'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// EDIT WEEK MODAL — editar fechas de una semana existente
// ============================================================
interface EditWeekModalProps {
  week: Week
  onClose: () => void
  onSaved: () => void
}

function EditWeekModal({ week, onClose, onSaved }: EditWeekModalProps) {
  const [start, setStart] = useState(week.start_date)
  const [end, setEnd] = useState(week.end_date)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!start || !end) { setError('Las dos fechas son obligatorias'); return }
    setSaving(true)
    setError(null)
    try {
      await updateWeekDates(week.id, start, end)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Editar Semana {week.week_number}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: '0.8rem', color: '#a1a1aa', margin: '0 0 0.75rem' }}>
            Cambiá las fechas de inicio y fin de la semana. El estado actual ({week.status}) se mantiene.
          </p>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Desde</label>
              <input type="date" className="form-input" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Hasta</label>
              <input type="date" className="form-input" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="admin-btn admin-btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="admin-btn admin-btn--primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}
