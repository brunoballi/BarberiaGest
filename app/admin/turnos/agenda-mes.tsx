'use client'

import type { AppointmentStatus, ScheduleException } from '@/lib/supabase/appointments'
import { fechaAR, franja, hora, iso } from './agenda-rango'

/** Lo mínimo que la celda del calendario necesita de un turno (sirve para el admin y para el barbero). */
export interface TurnoMes {
  id: string
  starts_at: string
  client_name: string
  status: AppointmentStatus
  barber_name?: string
}

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Mismos colores por estado que usa el resto de la agenda.
const ESTADO: Record<AppointmentStatus, string> = {
  reservado: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  llego: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  atendido: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  no_vino: 'bg-red-500/15 text-red-300 border-red-500/30',
  cancelado: 'bg-zinc-700/40 text-zinc-500 border-zinc-700',
}

const MAX_VISIBLES = 3

/**
 * Calendario del mes como el de Google: una grilla de semanas (filas) por días (columnas, lunes a
 * domingo), con el número de cada día y, adentro, una tarjetita por turno. Los días de relleno de
 * los meses vecinos se ven apagados y sin turnos (solo se cargan los del mes visto). Tocar una
 * tarjeta abre el turno; tocar el número del día (o "+N más") abre ese día en la grilla horaria.
 */
export default function AgendaMes<T extends TurnoMes>({
  date,
  turnos,
  bloqueos,
  onSelect,
  onIrAlDia,
}: {
  /** Cualquier fecha del mes a mostrar (YYYY-MM-DD). */
  date: string
  turnos: T[]
  bloqueos: ScheduleException[]
  onSelect: (t: T) => void
  onIrAlDia: (dia: string) => void
}) {
  const ref = new Date(`${date}T12:00:00`)
  const anio = ref.getFullYear()
  const mes = ref.getMonth()
  const primero = new Date(anio, mes, 1, 12)
  const diasDelMes = new Date(anio, mes + 1, 0).getDate()
  const relleno = (primero.getDay() + 6) % 7 // lunes = 0
  const celdas = Math.ceil((relleno + diasDelMes) / 7) * 7
  const hoy = iso(new Date())

  const dias: { dia: string; delMes: boolean }[] = []
  for (let i = 0; i < celdas; i++) {
    const d = new Date(anio, mes, 1 - relleno + i, 12)
    dias.push({ dia: iso(d), delMes: d.getMonth() === mes })
  }

  const turnosPorDia = new Map<string, T[]>()
  for (const t of turnos) {
    if (t.status === 'cancelado') continue
    const k = fechaAR(t.starts_at)
    const lista = turnosPorDia.get(k)
    if (lista) lista.push(t)
    else turnosPorDia.set(k, [t])
  }
  for (const lista of turnosPorDia.values()) lista.sort((a, b) => a.starts_at.localeCompare(b.starts_at))

  return (
    <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {DIAS.map((n) => (
          <div key={n} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {n}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map(({ dia, delMes }, i) => {
          const delDia = delMes ? (turnosPorDia.get(dia) ?? []) : []
          const bloqueosDelDia = delMes ? bloqueos.filter((x) => x.exception_date === dia) : []
          const visibles = delDia.slice(0, MAX_VISIBLES)
          const extra = delDia.length - visibles.length
          const esHoy = dia === hoy
          const numero = Number(dia.slice(8))
          return (
            <div
              key={dia}
              className={`min-h-[84px] sm:min-h-[116px] p-1 border-[var(--border)] ${i % 7 !== 6 ? 'border-r' : ''} ${i < celdas - 7 ? 'border-b' : ''} ${
                delMes ? '' : 'bg-[var(--bg)]/40 opacity-50'
              }`}
            >
              <div className="flex justify-center sm:justify-start mb-1">
                <button
                  type="button"
                  onClick={() => delMes && onIrAlDia(dia)}
                  disabled={!delMes}
                  title={delMes ? 'Ver este día en la grilla' : undefined}
                  className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold ${
                    esHoy ? 'bg-amber-500 text-zinc-950' : 'text-[var(--text)] hover:bg-[var(--bg3)]'
                  }`}
                >
                  {numero}
                </button>
              </div>
              <div className="space-y-0.5">
                {bloqueosDelDia.length > 0 && (
                  <div
                    className="px-1 py-0.5 rounded border border-zinc-600/60 bg-zinc-700/30 text-[10px] sm:text-[11px] text-zinc-300 truncate"
                    title={bloqueosDelDia.map((x) => `${franja(x)}${x.reason ? ` · ${x.reason}` : ''}`).join('\n')}
                  >
                    🔒 {bloqueosDelDia.length === 1 ? franja(bloqueosDelDia[0]) : `${bloqueosDelDia.length} bloqueos`}
                  </div>
                )}
                {visibles.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelect(t)}
                    title={`${hora(t.starts_at)} · ${t.client_name}${t.barber_name ? ` · ${t.barber_name}` : ''}`}
                    className={`block w-full text-left px-1 py-0.5 rounded border text-[10px] sm:text-[11px] leading-tight truncate ${ESTADO[t.status]}`}
                  >
                    <span className="font-mono font-semibold">{hora(t.starts_at)}</span>
                    <span className="hidden sm:inline"> {t.client_name}</span>
                  </button>
                ))}
                {extra > 0 && (
                  <button
                    type="button"
                    onClick={() => onIrAlDia(dia)}
                    className="block w-full text-left px-1 text-[10px] sm:text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    +{extra} más
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
