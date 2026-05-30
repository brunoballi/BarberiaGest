'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  Branch,
  Profile,
  Week,
  WeekInsert,
  SettlementWithBarber,
} from '@/lib/supabase/database.types'
import { WEEK_STATUS_LABELS, SETTLEMENT_STATUS_LABELS } from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getMyBranches,
  getWeeksByBranch,
  createWeek,
  closeWeek,
  markWeekPaid,
  getAllBarbersByBranch,
  calculateAllSettlementsForWeek,
  getSettlementsForWeek,
  setPresentismo,
  confirmSettlement,
  deleteSettlement,
  updateBarberExtraDays,
} from '@/lib/supabase/supabase.client'

// ─── Helpers ──────────────────────────────────────────────────────────────
function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
  })
}

// Mejora 2: días domingo(0)/lunes(1) dentro del rango de una semana.
// Son los días que el admin puede habilitar para que los barberos carguen cortes.
function blockedDaysInRange(startDate: string, endDate: string): { date: string; label: string }[] {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const end = new Date(ey, em - 1, ed)
  const out: { date: string; label: string }[] = []
  for (const dt = new Date(sy, sm - 1, sd); dt <= end; dt.setDate(dt.getDate() + 1)) {
    const dow = dt.getDay()
    if (dow === 0 || dow === 1) {
      const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      out.push({ date: ds, label: dow === 0 ? 'Domingo' : 'Lunes' })
    }
  }
  return out
}

const STATUS_COLORS: Record<Week['status'], string> = {
  open:   'bg-emerald-900/50 text-emerald-400 border-emerald-800/50',
  closed: 'bg-amber-900/50  text-amber-400  border-amber-800/50',
  paid:   'bg-zinc-800      text-zinc-400   border-zinc-700',
}

// ─── Main component ────────────────────────────────────────────────────────
export default function WeeksView() {
  const [profile, setProfile]           = useState<Profile | null>(null)
  const [branches, setBranches]         = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [weeks, setWeeks]               = useState<Week[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)

  // Create form
  const [showCreate, setShowCreate]     = useState(false)
  const [formStart, setFormStart]       = useState('')
  const [formEnd, setFormEnd]           = useState('')
  const [creating, setCreating]         = useState(false)
  const [createError, setCreateError]   = useState<string | null>(null)

  // Selected week detail
  const [selectedWeek, setSelectedWeek] = useState<Week | null>(null)
  const [settlements, setSettlements]   = useState<SettlementWithBarber[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [actionError, setActionError]   = useState<string | null>(null)

  // Action in progress
  const [closing, setClosing]           = useState(false)
  const [markingPaid, setMarkingPaid]   = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [deletingSettlementId, setDeletingSettlementId] = useState<string | null>(null)
  const [savingExtraDay, setSavingExtraDay] = useState<string | null>(null)

  const loadWeeks = useCallback(async (branchId: string) => {
    const data = await getWeeksByBranch(branchId)
    setWeeks(data)
  }, [])

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranches()])
      if (!p) { setError('No autenticado'); return }
      if (bs.length === 0) { setError('No tenés sucursales asignadas. Contactá al administrador.'); return }
      setProfile(p)
      setBranches(bs)
      // Si la sucursal actual del perfil no está entre las asignadas, usar la primera asignada
      const initial = bs.some((b) => b.id === p.branch_id) ? p.branch_id : bs[0].id
      setSelectedBranch(initial)
      await loadWeeks(initial)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [loadWeeks])

  useEffect(() => { loadInitial() }, [loadInitial])

  async function handleBranchChange(branchId: string) {
    setSelectedBranch(branchId)
    setSelectedWeek(null)
    setSettlements([])
    try { await loadWeeks(branchId) }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') }
  }

  async function handleToggleExtraDay(week: Week, dateStr: string) {
    const current = week.barber_extra_days ?? []
    const next = current.includes(dateStr)
      ? current.filter((d) => d !== dateStr)
      : [...current, dateStr]
    setSavingExtraDay(dateStr)
    setActionError(null)
    try {
      const updated = await updateBarberExtraDays(week.id, next)
      setWeeks((prev) => prev.map((w) => (w.id === week.id ? updated : w)))
      setSelectedWeek((sw) => (sw && sw.id === week.id ? updated : sw))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al actualizar días habilitados')
    } finally {
      setSavingExtraDay(null)
    }
  }

  async function handleSelectWeek(week: Week) {
    if (selectedWeek?.id === week.id) {
      setSelectedWeek(null)
      setSettlements([])
      return
    }
    setSelectedWeek(week)
    setActionError(null)
    setConfirmClose(false)
    if (week.status !== 'open') {
      setLoadingDetail(true)
      try {
        const s = await getSettlementsForWeek(week.id)
        setSettlements(s)
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Error al cargar liquidaciones')
      } finally {
        setLoadingDetail(false)
      }
    } else {
      setSettlements([])
    }
  }

  // ── Create week ────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!formStart || !formEnd) return
    setCreating(true)
    setCreateError(null)
    try {
      const nextNumber = weeks.length > 0
        ? Math.max(...weeks.map((w) => w.week_number)) + 1
        : 1
      const payload: WeekInsert = {
        branch_id:   selectedBranch,
        week_number: nextNumber,
        start_date:  formStart,
        end_date:    formEnd,
        status:      'open',
      }
      const created = await createWeek(payload)
      setWeeks((prev) =>
        [created, ...prev].sort(
          (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
        )
      )
      setShowCreate(false)
      setFormStart('')
      setFormEnd('')
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Error al crear semana')
    } finally {
      setCreating(false)
    }
  }

  // ── Close week ─────────────────────────────────────────────────────────
  async function handleClose() {
    if (!selectedWeek || !profile) return
    if (!confirmClose) { setConfirmClose(true); return }

    setClosing(true)
    setActionError(null)
    try {
      const barbers = await getAllBarbersByBranch(selectedBranch)
      const activeBarbers = barbers.filter((b) => b.is_active)
      if (activeBarbers.length > 0) {
        await calculateAllSettlementsForWeek(selectedWeek.id, activeBarbers.map((b) => b.id))
      }
      await closeWeek(selectedWeek.id, profile.id)
      const [updatedWeeks, updatedSettlements] = await Promise.all([
        getWeeksByBranch(selectedBranch),
        getSettlementsForWeek(selectedWeek.id),
      ])
      setWeeks(updatedWeeks)
      setSettlements(updatedSettlements)
      const updated = updatedWeeks.find((w) => w.id === selectedWeek.id)
      if (updated) setSelectedWeek(updated)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al cerrar semana')
    } finally {
      setClosing(false)
      setConfirmClose(false)
    }
  }

  // ── Presentismo toggle ─────────────────────────────────────────────────
  async function handlePresentismo(settlement: SettlementWithBarber, met: boolean) {
    if (!selectedWeek) return
    setActionError(null)
    try {
      await setPresentismo(settlement.id, selectedWeek.id, settlement.barber_id, met)
      const updated = await getSettlementsForWeek(selectedWeek.id)
      setSettlements(updated)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al actualizar presentismo')
    }
  }

  // ── Confirm settlement ─────────────────────────────────────────────────
  async function handleConfirm(settlementId: string) {
    setActionError(null)
    try {
      await confirmSettlement(settlementId)
      setSettlements((prev) =>
        prev.map((s) => s.id === settlementId ? { ...s, status: 'confirmed' } : s)
      )
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al confirmar')
    }
  }

  // ── Delete settlement ──────────────────────────────────────────────────
  async function handleDeleteSettlement(settlementId: string) {
    setDeletingSettlementId(settlementId)
    setActionError(null)
    try {
      const { weekReverted } = await deleteSettlement(settlementId)
      const updatedSettlements = selectedWeek
        ? await getSettlementsForWeek(selectedWeek.id)
        : []
      setSettlements(updatedSettlements)
      if (weekReverted && selectedWeek) {
        const updatedWeeks = await getWeeksByBranch(selectedBranch)
        setWeeks(updatedWeeks)
        const refreshed = updatedWeeks.find((w) => w.id === selectedWeek.id)
        if (refreshed) setSelectedWeek(refreshed)
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al eliminar liquidación')
    } finally {
      setDeletingSettlementId(null)
    }
  }

  // ── Mark week paid ─────────────────────────────────────────────────────
  async function handleMarkPaid() {
    if (!selectedWeek) return
    setMarkingPaid(true)
    setActionError(null)
    try {
      await markWeekPaid(selectedWeek.id)
      const updated = await getWeeksByBranch(selectedBranch)
      setWeeks(updated)
      const updatedWeek = updated.find((w) => w.id === selectedWeek.id)
      if (updatedWeek) setSelectedWeek(updatedWeek)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error al marcar como pagada')
    } finally {
      setMarkingPaid(false)
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const allConfirmed =
    settlements.length > 0 &&
    settlements.every((s) => s.status === 'confirmed' || s.status === 'paid')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-400">
        Cargando semanas...
      </div>
    )
  }

  if (error) return <div className="p-6 text-red-400">{error}</div>

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Semanas</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Creá, cerrá y liquidá las semanas de trabajo
          </p>
        </div>
        {!showCreate && (
          <button
            onClick={() => { setShowCreate(true); setCreateError(null) }}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            Nueva semana
          </button>
        )}
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

      {/* Create form */}
      {showCreate && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-white">Nueva semana</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Inicio
                </label>
                <input
                  required
                  type="date"
                  value={formStart}
                  onChange={(e) => setFormStart(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Fin
                </label>
                <input
                  required
                  type="date"
                  value={formEnd}
                  min={formStart}
                  onChange={(e) => setFormEnd(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
            {createError && <p className="text-red-400 text-sm">{createError}</p>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={creating}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                {creating ? 'Creando...' : 'Crear semana'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setCreateError(null) }}
                className="text-zinc-400 hover:text-white px-5 py-2.5 rounded-lg text-sm border border-zinc-700 hover:border-zinc-500 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Weeks list */}
      {weeks.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-12 text-center">
          <p className="text-zinc-500 text-sm">No hay semanas creadas todavía</p>
        </div>
      ) : (
        <div className="space-y-3">
          {weeks.map((week, idx) => {
            const displayNumber = weeks.length - idx
            return (
            <div key={week.id}>
              {/* Week header row */}
              <button
                onClick={() => handleSelectWeek(week)}
                className={`w-full text-left bg-zinc-900 border rounded-xl px-5 py-4 flex items-center justify-between gap-4 transition-colors ${
                  selectedWeek?.id === week.id
                    ? 'border-amber-500/50'
                    : 'border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-white font-semibold">
                      Semana {displayNumber}
                    </p>
                    <p className="text-zinc-500 text-xs mt-0.5">
                      {formatDate(week.start_date)} → {formatDate(week.end_date)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${STATUS_COLORS[week.status]}`}>
                    {WEEK_STATUS_LABELS[week.status]}
                  </span>
                  <span className={`text-zinc-500 text-sm transition-transform ${selectedWeek?.id === week.id ? 'rotate-180' : ''}`}>
                    ▾
                  </span>
                </div>
              </button>

              {/* Week detail (expanded) */}
              {selectedWeek?.id === week.id && (
                <div className="mt-2 bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 space-y-4">
                  {actionError && (
                    <p className="text-red-400 text-sm">{actionError}</p>
                  )}

                  {/* Open week: close action */}
                  {week.status === 'open' && (
                    <div className="space-y-3">
                      <p className="text-zinc-400 text-sm">
                        Al cerrar la semana se calcularán automáticamente las liquidaciones
                        de todos los barberos activos.
                      </p>
                      {confirmClose ? (
                        <div className="flex items-center gap-3">
                          <span className="text-zinc-400 text-sm">¿Confirmar cierre?</span>
                          <button
                            onClick={handleClose}
                            disabled={closing}
                            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors"
                          >
                            {closing ? 'Cerrando...' : 'Sí, cerrar'}
                          </button>
                          <button
                            onClick={() => setConfirmClose(false)}
                            className="text-zinc-400 hover:text-white text-sm transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={handleClose}
                          className="bg-zinc-700 hover:bg-zinc-600 text-white font-bold px-5 py-2.5 rounded-lg text-sm transition-colors"
                        >
                          Cerrar semana y liquidar
                        </button>
                      )}
                    </div>
                  )}

                  {/* Open week: habilitar dom/lun para barberos (Mejora 2) */}
                  {week.status === 'open' && (() => {
                    const blocked = blockedDaysInRange(week.start_date, week.end_date)
                    if (blocked.length === 0) return null
                    const enabled = new Set(week.barber_extra_days ?? [])
                    return (
                      <div className="space-y-2 border-t border-zinc-800 pt-4">
                        <p className="text-zinc-300 text-sm font-semibold">Días domingo/lunes para barberos</p>
                        <p className="text-zinc-500 text-xs">
                          Por defecto los barberos solo cargan martes a sábado. Habilitá un día si excepcionalmente se trabajó.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {blocked.map((b) => {
                            const on = enabled.has(b.date)
                            return (
                              <button
                                key={b.date}
                                onClick={() => handleToggleExtraDay(week, b.date)}
                                disabled={savingExtraDay === b.date}
                                className={`px-3 py-2 rounded-lg text-sm border transition-colors disabled:opacity-40 ${
                                  on
                                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                                }`}
                              >
                                {b.label} {formatDate(b.date)} · {savingExtraDay === b.date ? 'Guardando...' : on ? 'Habilitado ✓' : 'Deshabilitado'}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Closed / Paid week: settlements */}
                  {(week.status === 'closed' || week.status === 'paid') && (
                    <div className="space-y-4">
                      {loadingDetail ? (
                        <p className="text-zinc-400 text-sm">Cargando liquidaciones...</p>
                      ) : settlements.length === 0 ? (
                        <p className="text-zinc-500 text-sm">No hay liquidaciones</p>
                      ) : (
                        <>
                          <div className="space-y-2">
                            {settlements.map((s) => (
                              <SettlementRow
                                key={s.id}
                                settlement={s}
                                weekStatus={week.status}
                                onPresentismo={handlePresentismo}
                                onConfirm={handleConfirm}
                                onDelete={handleDeleteSettlement}
                                deleting={deletingSettlementId === s.id}
                              />
                            ))}
                          </div>

                          {/* Summary */}
                          <div className="border-t border-zinc-800 pt-3 flex items-center justify-between">
                            <div className="text-sm text-zinc-400">
                              Total a pagar:{' '}
                              <span className="text-white font-bold text-base">
                                {formatARS(settlements.reduce((s, l) => s + l.net_payable, 0))}
                              </span>
                            </div>
                            {week.status === 'closed' && allConfirmed && (
                              <button
                                onClick={handleMarkPaid}
                                disabled={markingPaid}
                                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-lg text-sm transition-colors"
                              >
                                {markingPaid ? 'Procesando...' : '✓ Marcar semana como pagada'}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Settlement row ────────────────────────────────────────────────────────
function SettlementRow({
  settlement: s,
  weekStatus,
  onPresentismo,
  onConfirm,
  onDelete,
  deleting,
}: {
  settlement: SettlementWithBarber
  weekStatus: Week['status']
  onPresentismo: (s: SettlementWithBarber, met: boolean) => void
  onConfirm: (id: string) => void
  onDelete: (id: string) => void
  deleting: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isSalary = s.barber.compensation_type === 'salary'
  const canEdit  = weekStatus === 'closed' && s.status === 'draft'

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      {/* Barber + status */}
      <div className="flex items-center justify-between">
        <p className="text-white font-semibold text-sm">{s.barber.full_name}</p>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
            s.status === 'paid'      ? 'bg-zinc-800 text-zinc-400 border-zinc-700' :
            s.status === 'confirmed' ? 'bg-emerald-900/50 text-emerald-400 border-emerald-800/50' :
                                       'bg-amber-900/50 text-amber-400 border-amber-800/50'
          }`}>
            {SETTLEMENT_STATUS_LABELS[s.status]}
          </span>
          {/* Eliminar con confirmación inline */}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              title="Eliminar liquidación"
              className="text-xs px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:border-red-500 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              Eliminar
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-zinc-400">¿Eliminar?</span>
              <button
                onClick={() => { setConfirmDelete(false); onDelete(s.id) }}
                disabled={deleting}
                className="text-red-400 hover:text-red-300 font-bold disabled:opacity-40"
              >
                {deleting ? '...' : 'Sí'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-zinc-500 hover:text-white"
              >
                No
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Numbers grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-zinc-500 text-xs">Cortes</p>
          <p className="text-white font-medium">{s.total_cuts}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs">Bruto barbero</p>
          <p className="text-white font-medium">{formatARS(s.barber_gross)}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs">Ya cobrado</p>
          <p className="text-zinc-400 font-medium">−{formatARS(s.already_collected)}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs">Adelantos</p>
          <p className="text-zinc-400 font-medium">−{formatARS(s.advances_deducted)}</p>
        </div>
      </div>

      {/* Bonuses (salary model) */}
      {isSalary && (
        <div className="grid grid-cols-2 gap-3 text-sm border-t border-zinc-800 pt-3">
          <div className="flex items-center gap-3">
            <span className="text-zinc-500 text-xs">Presentismo</span>
            {canEdit ? (
              <button
                onClick={() => onPresentismo(s, !s.presentismo_met)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  s.presentismo_met
                    ? 'bg-emerald-900/50 text-emerald-400 border-emerald-800/50'
                    : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:border-zinc-500'
                }`}
              >
                {s.presentismo_met ? 'Sí ✓' : 'No'}
              </button>
            ) : (
              <span className="text-white text-xs">{s.presentismo_met ? 'Sí' : 'No'}</span>
            )}
          </div>
          <div>
            <span className="text-zinc-500 text-xs">Objetivo </span>
            <span className="text-white text-xs">
              {s.objetivo_met ? `Sí (+${formatARS(s.bonus_objetivo)})` : 'No'}
            </span>
          </div>
        </div>
      )}

      {/* Net payable + confirm */}
      <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
        <div>
          <p className="text-zinc-500 text-xs">Neto a pagar</p>
          <p className={`font-bold text-lg ${s.net_payable >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
            {formatARS(s.net_payable)}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => onConfirm(s.id)}
            className="bg-zinc-700 hover:bg-zinc-600 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
          >
            Confirmar
          </button>
        )}
      </div>
    </div>
  )
}
