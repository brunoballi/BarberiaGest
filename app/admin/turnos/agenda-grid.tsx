'use client'

import { useEffect, useState } from 'react'
import type { Profile } from '@/lib/supabase/database.types'
import type { AppointmentStatus, ScheduleException } from '@/lib/supabase/appointments'
import type { DayHours } from '@/lib/supabase/booking'
import './agenda-grid.css'

const TZ = 'America/Argentina/Buenos_Aires'
const PX_PER_MIN = 1.6          // 30 min = 48 px
// Sin horario de la sucursal cargado (o cerrada ese día) la grilla muestra
// 9:00 a 21:00; con horario, el de ese día. En los dos casos se amplía si hay
// turnos o bloqueos fuera de ese rango, para que nunca queden ocultos.
const DEFAULT_START_HOUR = 9
const DEFAULT_END_HOUR = 21

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

/** Rango de horas que dibuja la grilla ese día, y los minutos exactos de apertura y cierre
 * de la sucursal (para marcar como cerrado lo que queda afuera, ej. 9:00 a 9:30 si abre 9:30). */
interface Atencion {
  start: number
  end: number
  /** Minutos desde las 00:00. Sin horario cargado (o sin ningún día cargado): null y no se marca nada. */
  abreMin: number | null
  cierraMin: number | null
  /** Hay horario en otros días pero este está marcado cerrado. */
  cerradoTodoElDia: boolean
}

function horasDeAtencion(date: string, businessHours?: DayHours[]): Atencion {
  const porDefecto: Atencion = { start: DEFAULT_START_HOUR, end: DEFAULT_END_HOUR, abreMin: null, cierraMin: null, cerradoTodoElDia: false }
  // Misma regla que la base (_sucursal_cerrada_en): sin ningún día cargado no se restringe nada.
  if (!businessHours?.some((h) => h.open !== h.close)) return porDefecto
  const dia = businessHours.find((h) => h.weekday === new Date(date + 'T12:00:00').getDay())
  if (!dia || dia.open === dia.close) return { ...porDefecto, cerradoTodoElDia: true }
  const abre = hhmm(dia.open)
  const cierra = hhmm(dia.close)
  // Cierre "00:00" (o antes de abrir) = pasa la medianoche: la grilla llega hasta las 24.
  const fin = cierra <= abre ? 24 * 60 : cierra
  return { start: Math.floor(abre / 60), end: Math.ceil(fin / 60), abreMin: abre, cierraMin: fin, cerradoTodoElDia: false }
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

/** Lo mínimo que la grilla necesita de un turno: sirve tanto para la agenda del
 * admin como para la del barbero (que arma `barber_id` con su propio id). */
export interface GridAppointment {
  id: string
  barber_id: string
  client_name: string
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  services: { name: string }[]
}

/**
 * Agenda del día en columnas, una por barbero, con las horas a la izquierda.
 * Solo dibuja: las acciones (llegó, atendido, mover, cancelar) las maneja el
 * padre al tocar un turno. Los turnos cancelados no se dibujan acá (no ocupan
 * horario); el padre los lista aparte.
 */
export default function AgendaGrid<T extends GridAppointment>({
  barbers,
  appointments,
  date,
  bloqueos = [],
  businessHours,
  onSelect,
}: {
  barbers: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>[]
  appointments: T[]
  date: string
  /** Bloqueos (franco, médico, comida, feriado) de este día. barber_id nulo = toda la sucursal. */
  bloqueos?: ScheduleException[]
  /** Horario de atención de la sucursal (los 7 días): define el rango de horas que se dibuja. */
  businessHours?: DayHours[]
  onSelect: (a: T) => void
}) {
  const activos = appointments.filter((a) => a.status !== 'cancelado')

  // Rango de horas: lo de siempre, ampliado si hay turnos fuera de ese rango.
  const atencion = horasDeAtencion(date, businessHours)
  let startHour = atencion.start
  let endHour = atencion.end
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
  // Una etiqueta por hora más la del cierre (ej. 09:00 ... 21:00).
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)

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

  // Tramos cerrados dentro de lo que se dibuja (en minutos desde las 00:00).
  const cerrados: { desde: number; hasta: number; etiqueta: string; titulo: string }[] = []
  const finMin = endHour * 60
  const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  if (atencion.cerradoTodoElDia) {
    cerrados.push({ desde: startMin, hasta: finMin, etiqueta: 'Sucursal cerrada', titulo: 'La sucursal no atiende este día' })
  } else {
    if (atencion.abreMin !== null && atencion.abreMin > startMin) {
      cerrados.push({ desde: startMin, hasta: atencion.abreMin, etiqueta: 'Cerrado', titulo: `La sucursal abre a las ${hm(atencion.abreMin)}` })
    }
    if (atencion.cierraMin !== null && atencion.cierraMin < finMin) {
      cerrados.push({ desde: atencion.cierraMin, hasta: finMin, etiqueta: 'Cerrado', titulo: `La sucursal cierra a las ${hm(atencion.cierraMin)}` })
    }
  }

  const porBarbero = new Map<string, T[]>()
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
              {String(h % 24).padStart(2, '0')}:00
            </span>
          ))}
        </div>

        {/* Una columna por barbero con sus turnos posicionados por minuto */}
        {barbers.map((b) => (
          <div key={b.id} className="ag-col" style={{ height: totalHeight }}>
            {nowMin !== null && nowMin >= startMin && nowMin <= endHour * 60 && (
              <div className="ag-now" style={{ top: (nowMin - startMin) * PX_PER_MIN }} />
            )}
            {/* Lo que queda fuera del horario de la sucursal (antes de abrir / después de cerrar) se marca
                como un bloqueo más, y la base tampoco deja cargar turnos ahí. */}
            {cerrados.map((c) => (
              <div
                key={c.desde}
                className="ag-bloqueo"
                style={{ top: (c.desde - startMin) * PX_PER_MIN, height: (c.hasta - c.desde) * PX_PER_MIN }}
                title={c.titulo}
              >
                <span className="ag-bloqueo__label">🔒 {c.etiqueta}</span>
              </div>
            ))}
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
