'use client'

import { useEffect, useState } from 'react'
import type { Profile } from '@/lib/supabase/database.types'
import type { AgendaAppointment, AppointmentStatus, ScheduleException } from '@/lib/supabase/appointments'
import './agenda-grid.css'

const TZ = 'America/Argentina/Buenos_Aires'
const PX_PER_MIN = 1.6          // 30 min = 48 px
const MIN_HOUR = 0              // la grilla muestra el día completo, de 00:00 a 00:00
const MAX_HOUR = 24

const fmtMinutes = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
})

/** Minutos desde las 00:00 en hora de Argentina. */
function minutesOfDay(iso: string): number {
  const [h, m] = fmtMinutes.format(new Date(iso)).split(':').map(Number)
  return (h % 24) * 60 + m
}

function hora(iso: string): string {
  return fmtMinutes.format(new Date(iso))
}

/** "15:30:00" -> minutos desde las 00:00 */
function hhmm(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STATUS_CLASS: Record<AppointmentStatus, string> = {
  reservado: 'ag-block--reservado',
  llego: 'ag-block--llego',
  atendido: 'ag-block--atendido',
  no_vino: 'ag-block--no_vino',
  cancelado: 'ag-block--cancelado',
}

/**
 * Agenda del día en columnas, una por barbero, con las horas a la izquierda.
 * Solo dibuja: las acciones (llegó, atendido, mover, cancelar) las maneja el
 * padre al tocar un turno. Los turnos cancelados no se dibujan acá (no ocupan
 * horario); el padre los lista aparte.
 */
export default function AgendaGrid({
  barbers,
  appointments,
  date,
  bloqueos = [],
  onSelect,
}: {
  barbers: Profile[]
  appointments: AgendaAppointment[]
  date: string
  /** Bloqueos (franco, médico, comida, feriado) de este día. barber_id nulo = toda la sucursal. */
  bloqueos?: ScheduleException[]
  onSelect: (a: AgendaAppointment) => void
}) {
  const activos = appointments.filter((a) => a.status !== 'cancelado')

  // Rango de horas: lo de siempre, ampliado si hay turnos fuera de ese rango.
  let startHour = MIN_HOUR
  let endHour = MAX_HOUR
  for (const a of activos) {
    startHour = Math.min(startHour, Math.floor(minutesOfDay(a.starts_at) / 60))
    endHour = Math.max(endHour, Math.ceil(minutesOfDay(a.ends_at) / 60))
  }
  for (const b of bloqueos) {
    if (b.closed_all_day || !b.start_time || !b.end_time) continue
    startHour = Math.min(startHour, Math.floor(hhmm(b.start_time) / 60))
    endHour = Math.max(endHour, Math.ceil(hhmm(b.end_time) / 60))
  }
  endHour = Math.min(Math.max(endHour, startHour + 1), 24)
  const startMin = startHour * 60
  const totalHeight = (endHour - startHour) * 60 * PX_PER_MIN
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)

  // Línea de "ahora": solo si se está viendo hoy. Se refresca cada minuto.
  const [nowMin, setNowMin] = useState<number | null>(null)
  useEffect(() => {
    function tick() {
      setNowMin(date === todayISO() ? minutesOfDay(new Date().toISOString()) : null)
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [date])

  const porBarbero = new Map<string, AgendaAppointment[]>()
  for (const a of activos) {
    const lista = porBarbero.get(a.barber_id) ?? []
    lista.push(a)
    porBarbero.set(a.barber_id, lista)
  }

  const cols = `3.5rem repeat(${Math.max(barbers.length, 1)}, minmax(11rem, 1fr))`

  return (
    <div className="ag-scroll">
      <div className="ag-grid" style={{ gridTemplateColumns: cols }}>
        {/* Encabezado fijo: un casillero vacío sobre las horas + un barbero por columna */}
        <div className="ag-corner" />
        {barbers.map((b) => {
          const n = porBarbero.get(b.id)?.length ?? 0
          return (
            <div key={b.id} className="ag-head">
              {b.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.avatar_url} alt="" className="ag-avatar" />
              ) : (
                <span className="ag-avatar ag-avatar--initials">{initials(b.full_name)}</span>
              )}
              <span className="ag-head__name">{b.full_name}</span>
              <span className="ag-head__role">Barbero</span>
              <span className="ag-head__count">{n} {n === 1 ? 'turno' : 'turnos'}</span>
            </div>
          )
        })}

        {/* Columna de horas */}
        <div className="ag-hours" style={{ height: totalHeight }}>
          {hours.map((h, i) => (
            <span key={h} className="ag-hours__label" style={{ top: i * 60 * PX_PER_MIN }}>
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>

        {/* Una columna por barbero con sus turnos posicionados por minuto */}
        {barbers.map((b) => (
          <div key={b.id} className="ag-col" style={{ height: totalHeight }}>
            {nowMin !== null && nowMin >= startMin && nowMin <= endHour * 60 && (
              <div className="ag-now" style={{ top: (nowMin - startMin) * PX_PER_MIN }} />
            )}
            {bloqueos
              .filter((x) => x.barber_id === null || x.barber_id === b.id)
              .map((x) => {
                const desde = x.closed_all_day || !x.start_time ? startMin : Math.max(hhmm(x.start_time), startMin)
                const hasta = x.closed_all_day || !x.end_time ? endHour * 60 : Math.min(hhmm(x.end_time), endHour * 60)
                if (hasta <= desde) return null
                const etiqueta = x.closed_all_day ? 'Bloqueado todo el día' : `Bloqueado ${x.start_time?.slice(0, 5)}–${x.end_time?.slice(0, 5)}`
                return (
                  <div
                    key={x.id}
                    className="ag-bloqueo"
                    style={{ top: (desde - startMin) * PX_PER_MIN, height: (hasta - desde) * PX_PER_MIN }}
                    title={`${etiqueta}${x.reason ? ' · ' + x.reason : ''}${x.barber_id === null ? ' (toda la sucursal)' : ''}`}
                  >
                    <span className="ag-bloqueo__label">🔒 {x.reason || 'Bloqueado'}</span>
                  </div>
                )
              })}
            {(porBarbero.get(b.id) ?? []).map((a) => {
              const top = (minutesOfDay(a.starts_at) - startMin) * PX_PER_MIN
              const dur = Math.max(minutesOfDay(a.ends_at) - minutesOfDay(a.starts_at), 15)
              const height = dur * PX_PER_MIN - 2
              const compact = dur <= 30
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelect(a)}
                  className={`ag-block ${STATUS_CLASS[a.status]} ${compact ? 'ag-block--compact' : ''}`}
                  style={{ top, height }}
                  title={`${hora(a.starts_at)}–${hora(a.ends_at)} · ${a.client_name} · ${a.services.map((s) => s.name).join(', ')}`}
                >
                  <span className="ag-block__time">{hora(a.starts_at)} – {hora(a.ends_at)}</span>
                  <span className="ag-block__client">{a.client_name}</span>
                  {!compact && (
                    <span className="ag-block__services">{a.services.map((s) => s.name).join(', ')}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
