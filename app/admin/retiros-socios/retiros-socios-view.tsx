'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import { type Week } from '@/lib/supabase/database.types'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import {
  getCurrentProfile,
  getWeeksByBranch,
  getExpensesByDateRange,
  getPartnersByBranch,
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
export default function RetirosSociosView() {
  const router = useRouter()
  const today = new Date()
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [weeks, setWeeks] = useState<Week[]>([])
  const [partners, setPartners] = useState<{ id: string; full_name: string }[]>([])
  const [retiros, setRetiros] = useState<ExpenseWithUser[]>([])

  // Período: mes calendario, misma lógica que Gastos y Reportes.
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)  // 1-12

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editRetiro, setEditRetiro] = useState<ExpenseWithUser | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [filterPartner, setFilterPartner] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay   = new Date(year, month, 0).getDate()
  const endDate   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const loadRetiros = useCallback(async (branchId: string, from: string, to: string) => {
    if (!branchId) { setRetiros([]); return }
    try {
      const data = await getExpensesByDateRange(branchId, from, to)
      // Los retiros siguen viviendo en expenses; se distinguen por la categoría.
      setRetiros(data.filter((e) => e.category === 'retiro_socio'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando retiros')
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

      const [weeksData, partnersData] = await Promise.all([
        getWeeksByBranch(branch),
        getPartnersByBranch(branch),
      ])
      setWeeks(weeksData)
      setPartners(partnersData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [router, setSelectedBranch])

  useEffect(() => { loadInitial() }, [loadInitial])

  useEffect(() => {
    if (!selectedBranch) return
    loadRetiros(selectedBranch, startDate, endDate)
    setPage(1)
  }, [selectedBranch, startDate, endDate, loadRetiros])

  // ─── Realtime: gastos de la sucursal ───────────────────────────────
  useEffect(() => {
    if (!selectedBranch) return
    const channel = supabase
      .channel(`retiros-branch-${selectedBranch}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `branch_id=eq.${selectedBranch}` }, () => {
        loadRetiros(selectedBranch, startDate, endDate)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selectedBranch, startDate, endDate, loadRetiros])

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }

  function nextMonth() {
    if (isCurrentMonth) return
    if (month === 12) { setMonth(1); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }

  async function handleDelete(expenseId: string) {
    setConfirmDeleteId(null)
    try {
      setActionLoading(`ret-del-${expenseId}`)
      await deleteExpense(expenseId)
      await loadRetiros(selectedBranch, startDate, endDate)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar el retiro')
    } finally {
      setActionLoading(null)
    }
  }

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1

  if (loading) return <div className="flex items-center justify-center h-64 text-zinc-400">Cargando retiros...</div>
  if (error)   return <div className="p-6 text-red-400">{error}</div>

  const filtered = filterPartner ? retiros.filter((r) => r.partner_id === filterPartner) : retiros
  const total = filtered.reduce((s, r) => s + r.amount, 0)

  // Totalizador por socio (mismo desglose que después se replica en Reportes)
  const porSocio = Object.values(
    filtered.reduce<Record<string, { name: string; total: number }>>((acc, r) => {
      const key = r.partner_id ?? 'sin_socio'
      const name = r.partner_name ?? 'Sin socio asignado'
      if (!acc[key]) acc[key] = { name, total: 0 }
      acc[key].total += r.amount
      return acc
    }, {})
  ).sort((a, b) => b.total - a.total)

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, totalPages)
  const paged = filtered.slice((current - 1) * pageSize, current * pageSize)

  return (
    <div className="w-full px-4 py-8 space-y-6">
      {/* Header con navegador de mes */}
      <div className="flowi-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Retiros de socios</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Retiros de ganancia de los socios, mes por mes.
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
            onClick={() => setShowForm(true)}
            disabled={partners.length === 0}
            title={partners.length === 0 ? 'No hay socios (admins) asignados a esta sucursal.' : undefined}
            className="admin-btn admin-btn--primary"
          >
            + Registrar retiro
          </button>
        </div>
      </div>

      {/* Totalizador por socio */}
      {porSocio.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
            Total del mes por socio
          </p>
          <div className="space-y-2">
            {porSocio.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <span className="text-zinc-300">{s.name}</span>
                <span className="text-white font-semibold">{formatARS(s.total)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm pt-2 border-t border-zinc-800">
              <span className="text-zinc-400 font-semibold">Total</span>
              <span className="text-amber-400 font-bold">{formatARS(total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Filtro por socio */}
      <div className="filter-bar">
        <select value={filterPartner} onChange={(e) => setFilterPartner(e.target.value)} className="filter-input">
          <option value="">Todos los socios</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name}</option>
          ))}
        </select>
        {filterPartner && (
          <button onClick={() => setFilterPartner('')} className="filter-clear">✕ Limpiar</button>
        )}
        {filterPartner && (
          <span className="filter-count">{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Grilla */}
      <div className="admin-table-wrap">
        {retiros.length === 0 ? (
          <EmptyState message="No hay retiros de socios registrados en este período." />
        ) : filtered.length === 0 ? (
          <EmptyState message="Sin resultados para el filtro aplicado." />
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Socio</th>
                <th>Concepto</th>
                <th>Monto</th>
                <th>Notas</th>
                <th>Registrado por</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.id}>
                  <td className="td-date">{formatDate(r.expense_date)}</td>
                  <td>
                    <span className="badge badge--violet">{r.partner_name ?? 'Sin socio'}</span>
                  </td>
                  <td>{r.concept}</td>
                  <td className="td-danger">{formatARS(r.amount)}</td>
                  <td className="td-muted">{r.notes ?? '—'}</td>
                  <td className="td-muted">{r.registered_by_name ?? '—'}</td>
                  <td>
                    <div className="action-group">
                      <button
                        onClick={() => setEditRetiro(r)}
                        disabled={!!actionLoading}
                        className="action-btn"
                      >
                        Editar
                      </button>
                      {confirmDeleteId === r.id ? (
                        <span className="flex items-center gap-1 text-xs">
                          <span className="td-muted">¿Eliminar?</span>
                          <button
                            onClick={() => handleDelete(r.id)}
                            disabled={actionLoading === `ret-del-${r.id}`}
                            className="action-btn action-btn--danger"
                          >
                            Sí
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)} className="action-btn">
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(r.id)}
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
                  <strong>{filtered.length} retiro{filtered.length !== 1 ? 's' : ''}</strong>
                </td>
                <td><strong className="td-danger">{formatARS(total)}</strong></td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <PaginationControls
        currentPage={current}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={filtered.length}
        startIdx={filtered.length === 0 ? 0 : (current - 1) * pageSize + 1}
        endIdx={Math.min(current * pageSize, filtered.length)}
        canGoPrevious={current > 1}
        canGoNext={current < totalPages}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
        itemLabel="retiros"
      />

      {/* ── MODALES ── */}
      {(showForm || editRetiro) && (
        <ExpenseFormModal
          expense={editRetiro}
          branchId={selectedBranch}
          weeks={weeks}
          registeredBy={currentUserId}
          fixedCategory="retiro_socio"
          partners={partners}
          title={editRetiro ? 'Editar retiro de socio' : 'Registrar retiro de socio'}
          submitLabel="Guardar retiro"
          onClose={() => { setShowForm(false); setEditRetiro(null) }}
          onSaved={async () => {
            setShowForm(false)
            setEditRetiro(null)
            await loadRetiros(selectedBranch, startDate, endDate)
          }}
        />
      )}
    </div>
  )
}
