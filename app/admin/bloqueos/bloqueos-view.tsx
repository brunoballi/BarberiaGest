'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import { useRealtimeRefresh } from '@/lib/hooks/use-realtime-refresh'
import { getAllBarbersByBranch } from '@/lib/supabase/supabase.client'
import {
  deleteScheduleException,
  getScheduleExceptions,
  updateScheduleException,
  type ScheduleException,
} from '@/lib/supabase/appointments'
import type { Profile } from '@/lib/supabase/database.types'
import { confirmDialog, errorDialog } from '@/lib/confirm-dialog'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fechaLarga(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}
function franja(x: ScheduleException): string {
  return x.closed_all_day || !x.start_time || !x.end_time
    ? 'Todo el día'
    : `${x.start_time.slice(0, 5)} a ${x.end_time.slice(0, 5)}`
}

const TODOS = 'todos'
const SUCURSAL = 'sucursal'

/** Edita fecha, franja y motivo de un bloqueo (no cambia de barbero ni de sucursal). */
function EditarBloqueoModal({
  x,
  quien,
  onClose,
  onSaved,
}: {
  x: ScheduleException
  quien: string
  onClose: () => void
  onSaved: () => void
}) {
  const [fecha, setFecha] = useState(x.exception_date)
  const [todoElDia, setTodoElDia] = useState(x.closed_all_day)
  const [desde, setDesde] = useState(x.start_time?.slice(0, 5) ?? '18:00')
  const [hasta, setHasta] = useState(x.end_time?.slice(0, 5) ?? '21:00')
  const [motivo, setMotivo] = useState(x.reason ?? '')
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!todoElDia && desde >= hasta) {
      setErr('La hora de inicio tiene que ser antes que la de fin')
      return
    }
    setGuardando(true)
    setErr(null)
    try {
      await updateScheduleException({
        id: x.id,
        exceptionDate: fecha,
        closedAllDay: todoElDia,
        startTime: todoElDia ? null : desde,
        endTime: todoElDia ? null : hasta,
        reason: motivo.trim() || null,
      })
      onSaved()
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'No se pudo guardar el bloqueo')
    } finally {
      setGuardando(false)
    }
  }

  const inputCls =
    'w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500'

  return (
    // Sin cierre por clic afuera: hay un formulario cargado. Se sale con la X o con Cancelar.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 overflow-y-auto">
      <form onSubmit={guardar} className="bg-[var(--bg2)] border border-[var(--border-mid)] rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[var(--text)] font-bold text-base">Editar bloqueo</h3>
            <p className="text-xs text-[var(--text-muted)]">{quien}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-lg leading-none text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Fecha</p>
          <input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={todoElDia} onChange={(e) => setTodoElDia(e.target.checked)} className="w-4 h-4 accent-amber-500" />
          <span className="text-sm text-[var(--text)]">Todo el día</span>
        </label>

        {!todoElDia && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Desde</p>
              <input type="time" required value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Hasta</p>
              <input type="time" required value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Motivo (opcional)</p>
          <input type="text" maxLength={120} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ej: turno médico" className={inputCls} />
        </div>

        {err && <p className="text-red-400 text-sm">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={guardando} className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-4 py-2.5 rounded-lg text-sm">
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </button>
          <button type="button" onClick={onClose} className="flex-1 border border-[var(--border-mid)] text-[var(--text)] hover:bg-[var(--bg3)] px-4 py-2.5 rounded-lg text-sm">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * Todos los bloqueos de la sucursal (franco, médico, comida, feriado) en una lista: los que cargaron
 * los barberos, los de un barbero puntual y los de toda la sucursal. Se filtra por barbero y por período.
 */
export default function BloqueosView() {
  const router = useRouter()
  const [branchId, setBranchId] = useState('')
  const [barbers, setBarbers] = useState<Profile[]>([])
  const [items, setItems] = useState<ScheduleException[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quien, setQuien] = useState(TODOS)
  const [periodo, setPeriodo] = useState<'proximos' | 'mes' | 'pasados'>('proximos')
  const [editando, setEditando] = useState<ScheduleException | null>(null)

  const desde = periodo === 'pasados' ? addDaysISO(todayISO(), -90) : todayISO()

  const cargar = useCallback(async (bId: string, d: string) => {
    try {
      setItems(await getScheduleExceptions(bId, d))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando los bloqueos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const stored = getStoredBranch()
    if (!stored) { router.replace('/admin/select-branch'); return }
    setBranchId(stored)
    void getAllBarbersByBranch(stored).then((bs) => setBarbers(bs.filter((b) => b.is_active))).catch(() => {})
  }, [router])

  useEffect(() => {
    if (branchId) void cargar(branchId, desde)
  }, [branchId, desde, cargar])

  useRealtimeRefresh(
    branchId ? `bloqueos-${branchId}` : null,
    [{ table: 'schedule_exceptions', filter: `branch_id=eq.${branchId}` }],
    () => void cargar(branchId, desde),
  )

  const nombre = useCallback(
    (x: ScheduleException) =>
      x.barber_id === null ? 'Toda la sucursal' : (barbers.find((b) => b.id === x.barber_id)?.full_name ?? 'Un barbero'),
    [barbers],
  )

  const hoy = todayISO()
  const visibles = useMemo(() => {
    const limite = addDaysISO(hoy, 31)
    return items
      .filter((x) => {
        if (periodo === 'pasados') return x.exception_date < hoy
        if (x.exception_date < hoy) return false
        return periodo === 'mes' ? x.exception_date <= limite : true
      })
      .filter((x) => quien === TODOS || (quien === SUCURSAL ? x.barber_id === null : x.barber_id === quien))
      .sort((a, b) =>
        periodo === 'pasados'
          ? b.exception_date.localeCompare(a.exception_date)
          : a.exception_date.localeCompare(b.exception_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''),
      )
  }, [items, quien, periodo, hoy])

  const porDia = useMemo(() => {
    const m = new Map<string, ScheduleException[]>()
    for (const x of visibles) m.set(x.exception_date, [...(m.get(x.exception_date) ?? []), x])
    return [...m.entries()]
  }, [visibles])

  async function borrar(x: ScheduleException) {
    if (!(await confirmDialog({
      title: 'Quitar bloqueo',
      message: `¿Quitar el bloqueo de ${nombre(x)} del ${fechaLarga(x.exception_date)} (${franja(x).toLowerCase()})? Ese horario vuelve a quedar disponible para reservar.`,
      danger: true,
      confirmLabel: 'Quitar bloqueo',
    }))) return
    try {
      await deleteScheduleException(x.id)
      await cargar(branchId, desde)
    } catch (e) {
      await errorDialog(e instanceof Error ? e.message : 'No se pudo quitar el bloqueo')
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">Cargando bloqueos...</div>

  const selectCls =
    'bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500'

  return (
    <div className="w-full px-4 py-8 space-y-6">
      <div className="flowi-page-header">
        <h1 className="text-2xl font-bold text-[var(--text)]">Bloqueos</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          Los horarios en que no se toman turnos: los que cargan los barberos, los de un barbero puntual y los de toda la sucursal.
        </p>
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <select value={quien} onChange={(e) => setQuien(e.target.value)} className={selectCls} aria-label="Filtrar por barbero">
          <option value={TODOS}>Todos los barberos</option>
          <option value={SUCURSAL}>Toda la sucursal</option>
          {barbers.map((b) => (
            <option key={b.id} value={b.id}>{b.full_name}</option>
          ))}
        </select>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as typeof periodo)} className={selectCls} aria-label="Período">
          <option value="proximos">De hoy en adelante</option>
          <option value="mes">Próximos 30 días</option>
          <option value="pasados">Últimos 90 días</option>
        </select>
        <span className="text-xs text-[var(--text-muted)]">{visibles.length} {visibles.length === 1 ? 'bloqueo' : 'bloqueos'}</span>
      </div>

      {porDia.length === 0 ? (
        <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl px-5 py-10 text-center">
          <p className="text-[var(--text-muted)] text-sm">No hay bloqueos con este filtro.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {porDia.map(([dia, lista]) => (
            <section key={dia} className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl overflow-hidden">
              <h2 className="px-4 py-2 text-sm font-semibold capitalize text-[var(--text)] border-b border-[var(--border)]">
                {fechaLarga(dia)}{dia === hoy && <span className="ml-2 text-xs text-amber-400">Hoy</span>}
              </h2>
              <ul className="divide-y divide-[var(--border)]">
                {lista.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text)]">
                        <span className="font-semibold">{nombre(x)}</span>
                        <span className="text-[var(--text-muted)]"> · </span>
                        <span className="font-semibold">{franja(x)}</span>
                      </p>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {x.reason || 'Sin motivo'}
                        {x.barber_id && x.created_by === x.barber_id ? ' · lo cargó el barbero' : ''}
                      </p>
                    </div>
                    {x.exception_date >= hoy && (
                      <div className="shrink-0 flex gap-2">
                        <button
                          onClick={() => setEditando(x)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-mid)] text-[var(--text)] hover:bg-[var(--bg3)]"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => borrar(x)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10"
                        >
                          Quitar
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editando && (
        <EditarBloqueoModal
          key={editando.id}
          x={editando}
          quien={nombre(editando)}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); void cargar(branchId, desde) }}
        />
      )}
    </div>
  )
}
