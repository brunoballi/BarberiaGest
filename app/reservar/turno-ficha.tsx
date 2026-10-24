'use client'

import type { ReactNode } from 'react'
import { slotDateLong, slotDateTimeShort, slotTime, type AppointmentLookup } from '@/lib/supabase/booking'
import './reservar.css'

/**
 * Ficha de un turno: estado, fecha y horario, servicio, profesional, total,
 * dirección y código. La usan las dos pantallas donde el cliente ve "su" turno
 * (la confirmación apenas reserva y "Gestionar mi turno") para que se vean
 * igual y no se desparejen.
 */

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

/** Cómo se muestra cada estado del turno: etiqueta de color y título de la ficha. */
const ESTADOS: Record<string, { label: string; tono: 'ok' | 'info' | 'muted' | 'danger'; titulo: string; detalle?: string }> = {
  reservado: { label: 'Reservado', tono: 'ok', titulo: 'Tu turno está reservado' },
  llego: { label: 'Llegaste', tono: 'info', titulo: 'Ya figurás como llegado' },
  atendido: { label: 'Atendido', tono: 'muted', titulo: 'Turno atendido' },
  no_vino: { label: 'No asististe', tono: 'muted', titulo: 'No asististe a este turno' },
  cancelado: { label: 'Cancelado', tono: 'danger', titulo: 'Tu turno fue cancelado', detalle: 'Tu horario quedó libre para otra reserva.' },
}

/** Enlace de "Cómo llegar": por coordenadas si la sucursal las cargó, si no por dirección. */
function mapsHref(a: AppointmentLookup): string | null {
  if (a.branch_latitude != null && a.branch_longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${a.branch_latitude},${a.branch_longitude}`
  }
  if (a.branch_address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.branch_name ?? ''} ${a.branch_address}`.trim())}`
  }
  return null
}

export default function TurnoFicha({
  appt,
  titulo,
  bajoTitulo,
  centrado = false,
  mostrarReferencia = true,
  children,
}: {
  appt: AppointmentLookup
  /** Centra la cabecera (etiqueta, título y lo que va debajo). Lo usa la
   * confirmación, donde arriba hay un tilde centrado; la ficha de "Gestionar
   * mi turno" va alineada a la izquierda. El detalle de abajo siempre queda
   * en columnas. */
  centrado?: boolean
  /** Pisa el título según el estado (ej. "Tu turno quedó reservado" en la confirmación). */
  titulo?: string
  /** Va justo debajo del título (en la confirmación: el código destacado). */
  bajoTitulo?: ReactNode
  /** En la confirmación el código ya va en una caja destacada arriba. */
  mostrarReferencia?: boolean
  /** Lo que va entre la dirección y el pie (botones, avisos). */
  children?: ReactNode
}) {
  const estado = ESTADOS[appt.status] ?? { label: appt.status, tono: 'muted' as const, titulo: 'Tu turno' }
  const mapa = mapsHref(appt)

  return (
    <>
      <div className={centrado ? 'bk-ficha-top bk-ficha-top--center' : 'bk-ficha-top'}>
        <div className="bk-detail-head">
          <p className="bk-section">Tu reserva</p>
          <span className={`bk-badge bk-badge--${estado.tono}`}>{estado.label}</span>
        </div>
        <h1 className="bk-title">{titulo ?? estado.titulo}</h1>
        {estado.detalle && <p className="bk-muted bk-mb">{estado.detalle}</p>}
        {bajoTitulo}
      </div>

      <div className="bk-kv-list">
        <div className="bk-kv">
          <span className="bk-kv__label">Fecha</span>
          <span className="bk-kv__value">{slotDateLong(appt.starts_at)}</span>
        </div>
        <div className="bk-kv">
          <span className="bk-kv__label">Horario</span>
          <span className="bk-kv__value">{slotTime(appt.starts_at)} – {slotTime(appt.ends_at)}</span>
        </div>
        <div className="bk-kv">
          <span className="bk-kv__label">A nombre de</span>
          <span className="bk-kv__value">{appt.client_name}</span>
        </div>
        <div className="bk-kv">
          <span className="bk-kv__label">{appt.services.length > 1 ? 'Servicios' : 'Servicio'}</span>
          <span className="bk-kv__value">
            {appt.services.map((s) => (
              <span key={s.name} className="bk-kv__line">
                {s.name}
                {s.duration_min ? <span className="bk-kv__sub">{s.duration_min} minutos</span> : null}
              </span>
            ))}
          </span>
        </div>
        {appt.barber_name && (
          <div className="bk-kv">
            <span className="bk-kv__label">Profesional</span>
            <span className="bk-kv__value">{appt.barber_name}</span>
          </div>
        )}
        <div className="bk-kv">
          <span className="bk-kv__label">Método de pago</span>
          <span className="bk-kv__value">Se paga en el local</span>
        </div>
        <div className="bk-kv bk-kv--total">
          <span className="bk-kv__label">Total</span>
          <span className="bk-kv__value">{formatARS(appt.total_price)}</span>
        </div>
      </div>

      {(appt.branch_name || appt.branch_address) && (
        <div className="bk-place">
          <p className="bk-section">Dirección</p>
          {appt.branch_name && <p className="bk-place__name">{appt.branch_name}</p>}
          {appt.branch_address && <p className="bk-muted">{appt.branch_address}</p>}
          {mapa && (
            <a className="bk-place__link" href={mapa} target="_blank" rel="noopener noreferrer">Cómo llegar</a>
          )}
        </div>
      )}

      {children}

      <div className="bk-meta">
        {mostrarReferencia && (
          <div className="bk-meta__row"><span>Referencia</span><span className="bk-meta__code">{appt.reference}</span></div>
        )}
        {appt.created_at && (
          <div className="bk-meta__row"><span>Fecha de creación</span><span>{slotDateTimeShort(appt.created_at)}</span></div>
        )}
        {appt.status === 'cancelado' && appt.cancelled_at && (
          <div className="bk-meta__row"><span>Cancelado el</span><span>{slotDateTimeShort(appt.cancelled_at)}</span></div>
        )}
      </div>
    </>
  )
}
