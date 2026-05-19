'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePersistedBranch, resolveInitialBranch } from '@/lib/hooks/usePersistedBranch'
import type {
  Branch,
  Profile,
  AdvanceWithBarber,
  AdvanceInsert,
} from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getBranches,
  getBarbersByBranch,
  getPendingAdvancesByBranch,
  createAdvance,
  approveAdvance,
  cancelAdvance,
} from '@/lib/supabase/supabase.client'

function formatARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** True si el adelanto fue solicitado por el propio barbero (no por un admin) */
function isSelfRequested(advance: AdvanceWithBarber): boolean {
  return advance.registered_by === advance.barber_id
}

export default function AdvancesView() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [barbers, setBarbers] = useState<Profile[]>([])
  const [advances, setAdvances] = useState<AdvanceWithBarber[]>([])
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [formBarberId, setFormBarberId] = useState<string>('')
  const [formAmount, setFormAmount] = useState<string>('')
  const [formDate, setFormDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [formReason, setFormReason] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Actions state
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [p, bs] = await Promise.all([getCurrentProfile(), getBranches()])
      if (!p) { setError('No autenticado'); return }
      setProfile(p)
      setBranches(bs)
      const initialBranch = resolveInitialBranch(bs)
      setSelectedBranch(initialBranch)
      const [barbersData, advancesData] = await Promise.all([
        getBarbersByBranch(initialBranch),
        getPendingAdvancesByBranch(initialBranch),
      ])
      setBarbers(barbersData)
      setAdvances(advancesData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadInitial() }, [loadInitial])

  async function handleBranchChange(branchId: string) {
    setSelectedBranch(branchId)
    setFormBarberId('')
    try {
      const [barbersData, advancesData] = await Promise.all([
        getBarbersByBranch(branchId),
        getPendingAdvancesByBranch(branchId),
      ])
      setBarbers(barbersData)
      setAdvances(advancesData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cambiar sucursal')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile || !formBarberId || !formAmount || !selectedBranch) return

    const amount = parseFloat(formAmount)
    if (isNaN(amount) || amount <= 0) {
      setFormError('Ingresá un monto válido')
      return
    }

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
      setFormDate(new Date().toISOString().split('T')[0])
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
      setAdvances((prev) =>
        prev.map((a) => a.id === advanceId ? { ...a, status: 'approved' } : a)
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al autorizar')
    } finally {
      setApprovingId(null)
    }
  }

  async function handleCancel(advanceId: string) {
    if (cancelingId !== advanceId) {
      setCancelingId(advanceId)
      return
    }
    try {
      await cancelAdvance(advanceId)
      setAdvances((prev) => prev.filter((a) => a.id !== advanceId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cancelar')
    } finally {
      setCancelingId(null)
    }
  }

  // Separar solicitudes pendientes de autorizar vs autorizados
  const pendingApproval = advances.filter((a) => a.status === 'pending' && isSelfRequested(a))
  const authorized      = advances.filter((a) => a.status === 'approved' || (a.status === 'pending' && !isSelfRequested(a)))
  const totalAuthorized = authorized.reduce((s, a) => s + a.amount, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-400">
        Cargando adelantos...
      </div>
    )
  }

  if (error) {
    return <div className="p-6 text-red-400">{error}</div>
  }

  return (
    <div className="max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Adelantos</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Solicitudes de barberos y adelantos registrados
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setFormError(null) }}
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          Nuevo adelanto
        </button>
      </div>

      {/* Branch selector */}
      {branches.length > 1 && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
            Sucursal
          </label>
          <select
            value={selectedBranch}
            onChange={(e) => handleBranchChange(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* New advance form */}
      {showForm && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-white">Registrar adelanto</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Barbero
                </label>
                <select
                  required
                  value={formBarberId}
                  onChange={(e) => setFormBarberId(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                >
                  <option value="">Seleccioná un barbero</option>
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>{b.full_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Monto
                </label>
                <div className="flex items-center bg-zinc-800 border border-zinc-700 rounded-lg px-3 focus-within:border-amber-500 transition-colors">
                  <span className="text-zinc-500 font-semibold mr-1">$</span>
                  <input
                    required
                    type="number"
                    inputMode="numeric"
                    min="1"
                    placeholder="0"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-white py-2.5 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Fecha
                </label>
                <input
                  required
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Motivo <span className="text-zinc-600 normal-case">(opcional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Ej: anticipo quincena"
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {formError && <p className="text-red-400 text-sm">{formError}</p>}

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                {submitting ? 'Guardando...' : 'Guardar adelanto'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(null) }}
                className="text-zinc-400 hover:text-white px-5 py-2.5 rounded-lg text-sm border border-zinc-700 hover:border-zinc-500 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Solicitudes pendientes de autorizar ─────────────────── */}
      {pendingApproval.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-violet-400 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
            Solicitudes pendientes ({pendingApproval.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pendingApproval.map((advance) => (
            <div
              key={advance.id}
              className="bg-zinc-900 border border-violet-800/50 rounded-xl px-5 py-4 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-white font-semibold text-sm">{advance.barber.full_name}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-900/50 text-violet-400 border border-violet-700/50">
                    Solicitado por barbero
                  </span>
                </div>
                <p className="text-violet-300 font-bold text-lg mt-0.5">{formatARS(advance.amount)}</p>
                <p className="text-zinc-500 text-xs mt-1">
                  {formatDate(advance.advance_date)}
                  {advance.reason && <> · <span className="text-zinc-400">{advance.reason}</span></>}
                </p>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={() => handleApprove(advance.id)}
                  disabled={approvingId === advance.id}
                  className="text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  {approvingId === advance.id ? '...' : 'Autorizar'}
                </button>

                {cancelingId === advance.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">¿Cancelar?</span>
                    <button onClick={() => handleCancel(advance.id)} className="text-xs text-red-400 hover:text-red-300 font-semibold">Sí</button>
                    <button onClick={() => setCancelingId(null)} className="text-xs text-zinc-500 hover:text-zinc-300">No</button>
                  </div>
                ) : (
                  <button onClick={() => handleCancel(advance.id)} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">
                    Rechazar
                  </button>
                )}
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* ── Adelantos autorizados / registrados ─────────────────── */}
      {authorized.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Autorizados — pendientes de descuento
          </h2>

          {/* Summary strip */}
          <div className="bg-amber-950/40 border border-amber-800/40 rounded-xl px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">Total a descontar</p>
              <p className="text-2xl font-bold text-amber-400 mt-0.5">{formatARS(totalAuthorized)}</p>
            </div>
            <p className="text-zinc-400 text-sm">{authorized.length} adelanto{authorized.length !== 1 ? 's' : ''}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {authorized.map((advance) => (
            <div
              key={advance.id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-white font-semibold text-sm">{advance.barber.full_name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    advance.status === 'approved'
                      ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800/50'
                      : 'bg-amber-900/40 text-amber-400 border-amber-800/50'
                  }`}>
                    {advance.status === 'approved' ? 'Autorizado' : 'Pendiente'}
                  </span>
                  {!isSelfRequested(advance) && (
                    <span className="text-xs text-zinc-600">Registrado por admin</span>
                  )}
                </div>
                <p className="text-amber-400 font-bold text-lg mt-0.5">{formatARS(advance.amount)}</p>
                <p className="text-zinc-500 text-xs mt-1">
                  {formatDate(advance.advance_date)}
                  {advance.reason && <> · <span className="text-zinc-400">{advance.reason}</span></>}
                </p>
              </div>

              <div className="flex-shrink-0">
                {cancelingId === advance.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">¿Confirmar?</span>
                    <button onClick={() => handleCancel(advance.id)} className="text-xs text-red-400 hover:text-red-300 font-semibold">Sí</button>
                    <button onClick={() => setCancelingId(null)} className="text-xs text-zinc-500 hover:text-zinc-300">No</button>
                  </div>
                ) : (
                  <button onClick={() => handleCancel(advance.id)} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {advances.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-12 text-center">
          <p className="text-zinc-500 text-sm">No hay adelantos registrados</p>
        </div>
      )}
    </div>
  )
}
