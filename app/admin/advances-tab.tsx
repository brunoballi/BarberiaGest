'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Profile, AdvanceWithBarber, AdvanceInsert } from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getBarbersByBranch,
  getPendingAdvancesByBranch,
  createAdvance,
  approveAdvance,
  cancelAdvance,
  supabase,
  todayLocal,
} from '@/lib/supabase/supabase.client'
import { CurrencyInput } from '@/app/components/currency-input'
import { TextInput } from '@/app/components/text-input'
import { usePagination } from '@/lib/hooks/usePagination'
import { PaginationControls } from '@/app/components/pagination-controls'

function formatARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

function isSelfRequested(a: AdvanceWithBarber): boolean {
  return a.registered_by === a.barber_id
}

/**
 * Panel de Adelantos embebido como tab del dashboard. Es branch-scoped
 * (independiente de la semana seleccionada): carga sus propios datos.
 */
export default function AdvancesTab({ branchId }: { branchId: string }) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [barbers, setBarbers] = useState<Profile[]>([])
  const [advances, setAdvances] = useState<AdvanceWithBarber[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [filterBarber, setFilterBarber] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  // Form
  const [showForm, setShowForm] = useState(false)
  const [formBarberId, setFormBarberId] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formDate, setFormDate] = useState(todayLocal())
  const [formReason, setFormReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Acciones
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const data = await getPendingAdvancesByBranch(branchId)
    setAdvances(data)
  }, [branchId])

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [p, barbersData, advancesData] = await Promise.all([
        getCurrentProfile(),
        getBarbersByBranch(branchId),
        getPendingAdvancesByBranch(branchId),
      ])
      setCurrentUserId(p?.id ?? null)
      setBarbers(barbersData)
      setAdvances(advancesData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => { loadInitial() }, [loadInitial])

  // Realtime: cambios en adelantos de la sucursal
  useEffect(() => {
    if (!branchId) return
    const channel = supabase
      .channel(`advances-tab-${branchId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'advances', filter: `branch_id=eq.${branchId}` },
        () => { reload() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [branchId, reload])

  async function handleSubmit() {
    if (!currentUserId || !formBarberId || !formAmount) {
      setFormError('Completá barbero y monto'); return
    }
    const amount = parseFloat(formAmount)
    if (isNaN(amount) || amount <= 0) { setFormError('Ingresá un monto válido'); return }
    try {
      setSubmitting(true)
      setFormError(null)
      const payload: AdvanceInsert = {
        barber_id: formBarberId,
        branch_id: branchId,
        week_id: null,
        amount,
        advance_date: formDate,
        reason: formReason.trim() || null,
        registered_by: currentUserId,
      }
      await createAdvance(payload)
      await reload()
      setShowForm(false)
      setFormBarberId('')
      setFormAmount('')
      setFormDate(todayLocal())
      setFormReason('')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Error al registrar adelanto')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleApprove(advanceId: string) {
    setApprovingId(advanceId)
    try {
      await approveAdvance(advanceId)
      setAdvances((prev) => prev.map((a) => a.id === advanceId ? { ...a, status: 'approved' as const } : a))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al autorizar')
    } finally {
      setApprovingId(null)
    }
  }

  async function handleCancel(advanceId: string) {
    if (cancelingId !== advanceId) { setActionError(null); setCancelingId(advanceId); return }
    try {
      await cancelAdvance(advanceId)
      setAdvances((prev) => prev.filter((a) => a.id !== advanceId))
    } catch (e) {
      // Mensaje no destructivo (no reemplaza la pestaña): p.ej. liquidación cerrada
      setActionError(e instanceof Error ? e.message : 'Error al cancelar')
    } finally {
      setCancelingId(null)
    }
  }

  const hasFilters = !!(filterBarber || filterStatus || filterDateFrom || filterDateTo)
  const filteredAdvances = advances.filter((a) => {
    if (filterBarber && a.barber_id !== filterBarber) return false
    if (filterStatus && a.status !== filterStatus) return false
    if (filterDateFrom && a.advance_date < filterDateFrom) return false
    if (filterDateTo && a.advance_date > filterDateTo) return false
    return true
  })

  const pagination = usePagination(filteredAdvances, 20)
  const filteredTotal = filteredAdvances.reduce((s, a) => s + a.amount, 0)

  if (loading) return <div className="empty-state"><p>Cargando adelantos…</p></div>
  if (error) return <div className="empty-state"><p style={{ color: '#ef4444' }}>{error}</p></div>

  return (
    <div className="tab-panel">
      {actionError && (
        <div
          role="alert"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
            margin: '0 0 0.75rem', padding: '0.6rem 0.9rem',
            background: 'rgba(220,38,38,0.08)', border: '1px solid #7f1d1d',
            borderRadius: '0.5rem', color: '#fca5a5', fontSize: '0.8125rem',
          }}
        >
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
            title="Cerrar"
          >✕</button>
        </div>
      )}
      <div className="filter-bar">
        <select value={filterBarber} onChange={(e) => setFilterBarber(e.target.value)} className="filter-input">
          <option value="">Todos los barberos</option>
          {barbers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="filter-input">
          <option value="">Todos los estados</option>
          <option value="pending">Pendiente</option>
          <option value="approved">Autorizado</option>
        </select>
        <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="filter-input" title="Desde" />
        <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="filter-input" title="Hasta" />
        {hasFilters && (
          <button onClick={() => { setFilterBarber(''); setFilterStatus(''); setFilterDateFrom(''); setFilterDateTo('') }} className="filter-clear">
            ✕ Limpiar
          </button>
        )}
        <span className="filter-count">{filteredAdvances.length} resultado{filteredAdvances.length !== 1 ? 's' : ''}</span>
        <button onClick={() => { setShowForm((v) => !v); setFormError(null) }} className="admin-btn admin-btn--primary" style={{ marginLeft: 'auto' }}>
          {showForm ? 'Cerrar' : '+ Nuevo adelanto'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit() }}
          className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
        >
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Barbero</label>
            <select required value={formBarberId} onChange={(e) => setFormBarberId(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500">
              <option value="">Elegí un barbero</option>
              {barbers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Monto</label>
            <CurrencyInput
              value={formAmount}
              onChange={setFormAmount}
              required
              placeholder="0,00"
              className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Fecha</label>
            <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Motivo (opcional)</label>
            <TextInput
              value={formReason}
              onChange={setFormReason}
              placeholder="Ej: Adelanto sueldo"
              className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
          {formError && <p className="text-red-400 text-sm sm:col-span-2 lg:col-span-4">{formError}</p>}
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" disabled={submitting} className="admin-btn admin-btn--primary">
              {submitting ? 'Guardando…' : 'Registrar adelanto'}
            </button>
          </div>
        </form>
      )}

      <div className="admin-table-wrap">
        {advances.length === 0 ? (
          <div className="empty-state"><p>No hay adelantos pendientes registrados.</p></div>
        ) : filteredAdvances.length === 0 ? (
          <div className="empty-state"><p>Sin resultados para los filtros aplicados.</p></div>
        ) : (
          <>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Barbero</th>
                  <th>Monto</th>
                  <th>Motivo</th>
                  <th>Estado</th>
                  <th>Origen</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pagination.paginatedData.map((a) => {
                  const isPendingSelf = a.status === 'pending' && isSelfRequested(a)
                  return (
                    <tr key={a.id} className={isPendingSelf ? 'tr-override' : ''}>
                      <td className="td-date">{formatDate(a.advance_date)}</td>
                      <td>
                        <div className="barber-cell">
                          <div className="barber-avatar">
                            {a.barber.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </div>
                          <p className="barber-name">{a.barber.full_name}</p>
                        </div>
                      </td>
                      <td className="td-bold td-amber">{formatARS(a.amount)}</td>
                      <td className="td-muted">{a.reason ?? '—'}</td>
                      <td>
                        <span className={`badge ${a.status === 'approved' ? 'badge--green' : 'badge--violet'}`}>
                          {a.status === 'approved' ? 'Autorizado' : 'Pendiente'}
                        </span>
                      </td>
                      <td className="td-muted">{isSelfRequested(a) ? 'Barbero' : 'Admin'}</td>
                      <td>
                        <div className="action-group">
                          {a.status === 'pending' && (
                            <button onClick={() => handleApprove(a.id)} disabled={approvingId === a.id} className="action-btn action-btn--confirm">
                              {approvingId === a.id ? '...' : 'Autorizar'}
                            </button>
                          )}
                          {cancelingId === a.id ? (
                            <>
                              <button onClick={() => handleCancel(a.id)} className="action-btn action-btn--pay" style={{ background: '#dc2626', borderColor: '#dc2626' }}>
                                Sí, cancelar
                              </button>
                              <button onClick={() => setCancelingId(null)} className="action-btn">No</button>
                            </>
                          ) : (
                            <button onClick={() => setCancelingId(a.id)} className="action-btn" style={{ color: '#ef4444' }}>
                              Cancelar
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
                  <td colSpan={2}>
                    <strong>{filteredAdvances.length} adelanto{filteredAdvances.length !== 1 ? 's' : ''}</strong>
                    {hasFilters && advances.length !== filteredAdvances.length && (
                      <span style={{ color: '#a1a1aa', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                        (de {advances.length})
                      </span>
                    )}
                  </td>
                  <td><strong className="td-amber">{formatARS(filteredTotal)}</strong></td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
            <PaginationControls
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              pageSize={pagination.pageSize}
              totalItems={pagination.totalItems}
              startIdx={pagination.startIdx}
              endIdx={pagination.endIdx}
              canGoPrevious={pagination.canGoPrevious}
              canGoNext={pagination.canGoNext}
              onPageChange={pagination.goToPage}
              onPageSizeChange={pagination.setPageSize}
              itemLabel="adelantos"
            />
          </>
        )}
      </div>
    </div>
  )
}
