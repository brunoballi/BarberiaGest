'use client'

import type { AgendaAppointment, ScheduleException } from '@/lib/supabase/appointments'
import { APPOINTMENT_STATUS_LABELS } from '@/lib/supabase/appointments'

export type Rango = 'dia' | 'semana' | 'mes'

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Primer y último día del período que contiene `date`: la semana va de lunes a domingo. */
export function limitesDelRango(date: string, rango: Rango): { desde: string; hasta: string } {
  const d = new Date(`${date}T12:00:00`)
  if (rango === 'dia') return { desde: date, hasta: date }
  if (rango === 'semana') {
    const lunes = new Date(d)
    lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const domingo = new Date(lunes)
    domingo.setDate(lunes.getDate() + 6)
    return { desde: iso(lunes), hasta: iso(domingo) }
  }
  return { desde: iso(new Date(d.getFullYear(), d.getMonth(), 1)), hasta: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
}

export function diasDelRango(desde: string, hasta: string): string[] {
  const out: string[] = []
  const d = new Date(`${desde}T12:00:00`)
  while (iso(d) <= hasta) {
    out.push(iso(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** Mueve la fecha de referencia un período (un día, una semana o un mes). */
export function moverRango(date: string, rango: Rango, sentido: 1 | -1): string {
  const d = new Date(`${date}T12:00:00`)
  if (rango === 'dia') d.setDate(d.getDate() + sentido)
  else if (rango === 'semana') d.setDate(d.getDate() + 7 * sentido)
  else d.setMonth(d.getMonth() + sentido, 1)
  return iso(d)
}

export function tituloDelRango(date: string, rango: Rango): string {
  const { desde, hasta } = limitesDelRango(date, rango)
  const fmt = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T12:00:00`).toLocaleDateString('es-AR', o)
  if (rango === 'mes') return fmt(desde, { month: 'long', year: 'numeric' })
  if (rango === 'semana') return `${fmt(desde, { day: 'numeric', month: 'short' })} al ${fmt(hasta, { day: 'numeric', month: 'short' })}`
  return fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })
}

function hora(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
}

/** Fecha (YYYY-MM-DD) de un instante, en la hora de Argentina. */
function fechaAR(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

function franja(x: ScheduleException): string {
  return x.closed_all_day || !x.start_time || !x.end_time ? 'todo el día' : `${x.start_time.slice(0, 5)} a ${x.end_time.slice(0, 5)}`
}

/**
 * Vista de semana o mes: una lista por día con los bloqueos y los turnos, para cuando la grilla de
 * un solo día no alcanza. Respeta el filtro de barbero que ya aplicó quien la usa.
 */
export default function AgendaRango({
  dias,
  turnos,
  bloqueos,
  quien,
  onSelect,
  onIrAlDia,
}: {
  dias: string[]
  turnos: AgendaAppointment[]
  bloqueos: ScheduleException[]
  quien: (x: ScheduleException) => string
  onSelect: (a: AgendaAppointment) => void
  onIrAlDia: (d: string) => void
}) {
  const hoy = iso(new Date())
  return (
    <div className="space-y-3">
      {dias.map((dia) => {
        const delDia = turnos
          .filter((a) => a.status !== 'cancelado' && fechaAR(a.starts_at) === dia)
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        const bloqueosDelDia = bloqueos.filter((x) => x.exception_date === dia)
        const etiqueta = new Date(`${dia}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
        const vacio = delDia.length === 0 && bloqueosDelDia.length === 0
        return (
          <section key={dia} className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => onIrAlDia(dia)}
              className="w-full flex items-center justify-between px-4 py-2 text-left border-b border-[var(--border)] hover:bg-[var(--bg3)]"
              title="Ver este día en la grilla"
            >
              <span className="text-sm font-semibold capitalize text-[var(--text)]">
                {etiqueta}
                {dia === hoy && <span className="ml-2 text-xs text-amber-400">Hoy</span>}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {delDia.length} {delDia.length === 1 ? 'turno' : 'turnos'}
              </span>
            </button>
            {vacio ? (
              <p className="px-4 py-2 text-xs text-[var(--text-muted)]">Sin turnos.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {bloqueosDelDia.map((x) => (
                  <li key={x.id} className="px-4 py-2 text-sm text-[var(--text)] flex items-start gap-2">
                    <span aria-hidden="true">🔒</span>
                    <span>
                      <span className="font-semibold">{quien(x)}</span>
                      <span className="text-[var(--text-muted)]"> no acepta turnos </span>
                      <span className="font-semibold">{franja(x)}</span>
                      {x.reason && <span className="text-[var(--text-muted)]"> · {x.reason}</span>}
                    </span>
                  </li>
                ))}
                {delDia.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(a)}
                      className="w-full text-left px-4 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-0.5 hover:bg-[var(--bg3)]"
                    >
                      <span className="font-mono font-semibold text-[var(--text)]">{hora(a.starts_at)}</span>
                      <span className="text-[var(--text)]">{a.client_name}</span>
                      <span className="text-[var(--text-muted)]">
                        {a.barber_name} · {a.services.map((s) => s.name).join(' + ')}
                      </span>
                      <span className="ml-auto text-xs text-[var(--text-muted)]">{APPOINTMENT_STATUS_LABELS[a.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
