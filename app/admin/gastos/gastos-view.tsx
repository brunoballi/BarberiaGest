'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import {
  type Week,
  type ExpenseCategory,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
} from '@/lib/supabase/database.types'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import {
  getCurrentProfile,
  getWeeksByBranch,
  getExpensesByDateRange,
  deleteExpense,
  supabase,
  MONTH_NAMES,
  type ExpenseWithUser,
} from '@/lib/supabase/supabase.client'
import { PaginationControls } from '@/app/components/pagination-controls'
import { ExpenseFormModal } from '@/app/components/expense-form-modal'
import '../admin-dashboard.css'

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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <p>{message}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────
export default function GastosView() {
  const router = useRouter()
  const today = new Date()
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [weeks, setWeeks] = useState<Week[]>([])
  const [expenses, setExpenses] = useState<ExpenseWithUser[]>([])

  // Período: mes calendario, misma lógica que Reportes.
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)  // 1-12

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Modales / confirmaciones
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [editExpense, setEditExpense] = useState<ExpenseWithUser | null>(null)
  const [confirmDeleteExpId, setConfirmDeleteExpId] = useState<string | null>(null)

  // Filtros
  const [expFilterDateFrom, setExpFilterDateFrom] = useState('')
  const [expFilterDateTo, setExpFilterDateTo] = useState('')
  const [expFilterCategory, setExpFilterCategory] = useState('')

  // Paginación (default 20, igual que las demás grillas)
  const [gastosPage, setGastosPage] = useState(1)
  const [gastosPageSize, setGastosPageSize] = useState(20)

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay   = new Date(year, month, 0).getDate()
  const endDate   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const loadExpenses = useCallback(async (branchId: string, from: string, to: string) => {
    if (!branchId) { setExpenses([]); return }
    try {
      const data = await getExpensesByDateRange(branchId, from, to)
      // Los retiros de socios tienen su propio módulo (/admin/retiros-socios).
      setExpenses(data.filter((e) => e.category !== 'retiro_socio'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando gastos')
    }
  }, [])

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranchesCached()])
      if (!p) { setError('No autenticado'); return }
      if (bs.length === 0) { setError('No tenés sucursales asignadas.'); return }
      setCurrentUserId(p.id)

      const stored = getStoredBranch()
      const branch = stored && bs.some((b) => b.id === stored) ? stored : null
      if (!branch) { router.replace('/admin/select-branch'); return }
      setSelectedBranch(branch)

      // Las semanas se usan solo para derivar el week_id del gasto a partir de su fecha.
      const weeksData = await getWeeksByBranch(branch)
      setWeeks(weeksData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [router, setSelectedBranch])

  useEffect(() => { loadInitial() }, [loadInitial])

  useEffect(() => {
    if (!selectedBranch) return
    loadExpenses(selectedBranch, startDate, endDate)
    setGastosPage(1)
  }, [selectedBranch, startDate, endDate, loadExpenses])

  // ─── Realtime: gastos de la sucursal ───────────────────────────────
  useEffect(() => {
    if (!selectedBranch) return
    const channel = supabase
      .channel(`exp-branch-${selectedBranch}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `branch_id=eq.${selectedBranch}` }, () => {
        loadExpenses(selectedBranch, startDate, endDate)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selectedBranch, startDate, endDate, loadExpenses])

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }

  function nextMonth() {
    if (isCurrentMonth) return
    if (month === 12) { setMonth(1); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }

  async function handleDeleteExpense(expenseId: string) {
    setConfirmDeleteExpId(null)
    try {
      setActionLoading(`exp-del-${expenseId}`)
      await deleteExpense(expenseId)
      await loadExpenses(selectedBranch, startDate, endDate)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar gasto')
    } finally {
      setActionLoading(null)
    }
  }

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1

  if (loading) return <div className="flex items-center justify-center h-64 text-zinc-400">Cargando gastos...</div>
  if (error)   return <div className="p-6 text-red-400">{error}</div>

  // ─── Filtros + paginación ──────────────────────────────────────────
  const hasExpFilters = !!(expFilterDateFrom || expFilterDateTo || expFilterCategory)
  const filteredExpenses = expenses.filter((e) => {
    if (expFilterDateFrom && e.expense_date < expFilterDateFrom) return false
    if (expFilterDateTo && e.expense_date > expFilterDateTo) return false
    if (expFilterCategory && e.category !== expFilterCategory) return false
    return true
  })
  const expensesTotal = expenses.reduce((s, e) => s + e.amount, 0)
  const filteredTotal = filteredExpenses.reduce((s, e) => s + e.amount, 0)
  const gTotalPages = Math.max(1, Math.ceil(filteredExpenses.length / gastosPageSize))
  const gCurrent = Math.min(gastosPage, gTotalPages)
  const gPaged = filteredExpenses.slice((gCurrent - 1) * gastosPageSize, gCurrent * gastosPageSize)

  return (
    <div className="w-full px-4 py-8 space-y-6">
      {/* Header con navegador de mes (mismo período que Reportes) */}
      <div className="flowi-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Gastos</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Gastos de la sucursal, mes por mes.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={prevMonth}
              title="Mes anterior"
              className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:border-amber-500 hover:text-amber-400 text-xl transition-colors"
            >‹</button>
            <span className="text-white font-bold text-base min-w-[9rem] text-center">
              {MONTH_NAMES[month - 1].toUpperCase()} {year}
            </span>
            <button
              onClick={nextMonth}
              disabled={isCurrentMonth}
              title="Mes siguiente"
              className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:border-amber-500 hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-xl transition-colors"
            >›</button>
          </div>
          <button
            onClick={() => setShowExpenseForm(true)}
            className="admin-btn admin-btn--primary"
          >
            + Registrar gasto
          </button>
        </div>
      </div>

      {/* Filtros */}
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
          {EXPENSE_CATEGORIES.filter((c) => c !== 'retiro_socio').map((c) => (
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
      </div>

      {/* Grilla */}
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
                <td><strong className="td-danger">{formatARS(hasExpFilters ? filteredTotal : expensesTotal)}</strong></td>
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

      {/* ── MODALES ── */}
      {(showExpenseForm || editExpense) && (
        <ExpenseFormModal
          expense={editExpense}
          branchId={selectedBranch}
          weeks={weeks}
          registeredBy={currentUserId}
          onClose={() => { setShowExpenseForm(false); setEditExpense(null) }}
          onSaved={async () => {
            setShowExpenseForm(false)
            setEditExpense(null)
            await loadExpenses(selectedBranch, startDate, endDate)
          }}
        />
      )}
    </div>
  )
}
