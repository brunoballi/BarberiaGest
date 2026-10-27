'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import { getCurrentProfile, getAllBarbersByBranch } from '@/lib/supabase/supabase.client'
import type { Profile } from '@/lib/supabase/database.types'
import {
  getBarberSchedules,
  createBarberSchedule,
  deleteBarberSchedule,
  getScheduleExceptions,
  createScheduleException,
  deleteScheduleException,
  setBarberWeekSchedule,
  type BarberSchedule,
  type ScheduleException,
  type ScheduleMode,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
} from '@/lib/supabase/appointments'
import { alertDialog, confirmDialog, errorDialog } from '@/lib/confirm-dialog'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Configuración de horarios del turnero.
 *
 * Dos bloques: el horario semanal recurrente por barbero (con franjas mixtas:
 * cada franja es 'turno' u 'orden_llegada', no el día entero — así el caso de
 * Valhalla, mañana por orden de llegada y tarde con turno, sale sin código
 * especial) y las excepciones puntuales (feriados, "hoy se va antes").
 */
export default function HorariosView() {
  const router = useRouter()
  const [, setSelectedBranch] = usePersistedBranch()
  const [branchId, setBranchId] = useState('')
  const [myId, setMyId] = useState('')
  const [barbers, setBarbers] = useState<Profile[]>([])
  const [barberId, setBarberId] = useState('')
  const [schedules, setSchedules] = useState<BarberSchedule[]>([])
  const [exceptions, setExceptions] = useState<ScheduleException[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargarHorarios = useCallback(async (bId: string) => {
    setSchedules(await getBarberSchedules(bId))
  }, [])

  const cargarExcepciones = useCallback(async (bId: string) => {
    setExceptions(await getScheduleExceptions(bId, todayISO()))
  }, [])

  const cargarInicial = useCallback(async () => {
    try {
      setLoading(true)
      const p = await getCurrentProfile()
      if (!p) { setError('No autenticado'); void errorDialog('No autenticado'); return }
      setMyId(p.id)

      const stored = getStoredBranch()
      if (!stored) { router.replace('/admin/select-branch'); return }

      setSelectedBranch(stored)
      setBranchId(stored)

      const bs = await getAllBarbersByBranch(stored)
      const activos = bs.filter((b) => b.is_active)
      setBarbers(activos)
      if (activos.length > 0) {
        setBarberId(activos[0].id)
        await cargarHorarios(activos[0].id)
      }
      await cargarExcepciones(stored)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error inesperado'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setLoading(false)
    }
  }, [router, setSelectedBranch, cargarHorarios, cargarExcepciones])

  useEffect(() => { cargarInicial() }, [cargarInicial])

  async function cambiarBarbero(id: string) {
    setBarberId(id)
    await cargarHorarios(id)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">Cargando horarios...</div>
  if (error) return <div className="p-6 text-red-400">{error}</div>
  if (barbers.length === 0) {
    return (
      <div className="w-full px-4 py-8">
        <p className="text-[var(--text-muted)] text-sm">
          No hay barberos activos. Cargá uno desde{' '}
          <a href="/admin/barberos" className="text-amber-400 hover:underline">Barberos</a>{' '}
          antes de configurar horarios.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full px-4 py-8 space-y-8">
      <div className="flowi-page-header">
        <h1 className="text-2xl font-bold text-[var(--text)]">Horarios de atención</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          Definen los huecos que ofrece el turnero. Cada franja tiene su propio
          modo: con turno, o por orden de llegada (no se reserva hora).
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
          Barbero
        </label>
        <select
          value={barberId}
          onChange={(e) => cambiarBarbero(e.target.value)}
          className="w-full sm:w-72 bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
        >
          {barbers.map((b) => (
            <option key={b.id} value={b.id}>{b.full_name}</option>
          ))}
        </select>
      </div>

      <BulkSchedule
        branchId={branchId}
        barbers={barbers}
        barberId={barberId}
        onApplied={() => cargarHorarios(barberId)}
      />

      <WeekSchedule
        barberId={barberId}
        branchId={branchId}
        schedules={schedules}
        onChanged={() => cargarHorarios(barberId)}
      />

      <ExceptionsPanel
        branchId={branchId}
        barbers={barbers}
        exceptions={exceptions}
        myId={myId}
        onChanged={() => cargarExcepciones(branchId)}
      />
    </div>
  )
}

// ─── Carga rápida: mismas franjas en varios días y barberos ─────────────
interface FranjaDraft {
  key: number
  startTime: string
  endTime: string
  mode: ScheduleMode
  slotMinutes: string
}

let franjaKey = 0
function franja(startTime: string, endTime: string, mode: ScheduleMode): FranjaDraft {
  franjaKey += 1
  return { key: franjaKey, startTime, endTime, mode, slotMinutes: '30' }
}

// Plantillas del horario cortado típico. Son un punto de partida: después
// de elegir una, cada franja se puede editar (horas, modo, minutos).
const PLANTILLAS: { label: string; build: () => FranjaDraft[] }[] = [
  {
    label: 'Llegada mañana y tarde',
    build: () => [franja('09:00', '13:00', 'orden_llegada'), franja('16:00', '20:00', 'orden_llegada')],
  },
  {
    label: 'Llegada mañana + turno tarde',
    build: () => [franja('09:00', '13:00', 'orden_llegada'), franja('16:00', '20:00', 'turno')],
  },
  {
    label: 'Turno mañana + llegada tarde',
    build: () => [franja('09:00', '13:00', 'turno'), franja('16:00', '20:00', 'orden_llegada')],
  },
  {
    label: 'Turno mañana y tarde',
    build: () => [franja('09:00', '13:00', 'turno'), franja('16:00', '20:00', 'turno')],
  },
  {
    label: 'Corrido con turno',
    build: () => [franja('09:00', '20:00', 'turno')],
  },
]

const DIAS_PRESETS: { label: string; days: number[] }[] = [
  { label: 'Mar a Sáb', days: [2, 3, 4, 5, 6] },
  { label: 'Lun a Sáb', days: [1, 2, 3, 4, 5, 6] },
  { label: 'Lun a Vie', days: [1, 2, 3, 4, 5] },
  { label: 'Todos', days: [0, 1, 2, 3, 4, 5, 6] },
]

function BulkSchedule({
  branchId,
  barbers,
  barberId,
  onApplied,
}: {
  branchId: string
  barbers: Profile[]
  barberId: string
  onApplied: () => void
}) {
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState<number[]>([2, 3, 4, 5, 6])
  const [barberIds, setBarberIds] = useState<string[]>(barberId ? [barberId] : [])
  const [franjas, setFranjas] = useState<FranjaDraft[]>(() => PLANTILLAS[1].build())
  const [replace, setReplace] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Al abrir, arrancar con el barbero que se está mirando abajo.
  function abrir() {
    setBarberIds(barberId ? [barberId] : [])
    setErr(null)
    setOpen(true)
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  function updateFranja(key: number, patch: Partial<FranjaDraft>) {
    setFranjas((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)))
  }

  function validar(): string | null {
    if (days.length === 0) return 'Elegí al menos un día'
    if (barberIds.length === 0) return 'Elegí al menos un barbero'
    if (franjas.length === 0) return 'Agregá al menos una franja'
    const ordenadas = [...franjas].sort((a, b) => a.startTime.localeCompare(b.startTime))
    for (const f of ordenadas) {
      if (!f.startTime || !f.endTime || f.startTime >= f.endTime) {
        return `La franja ${f.startTime || '?'}–${f.endTime || '?'} termina antes de empezar`
      }
      if (f.mode === 'turno') {
        const n = parseInt(f.slotMinutes, 10)
        if (isNaN(n) || n <= 0) return `Indicá cada cuántos minutos se reserva en ${f.startTime}–${f.endTime}`
      }
    }
    for (let i = 1; i < ordenadas.length; i++) {
      if (ordenadas[i].startTime < ordenadas[i - 1].endTime) {
        return `Las franjas ${ordenadas[i - 1].startTime}–${ordenadas[i - 1].endTime} y ${ordenadas[i].startTime}–${ordenadas[i].endTime} se superponen`
      }
    }
    return null
  }

  async function aplicar() {
    const problema = validar()
    if (problema) {
      setErr(problema)
      void errorDialog(problema)
      return
    }
    const diasTxt = [...days].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]).join(', ')
    const barberosTxt = barberIds.length === barbers.length && barbers.length > 1
      ? 'todos los barberos'
      : barbers.filter((b) => barberIds.includes(b.id)).map((b) => b.full_name).join(', ')
    const ok = await confirmDialog({
      message: replace
        ? `Se reemplaza el horario de ${barberosTxt} los días ${diasTxt}. Lo que tenían cargado esos días se borra. ¿Seguir?`
        : `Se agregan ${franjas.length} franja${franjas.length === 1 ? '' : 's'} a ${barberosTxt} los días ${diasTxt}. ¿Seguir?`,
      danger: replace,
    })
    if (!ok) return

    setSaving(true)
    setErr(null)
    try {
      const res = await setBarberWeekSchedule({
        branchId,
        barberIds,
        weekdays: [...days].sort((a, b) => a - b),
        franjas: franjas.map((f) => ({
          startTime: f.startTime,
          endTime: f.endTime,
          mode: f.mode,
          slotMinutes: f.mode === 'turno' ? parseInt(f.slotMinutes, 10) : null,
        })),
        replace,
      })
      onApplied()
      setOpen(false)
      await alertDialog(`Listo: se cargaron ${res.created} franjas.`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al guardar'
      setErr(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
      active
        ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
        : 'bg-[var(--bg3)] border-[var(--border-mid)] text-[var(--text-muted)] hover:text-[var(--text)]'
    }`
  const inputCls = 'w-full min-w-0 bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500'
  // Los <input type="time"> tienen un ancho mínimo propio (reloj + hh:mm) que
  // en columnas angostas desbordaba el marco: más compactos y con min-w-0.
  const timeCls = 'w-full min-w-0 max-w-[8.5rem] bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-1.5 py-1.5 text-[0.8rem] tabular-nums focus:outline-none focus:border-amber-500'
  const labelCls = 'block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1'

  if (!open) {
    return (
      <section className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-[var(--text)] text-sm font-semibold">Carga rápida</p>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            El mismo horario para toda la semana (por ejemplo, martes a sábado) y para uno o varios barberos, de una vez.
          </p>
        </div>
        <button
          onClick={abrir}
          className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-4 py-2 rounded-lg text-xs transition-colors flex-shrink-0"
        >
          Cargar semana completa
        </button>
      </section>
    )
  }

  return (
    <section className="bg-[var(--bg2)] border border-[var(--border-mid)] rounded-xl p-4 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-[var(--text)]">Carga rápida de horario</h2>
        <button onClick={() => setOpen(false)} disabled={saving} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
          Cerrar
        </button>
      </div>

      {/* 1. Días */}
      <div className="space-y-2">
        <p className={labelCls}>1 · Días</p>
        <div className="flex flex-wrap gap-2">
          {DIAS_PRESETS.map((p) => {
            const activo = p.days.length === days.length && p.days.every((d) => days.includes(d))
            return (
              <button key={p.label} type="button" onClick={() => setDays(p.days)} className={chip(activo)}>
                {p.label}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_SHORT.map((label, d) => (
            <label key={d} className={`${chip(days.includes(d))} cursor-pointer select-none`}>
              <input type="checkbox" className="sr-only" checked={days.includes(d)} onChange={() => setDays((ds) => toggle(ds, d))} />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* 2. Barberos */}
      <div className="space-y-2">
        <p className={labelCls}>2 · Barberos</p>
        <div className="flex flex-wrap gap-2">
          {barbers.length > 1 && (
            <button
              type="button"
              onClick={() => setBarberIds(barberIds.length === barbers.length ? [] : barbers.map((b) => b.id))}
              className={chip(barberIds.length === barbers.length)}
            >
              Todos
            </button>
          )}
          {barbers.map((b) => (
            <label key={b.id} className={`${chip(barberIds.includes(b.id))} cursor-pointer select-none`}>
              <input type="checkbox" className="sr-only" checked={barberIds.includes(b.id)} onChange={() => setBarberIds((ids) => toggle(ids, b.id))} />
              {b.full_name}
            </label>
          ))}
        </div>
      </div>

      {/* 3. Franjas */}
      <div className="space-y-2">
        <p className={labelCls}>3 · Franjas</p>
        <div className="flex flex-wrap gap-2">
          {PLANTILLAS.map((p) => (
            <button key={p.label} type="button" onClick={() => setFranjas(p.build())} className={chip(false)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {franjas.map((f) => (
            <div key={f.key} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_auto] gap-2 items-end [&>*]:min-w-0 bg-[var(--bg3)]/40 border border-[var(--border)] rounded-lg p-2">
              <div>
                <label className={labelCls}>Desde</label>
                <input type="time" value={f.startTime} onChange={(e) => updateFranja(f.key, { startTime: e.target.value })} className={timeCls} />
              </div>
              <div>
                <label className={labelCls}>Hasta</label>
                <input type="time" value={f.endTime} onChange={(e) => updateFranja(f.key, { endTime: e.target.value })} className={timeCls} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className={labelCls}>Modo</label>
                <select value={f.mode} onChange={(e) => updateFranja(f.key, { mode: e.target.value as ScheduleMode })} className={inputCls}>
                  <option value="turno">Con turno</option>
                  <option value="orden_llegada">Orden de llegada</option>
                </select>
              </div>
              <div>
                {f.mode === 'turno' && (
                  <>
                    <label className={labelCls}>Cada (min)</label>
                    <input type="number" min={5} step={5} value={f.slotMinutes} onChange={(e) => updateFranja(f.key, { slotMinutes: e.target.value })} className={inputCls} />
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setFranjas((fs) => fs.filter((x) => x.key !== f.key))}
                className="justify-self-end text-[var(--text-muted)] hover:text-red-400 text-xs px-2 py-2"
                title="Quitar franja"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setFranjas((fs) => [...fs, franja(fs.at(-1)?.endTime ?? '09:00', '20:00', 'turno')])}
          className="text-xs text-amber-400 hover:text-amber-300"
        >
          + Agregar franja
        </button>
      </div>

      <label className="flex items-start gap-2 text-sm text-[var(--text)] cursor-pointer">
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="accent-amber-500 mt-0.5" />
        <span>
          Reemplazar lo que ya había esos días
          <span className="block text-xs text-[var(--text-muted)]">
            Si lo desmarcás, las franjas se suman a las existentes (y si se superponen no se guarda nada).
          </span>
        </span>
      </label>

      {err && <p className="text-red-400 text-xs">{err}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={aplicar}
          disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-4 py-2 rounded-lg text-xs transition-colors"
        >
          {saving ? 'Guardando...' : `Aplicar a ${days.length} día${days.length === 1 ? '' : 's'} · ${barberIds.length} barbero${barberIds.length === 1 ? '' : 's'}`}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={saving}
          className="text-[var(--text-muted)] hover:text-[var(--text)] px-4 py-2 rounded-lg text-xs border border-[var(--border-mid)]"
        >
          Cancelar
        </button>
      </div>
    </section>
  )
}

// ─── Horario semanal ────────────────────────────────────────────────────
function WeekSchedule({
  barberId,
  branchId,
  schedules,
  onChanged,
}: {
  barberId: string
  branchId: string
  schedules: BarberSchedule[]
  onChanged: () => void
}) {
  const [addingDay, setAddingDay] = useState<number | null>(null)

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        Horario semanal
      </h2>
      <div className="space-y-2">
        {WEEKDAY_LABELS.map((label, weekday) => {
          const franjas = schedules
            .filter((s) => s.weekday === weekday)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
          return (
            <div key={weekday} className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[var(--text)] text-sm font-semibold">{label}</p>
                <button
                  onClick={() => setAddingDay(addingDay === weekday ? null : weekday)}
                  className="text-xs text-amber-400 hover:text-amber-300"
                >
                  {addingDay === weekday ? 'Cancelar' : '+ Agregar franja'}
                </button>
              </div>

              {franjas.length === 0 && addingDay !== weekday ? (
                <p className="text-[var(--text-muted)] text-xs">Sin atención este día</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {franjas.map((f) => (
                    <FranjaPill key={f.id} franja={f} onDeleted={onChanged} />
                  ))}
                </div>
              )}

              {addingDay === weekday && (
                <FranjaForm
                  barberId={barberId}
                  branchId={branchId}
                  weekday={weekday}
                  onCreated={() => { onChanged(); setAddingDay(null) }}
                  onCancel={() => setAddingDay(null)}
                />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function FranjaPill({ franja, onDeleted }: { franja: BarberSchedule; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteBarberSchedule(franja.id)
      onDeleted()
    } catch (e) {
      await alertDialog(e instanceof Error ? e.message : 'Error al borrar')
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs border ${
      franja.mode === 'turno'
        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
        : 'bg-sky-500/10 border-sky-500/30 text-sky-300'
    }`}>
      <span className="font-semibold">
        {franja.start_time.slice(0, 5)}–{franja.end_time.slice(0, 5)}
      </span>
      <span className="opacity-80">
        {franja.mode === 'turno' ? `con turno (${franja.slot_minutes} min)` : 'orden de llegada'}
      </span>
      {confirming ? (
        <span className="flex items-center gap-1">
          <button onClick={handleDelete} disabled={deleting} className="text-red-400 font-semibold">
            {deleting ? '...' : 'Sí'}
          </button>
          <button onClick={() => setConfirming(false)} className="opacity-60">No</button>
        </span>
      ) : (
        <button onClick={() => setConfirming(true)} className="opacity-60 hover:opacity-100">✕</button>
      )}
    </div>
  )
}

function FranjaForm({
  barberId,
  branchId,
  weekday,
  onCreated,
  onCancel,
}: {
  barberId: string
  branchId: string
  weekday: number
  onCreated: () => void
  onCancel: () => void
}) {
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('13:00')
  const [mode, setMode] = useState<ScheduleMode>('turno')
  const [slotMinutes, setSlotMinutes] = useState('30')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (startTime >= endTime) {
      setErr('El horario de fin tiene que ser posterior al de inicio')
      void errorDialog('El horario de fin tiene que ser posterior al de inicio')
      return
    }
    const slot = mode === 'turno' ? parseInt(slotMinutes, 10) : null
    if (mode === 'turno' && (isNaN(slot as number) || (slot as number) <= 0)) {
      setErr('Indicá cada cuántos minutos se puede reservar')
      void errorDialog('Indicá cada cuántos minutos se puede reservar')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await createBarberSchedule({
        barberId, branchId, weekday, startTime, endTime, mode, slotMinutes: slot,
      })
      onCreated()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al guardar'
      setErr(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-[var(--border)] space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 [&>*]:min-w-0">
        <div>
          <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Desde</label>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
            className="w-full min-w-0 max-w-[8.5rem] tabular-nums bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Hasta</label>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
            className="w-full min-w-0 max-w-[8.5rem] tabular-nums bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Modo</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as ScheduleMode)}
            className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500">
            <option value="turno">Con turno</option>
            <option value="orden_llegada">Orden de llegada</option>
          </select>
        </div>
        {mode === 'turno' && (
          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Cada (min)</label>
            <input type="number" min={5} step={5} value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value)}
              className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
          </div>
        )}
      </div>
      {err && <p className="text-red-400 text-xs">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-4 py-1.5 rounded-lg text-xs transition-colors">
          {saving ? 'Guardando...' : 'Agregar'}
        </button>
        <button type="button" onClick={onCancel}
          className="text-[var(--text-muted)] hover:text-[var(--text)] px-4 py-1.5 rounded-lg text-xs border border-[var(--border-mid)]">
          Cancelar
        </button>
      </div>
    </form>
  )
}

// ─── Excepciones ────────────────────────────────────────────────────────
function ExceptionsPanel({
  branchId,
  barbers,
  exceptions,
  myId,
  onChanged,
}: {
  branchId: string
  barbers: Profile[]
  exceptions: ScheduleException[]
  myId: string
  onChanged: () => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [date, setDate] = useState(todayISO())
  const [scope, setScope] = useState<'sucursal' | string>('sucursal')
  const [closedAllDay, setClosedAllDay] = useState(true)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('18:00')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    try {
      await createScheduleException({
        branchId,
        exceptionDate: date,
        barberId: scope === 'sucursal' ? null : scope,
        closedAllDay,
        startTime: closedAllDay ? null : startTime,
        endTime: closedAllDay ? null : endTime,
        reason: reason.trim() || null,
      })
      setShowForm(false)
      setReason('')
      onChanged()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al guardar'
      setErr(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteScheduleException(id)
      onChanged()
    } catch (e) {
      await alertDialog(e instanceof Error ? e.message : 'Error al borrar')
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          Excepciones — feriados, salidas antes, vacaciones
        </h2>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="text-xs text-amber-400 hover:text-amber-300">
            + Agregar excepción
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-[var(--bg2)] border border-[var(--border-mid)] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Fecha</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Aplica a</label>
              <select value={scope} onChange={(e) => setScope(e.target.value)}
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500">
                <option value="sucursal">Toda la sucursal (feriado)</option>
                {barbers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="closedAllDay"
              checked={closedAllDay}
              onChange={(e) => setClosedAllDay(e.target.checked)}
              className="accent-amber-500"
            />
            <label htmlFor="closedAllDay" className="text-sm text-[var(--text)]">
              No se atiende nada ese día
            </label>
          </div>

          {!closedAllDay && (
            <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
              <div>
                <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">No atiende desde</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                  className="w-full min-w-0 max-w-[8.5rem] tabular-nums bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Hasta</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                  className="w-full min-w-0 max-w-[8.5rem] tabular-nums bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Motivo (opcional)</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: Feriado, vacaciones, turno médico"
              className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] placeholder-[var(--text-muted)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
          </div>

          {err && <p className="text-red-400 text-xs">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-4 py-1.5 rounded-lg text-xs">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text)] px-4 py-1.5 rounded-lg text-xs border border-[var(--border-mid)]">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {exceptions.length === 0 ? (
        <p className="text-[var(--text-muted)] text-xs">No hay excepciones cargadas de acá en adelante.</p>
      ) : (
        <div className="space-y-2">
          {exceptions.map((exc) => {
            const barbero = barbers.find((b) => b.id === exc.barber_id)
            // El barbero se bloquea a sí mismo (create_schedule_exception_barber
            // siempre manda created_by = auth.uid() = barber_id) -- si no
            // coinciden, lo cargó un admin desde acá.
            const bloqueadoPorBarbero = exc.created_by !== null && exc.created_by === exc.barber_id
            const bloqueadoPorMi = exc.created_by === myId
            return (
              <div key={exc.id} className="bg-[var(--bg2)] border border-[var(--border)] rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="text-[var(--text)] font-semibold">
                    {new Date(exc.exception_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="text-[var(--text-muted)] mx-2">·</span>
                  <span className="text-[var(--text-muted)]">
                    {barbero ? barbero.full_name : 'Toda la sucursal'}
                  </span>
                  <span className="text-[var(--text-muted)] mx-2">·</span>
                  <span className="text-[var(--text-muted)]">
                    {exc.closed_all_day ? 'Cerrado' : `${exc.start_time?.slice(0,5)}–${exc.end_time?.slice(0,5)}`}
                  </span>
                  {exc.reason && <span className="text-[var(--text-muted)] ml-2">({exc.reason})</span>}
                  <span className="ml-2 text-[0.65rem] uppercase tracking-wide text-amber-500/80 border border-amber-500/30 rounded px-1.5 py-0.5">
                    {bloqueadoPorBarbero ? `Bloqueado por ${barbero?.full_name ?? 'el barbero'}` : bloqueadoPorMi ? 'Bloqueado por vos' : 'Bloqueado por un admin'}
                  </span>
                </div>
                <button onClick={() => handleDelete(exc.id)} className="text-[var(--text-muted)] hover:text-red-400 text-xs flex-shrink-0">
                  Borrar
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
