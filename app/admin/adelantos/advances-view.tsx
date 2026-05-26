'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import type { Profile, AdvanceWithBarber, AdvanceInsert } from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getMyBranches,
  getBarbersByBranch,
  getPendingAdvancesByBranch,
  createAdvance,
  approveAdvance,
  cancelAdvance,
  todayLocal,
} from '@/lib/supabase/supabase.client'
import '../admin-dashboard.css'

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

function isSelfRequested(advance: AdvanceWithBarber): boolean {
  return advance.registered_by === advance.barber_id
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state"><p>{message}</p></div>
}

export default function AdvancesView() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [barbers, setBarbers] = useState<Profile[]>([])
  const [advances, setAdvances] = useState<AdvanceWithBarber[]>([])
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [filterBarber, setFilterBarber] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [formBarberId, setFormBarberId] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formDate, setFormDate] = useState(todayLocal())
  const [formReason, setFormReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Actions
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranches()])
      if (!p) { setError('No autenticado'); return }
      if (bs.length === 0) { setError('No tenés sucursales asignadas.'); return }
      setProfile(p)

      const stored = getStoredBranch()
      const branch = stored && bs.some((b) => b.id === stored) ? stored : null
      if (!branch) { router.replace('/admin/select-branch'); return }

      setSelectedBranch(branch)
      const [barbersData, advancesData] = await Promise.all([
        getBarbersByBranch(branch),
        getPendingAdvancesByBranch(branch),
      ])
      setBarbers(barbersData)
      setAdvances(advancesData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [router, setSelectedBranch])

  useEffect(() => { loadInitial() }, [loadInitial])

  async function handleSubmitModal() {
    if (!profile || !formBarberId || !formAmount || !selectedBranch) return
    const amount = parseFloat(formAmount)
    if (isNaN(amount) || amount <= 0) { setFormError('Ingresá un monto válido'); return }
    try {
      setSubmitting(true)
      setFormError(null)
      const payload: AdvanceInsert = {
        barber_id: formBarberId,
        branch_id: selectedBranch,
        week_id: null,
        amount,
        advance_date: formDate,
        reason: formReason.trim() || null,
        registered_by: profile.id,
      }
      await createAdvance(payload)
      const updated = await getPendingAdvancesByBranch(selectedBranch)
      setAdvances(updated)
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
    if (cancelingId !== advanceId) { setCancelingId(advanceId); return }
    try {
      await cancelAdvance(advanceId)
      setAdvances((prev) => prev.filter((a) => a.id !== advanceId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cancelar')
    } finally {
      setCancelingId(null)
    }
  }

  // Filtrado
  const hasFilters = !!(filterBarber || filterStatus || filterDateFrom || filterDateTo)
  const filteredAdvances = advances.filter((a) => {
    if (filterBarber && a.barber_id !== filterBarber) return false
    if (filterStatus && a.status !== filterStatus) return false
    if (filterDateFrom && a.advance_date < filterDateFrom) return false
    if (filterDateTo && a.advance_date > filterDateTo) return false
    return true
  })

  const pendingCount = advances.filter((a) => a.status === 'pending' && isSelfRequested(a)).length
  const filteredTotal = filteredAdvances.reduce((s, a) => s + a.amount, 0)

  if (loading) return (
    <div className="admin-app flex-center">
      <div className="admin-loader" />
    </div>
  )

  if (error) return (
    <div className="admin-app flex-center">
      <div className="error-box">
        <p className="error-msg">{error}</p>
        <button onClick={() => { setError(null); loadInitial() }} className="admin-btn admin-btn--primary">Reintentar</button>
      </div>
    </div>
  )

  return (
    <div className="admin-app">
      <div className="admin-header-wrapper">
        <div className="admin-brand-bar">
          <span className="admin-logo">VALHALLA</span>
          <span className="admin-badge">Admin</span>
          <span className="admin-brand-separator">·</span>
          <span className="admin-brand-branch">Adelantos</span>
        </div>
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button onClick={() => router.push('/admin')} className="admin-btn admin-btn--ghost">
              ← Volver
            </button>
            {pendingCount > 0 && (
              <span className="badge badge--violet">
                {pendingCount} solicitud{pendingCount !== 1 ? 'es' : ''} pendiente{pendingCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="admin-topbar-right">
            <button
              onClick={() => { setShowForm(true); setFormError(null) }}
              className="admin-btn admin-btn--primary"
            >
              + Nuevo adelanto
            </button>
          </div>
        </header>
      </div>

      <main className="admin-content">
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
          {hasFilters && (
            <button
              onClick={() => { setFilterBarber(''); setFilterStatus(''); setFilterDateFrom(''); setFilterDateTo('') }}
              className="filter-clear"
            >
              ✕ Limpiar
            </button>
          )}
          <span className="filter-count">{filteredAdvances.length} resultado{filteredAdvances.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="admin-table-wrap">
          <div className="table-toolbar">
            <span className="toolbar-total">
              Total: <strong>{formatARS(filteredTotal)}</strong>
              {hasFilters && advances.length !== filteredAdvances.length && (
                <span style={{ color: '#a1a1aa', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                  ({filteredAdvances.length} de {advances.length})
                </span>
              )}
            </span>
          </div>

          {advances.length === 0 ? (
            <EmptyState message="No hay adelantos pendientes registrados." />
          ) : filteredAdvances.length === 0 ? (
            <EmptyState message="Sin resultados para los filtros aplicados." />
          ) : (
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
                {filteredAdvances.map((a) => {
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
                            <button
                              onClick={() => handleApprove(a.id)}
                              disabled={approvingId === a.id}
                              className="action-btn action-btn--confirm"
                            >
                              {approvingId === a.id ? '...' : 'Autorizar'}
                            </button>
                          )}
                          {cancelingId === a.id ? (
                            <>
                              <button
                                onClick={() => handleCancel(a.id)}
                                className="action-btn action-btn--pay"
                                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                              >
                                Sí, cancelar
                              </button>
                              <button onClick={() => setCancelingId(null)} className="action-btn">
                                No
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setCancelingId(a.id)}
                              className="action-btn"
                              style={{ color: '#ef4444' }}
                            >
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
                  <td colSpan={2}><strong>{filteredAdvances.length} adelanto{filteredAdvances.length !== 1 ? 's' : ''}</strong></td>
                  <td><strong className="td-amber">{formatARS(filteredTotal)}</strong></td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </main>

      {/* Modal: Nuevo adelanto */}
      {showForm && (
        <div className="modal-overlay">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Registrar adelanto</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="modal-body">
              {formError && <p className="form-error">{formError}</p>}
              <label className="form-label">Barbero *</label>
              <select
                className="form-input"
                value={formBarberId}
                onChange={(e) => setFormBarberId(e.target.value)}
              >
                <option value="">Seleccioná un barbero</option>
                {barbers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
              </select>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Monto *</label>
                  <input
                    type="number"
                    className="form-input"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="0"
                    min="1"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </div>
              </div>
              <label className="form-label">Motivo</label>
              <input
                type="text"
                className="form-input"
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                placeholder="Ej: anticipo quincena"
              />
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="admin-btn admin-btn--ghost">Cancelar</button>
              <button onClick={handleSubmitModal} disabled={submitting} className="admin-btn admin-btn--primary">
                {submitting ? 'Guardando...' : 'Guardar adelanto'}
              </button>
            </div>
          </div>
        </div>
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
