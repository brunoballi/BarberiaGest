'use client'

import type { ScheduleException } from '@/lib/supabase/appointments'

function fechaCorta(iso: string): string {
  const [, m, d] = iso.split('-')
  const dia = new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short' })
  return `${dia} ${d}/${m}`
}

function franja(x: ScheduleException): string {
  return x.closed_all_day || !x.start_time || !x.end_time
    ? 'todo el día'
    : `${x.start_time.slice(0, 5)} a ${x.end_time.slice(0, 5)}`
}

/**
 * Lista escrita de los bloqueos (franco, médico, comida, feriado): los del día
 * que se está viendo y los próximos. La grilla ya los dibuja con una trama, pero
 * en una columna que puede quedar fuera de pantalla o en otro día; acá se leen de un vistazo.
 *
 * `bloqueos` trae todo desde el día visto en adelante. `quien` devuelve el nombre
 * de quien bloquea (el barbero, o "Toda la sucursal" si barber_id es nulo).
 *
 * Con `onEditar` / `onQuitar`, los bloqueos que `puedeGestionar` acepta (los que cargó el propio
 * barbero) muestran los botones "Editar" y "Quitar". Sin esas props es solo una lista de lectura.
 */
export default function BloqueosResumen({
  bloqueos,
  date,
  quien,
  puedeGestionar,
  onEditar,
  onQuitar,
}: {
  bloqueos: ScheduleException[]
  date: string
  quien: (x: ScheduleException) => string
  puedeGestionar?: (x: ScheduleException) => boolean
  onEditar?: (x: ScheduleException) => void
  onQuitar?: (x: ScheduleException) => void
}) {
  const delDia = bloqueos.filter((x) => x.exception_date === date)
  const proximos = bloqueos.filter((x) => x.exception_date > date)
  if (delDia.length === 0 && proximos.length === 0) return null

  const acciones = (x: ScheduleException) =>
    (onEditar || onQuitar) && puedeGestionar?.(x) ? (
      <span className="inline-flex shrink-0 gap-1.5 ml-2 align-middle">
        {onEditar && (
          <button
            type="button"
            onClick={() => onEditar(x)}
            className="text-xs px-2.5 py-1 rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-700"
          >
            Editar
          </button>
        )}
        {onQuitar && (
          <button
            type="button"
            onClick={() => onQuitar(x)}
            className="text-xs px-2.5 py-1 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10"
          >
            Quitar
          </button>
        )}
      </span>
    ) : null

  return (
    <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl px-4 py-3 space-y-2">
      <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        🔒 Bloqueos de este día
      </p>
      {delDia.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">Ninguno.</p>
      ) : (
        <ul className="space-y-2">
          {delDia.map((x) => (
            <li key={x.id} className="text-sm text-[var(--text)] flex flex-wrap items-center gap-y-1">
              <span>
                <span className="font-semibold">{quien(x)}</span>
                <span className="text-[var(--text-muted)]"> no acepta turnos </span>
                <span className="font-semibold">{franja(x)}</span>
                {x.reason && <span className="text-[var(--text-muted)]"> · {x.reason}</span>}
              </span>
              {acciones(x)}
            </li>
          ))}
        </ul>
      )}

      {proximos.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-amber-400 hover:text-amber-300">
            Próximos bloqueos ({proximos.length})
          </summary>
          <ul className="space-y-2 mt-2">
            {proximos.map((x) => (
              <li key={x.id} className="text-xs text-[var(--text)] flex flex-wrap items-center gap-y-1">
                <span>
                  <span className="text-[var(--text-muted)]">{fechaCorta(x.exception_date)} · </span>
                  <span className="font-semibold">{quien(x)}</span>
                  <span className="text-[var(--text-muted)]"> · {franja(x)}</span>
                  {x.reason && <span className="text-[var(--text-muted)]"> · {x.reason}</span>}
                </span>
                {acciones(x)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
