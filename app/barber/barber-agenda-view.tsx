'use client'

import { useState, useEffect, useCallback } from 'react'
import { TextInput } from '@/app/components/text-input'
import { PhoneInput } from '@/app/components/phone-input'
import type { ServiceCatalog } from '@/lib/supabase/database.types'
import {
  getBarberAgenda,
  createAppointmentBarber,
  createScheduleExceptionBarber,
  editAppointmentBarber,
  cancelAppointmentBarber,
  setAppointmentStatus,
  APPOINTMENT_STATUS_LABELS,
  type BarberAgendaAppointment,
  type AppointmentStatus,
} from '@/lib/supabase/appointments'
import { errorDialog, confirmDialog } from '@/lib/confirm-dialog'
import AgendaGrid from '@/app/admin/turnos/agenda-grid'
import { getPublicBranch, type DayHours } from '@/lib/supabase/booking'
import { AVISOS_BARBERO, motivoNoAvisable, type TipoAvisoBarbero } from '@/lib/aviso-barbero'

// ─── Utilidades (mismo criterio que admin/turnos/turnos-view.tsx) ─────────
function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}
function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
}
const IconBack = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  reservado: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  llego: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  atendido: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  no_vino: 'bg-red-500/15 text-red-300 border-red-500/30',
  cancelado: 'bg-zinc-700/40 text-zinc-500 border-zinc-700',
}

interface BarberAgendaViewProps {
  /** Ya filtrados por el padre: activos, reservables y con duración cargada. */
  services: ServiceCatalog[]
  /** Sucursal y datos del barbero logueado: la grilla muestra su columna y se
   * ata al horario de atención de esa sucursal. */
  branchId: string
  barber: { id: string; full_name: string; avatar_url?: string | null }
  /** El plan no incluye turnero -- se muestra el aviso, nunca se esconde la
   * pestaña (mismo criterio que Mantenimiento). */
  locked: boolean
  onBack: () => void
  /** El turno ya está "atendido" y sin corte vinculado: el padre arma el
   * formulario de carga precargado y cambia a la vista de registro. */
  onPrecarga: (appt: BarberAgendaAppointment) => void
}

/**
 * Agenda propia del barbero (Fase 3 del turnero, docs/turnero_plan.md
 * sección 2). A diferencia de la del admin, no elige barbero ni sucursal --
 * todo sale de la sesión -- y no puede mover ni cancelar turnos ajenos: solo
 * cambiar el estado de los suyos, cargar uno a mano, y bloquear su propio
 * horario. La garantía de que dos turnos no se pisan sigue viviendo en la
 * base, no acá.
 */
export default function BarberAgendaView({ services, branchId, barber, locked, onBack, onPrecarga }: BarberAgendaViewProps) {
  const [date, setDate] = useState(todayISO())
  const [agenda, setAgenda] = useState<BarberAgendaAppointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showBlock, setShowBlock] = useState(false)
  const [selected, setSelected] = useState<(BarberAgendaAppointment & { barber_id: string }) | null>(null)
  const [editing, setEditing] = useState<BarberAgendaAppointment | null>(null)
  const [businessHours, setBusinessHours] = useState<DayHours[] | undefined>(undefined)

  // Horario de la sucursal: extra visual, si falla la grilla usa el rango de siempre (9 a 21).
  useEffect(() => {
    if (locked || !branchId) return
    getPublicBranch(branchId).then((b) => setBusinessHours(b?.business_hours)).catch(() => {})
  }, [locked, branchId])

  const cargar = useCallback(async (d: string) => {
    setLoading(true)
    setError(null)
    try {
      setAgenda(await getBarberAgenda(d))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error cargando tu agenda'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!locked) cargar(date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked])

  function cambiarDia(nuevaFecha: string) {
    setDate(nuevaFecha)
    cargar(nuevaFecha)
  }

  async function handleCancel(appt: BarberAgendaAppointment) {
    if (!(await confirmDialog({
      message: `¿Cancelar el turno de ${appt.client_name} a las ${horaLocal(appt.starts_at)}? El horario queda libre.`,
      danger: true,
    }))) return
    try {
      await cancelAppointmentBarber(appt.id)
      setSelected(null)
      await cargar(date)
    } catch (e) {
      await errorDialog(e instanceof Error ? e.message : 'Error al cancelar el turno')
    }
  }

  async function handleStatus(appt: BarberAgendaAppointment, status: Exclude<AppointmentStatus, 'reservado'>) {
    try {
      await setAppointmentStatus(appt.id, status)
      setSelected(null)
      await cargar(date)
    } catch (e) {
      await errorDialog(e instanceof Error ? e.message : 'Error al cambiar el estado')
    }
  }

  if (locked) {
    return (
      <div className="shop-app animate-fadein h-dvh flex flex-col">
        <header className="flex items-center gap-3 px-5 pt-safe pt-6 pb-4">
          <button onClick={onBack} className="icon-btn"><IconBack /></button>
          <h1 className="text-lg font-bold text-[var(--text)]">Turnos</h1>
        </header>
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          <div className="bg-zinc-900 border border-amber-500/30 rounded-xl px-5 py-8 text-center">
            <p className="text-2xl mb-2">🔒</p>
            <p className="text-white text-sm font-semibold">El turnero es parte del plan Premium</p>
            <p className="text-zinc-500 text-xs mt-2">
              Consultá con tu administrador si querés que la barbería lo active.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shop-app animate-fadein h-dvh flex flex-col">
      <header className="flex items-center gap-3 px-5 pt-safe pt-6 pb-4">
        <button onClick={onBack} className="icon-btn"><IconBack /></button>
        <h1 className="text-lg font-bold text-[var(--text)] flex-1">Tus turnos</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-4">
        {/* Navegación de día */}
        <div className="flex items-center gap-2">
          <button onClick={() => cambiarDia(addDaysISO(date, -1))}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500">
            ‹
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => cambiarDia(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
          <button onClick={() => cambiarDia(addDaysISO(date, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500">
            ›
          </button>
          {date !== todayISO() && (
            <button onClick={() => cambiarDia(todayISO())} className="text-xs text-amber-400 hover:text-amber-300 ml-1">
              Hoy
            </button>
          )}
        </div>

        {/* Acciones */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowNew(true)}
            disabled={services.length === 0}
            className="flex-1 text-sm bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold px-4 py-2.5 rounded-lg"
          >
            + Nuevo turno
          </button>
          <button
            onClick={() => setShowBlock(true)}
            className="flex-1 text-sm border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 px-4 py-2.5 rounded-lg"
          >
            Bloquear horario
          </button>
        </div>
        {services.length === 0 && (
          <p className="text-zinc-500 text-xs">
            Ningún servicio está configurado como reservable todavía. Pedile al admin que lo cargue.
          </p>
        )}

        {/* Agenda */}
        {error ? (
          <p className="text-red-400 text-sm text-center py-6">{error}</p>
        ) : loading ? (
          <p className="text-zinc-500 text-sm text-center py-6">Cargando...</p>
        ) : (
          <>
            <p className="text-zinc-500 text-xs">
              {agenda.length === 0 ? 'No tenés turnos este día.' : 'Tocá un turno para ver el detalle y marcar su estado.'}
            </p>
            <AgendaGrid
              barbers={[barber]}
              appointments={agenda.map((a) => ({ ...a, barber_id: barber.id }))}
              date={date}
              businessHours={businessHours}
              onSelect={setSelected}
            />
          </>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md space-y-2" onClick={(e) => e.stopPropagation()}>
            <AppointmentCard
              appt={selected}
              onStatus={handleStatus}
              onPrecarga={(a) => { setSelected(null); onPrecarga(a) }}
              onEdit={(a) => { setSelected(null); setEditing(a) }}
              onCancel={handleCancel}
            />
            <button onClick={() => setSelected(null)}
              className="w-full text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg py-2.5">
              Cerrar
            </button>
          </div>
        </div>
      )}

      {editing && (
        <EditAppointmentModal
          appt={editing}
          services={services}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); cargar(date) }}
        />
      )}

      {showNew && (
        <NewAppointmentModal
          services={services}
          defaultDate={date}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); cargar(date) }}
        />
      )}

      {showBlock && (
        <BlockScheduleModal
          defaultDate={date}
          onClose={() => setShowBlock(false)}
          onBlocked={() => { setShowBlock(false); cargar(date) }}
        />
      )}
    </div>
  )
}

// ─── Tarjeta de turno ──────────────────────────────────────────────────
function AppointmentCard({
  appt,
  onStatus,
  onPrecarga,
  onEdit,
  onCancel,
}: {
  appt: BarberAgendaAppointment
  onStatus: (a: BarberAgendaAppointment, s: Exclude<AppointmentStatus, 'reservado'>) => void
  onPrecarga: (a: BarberAgendaAppointment) => void
  onEdit: (a: BarberAgendaAppointment) => void
  onCancel: (a: BarberAgendaAppointment) => void
}) {
  const activo = appt.status === 'reservado' || appt.status === 'llego'
  const puedeAvisar = motivoNoAvisable(appt) === null
  const [avisoAbierto, setAvisoAbierto] = useState(false)
  const [avisando, setAvisando] = useState(false)
  const [avisoResultado, setAvisoResultado] = useState<string | null>(null)

  // El barbero no ve el teléfono: pide el envío al servidor, que busca el número.
  async function enviarAviso(tipo: TipoAvisoBarbero) {
    setAvisando(true)
    setAvisoResultado(null)
    try {
      const res = await fetch('/api/turnos/mensaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: appt.id, tipo }),
      })
      const json = await res.json().catch(() => ({}))
      if (json.sent) setAvisoResultado('✓ Mensaje enviado al cliente')
      else if (json.prueba) setAvisoResultado('Modo prueba: todo en orden, pero no se envió nada')
      else if (json.reason === 'ya_enviado') setAvisoResultado('Ya le avisaste a este cliente')
      else if (json.reason === 'todavia_no') setAvisoResultado('Todavía es pronto para avisar')
      else if (json.reason === 'not_configured' || json.reason === 'sucursal_sin_numero') setAvisoResultado('El WhatsApp de la sucursal todavía no está configurado')
      else setAvisoResultado(json.error ?? 'No se pudo enviar el mensaje')
      setAvisoAbierto(false)
    } catch {
      setAvisoResultado('No se pudo enviar el mensaje')
    } finally {
      setAvisando(false)
    }
  }

  return (
    <div className={`bg-zinc-900 border rounded-xl px-4 py-3 ${appt.status === 'cancelado' ? 'border-zinc-800 opacity-50' : 'border-zinc-800'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-white font-semibold text-sm">
          {horaLocal(appt.starts_at)}–{horaLocal(appt.ends_at)}
        </span>
        <span className={`text-[0.65rem] font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 ${STATUS_STYLE[appt.status]}`}>
          {APPOINTMENT_STATUS_LABELS[appt.status]}
        </span>
        <span className="text-zinc-600 text-xs font-mono">{appt.reference}</span>
      </div>
      <p className="text-zinc-300 text-sm mt-1">
        <span className="font-medium">{appt.client_name}</span>
      </p>
      <p className="text-zinc-500 text-xs mt-0.5">
        {appt.services.map((s) => s.name).join(', ')} — {formatARS(appt.total_price)}
      </p>
      {appt.notes && <p className="text-zinc-600 text-xs mt-0.5 italic">{appt.notes}</p>}

      {puedeAvisar && (
        <div className="mt-2.5">
          {!avisoAbierto ? (
            <button onClick={() => setAvisoAbierto(true)} className="text-xs text-sky-300 hover:text-sky-200 border border-sky-500/30 rounded-lg px-2.5 py-1">
              Avisar al cliente
            </button>
          ) : (
            <div className="space-y-1.5">
              {AVISOS_BARBERO.map((a) => (
                <button
                  key={a.tipo}
                  disabled={avisando}
                  onClick={() => void enviarAviso(a.tipo)}
                  className="block w-full text-left text-xs text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 rounded-lg px-3 py-2"
                >
                  {a.etiqueta}
                </button>
              ))}
              <button onClick={() => setAvisoAbierto(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Cancelar</button>
            </div>
          )}
        </div>
      )}
      {avisoResultado && <p className="text-xs text-zinc-400 mt-1.5">{avisoResultado}</p>}

      {(activo || (appt.status === 'atendido' && !appt.transaction_id)) && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {activo && (
            <>
              <button onClick={() => onStatus(appt, 'atendido')} className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded-lg px-2.5 py-1">
                Atendido
              </button>
              <button onClick={() => onStatus(appt, 'no_vino')} className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg px-2.5 py-1">
                No vino
              </button>
              {!appt.transaction_id && (
                <button onClick={() => onEdit(appt)} className="text-xs text-zinc-200 hover:text-white border border-zinc-600 rounded-lg px-2.5 py-1">
                  Editar
                </button>
              )}
              {!appt.transaction_id && (
                <button onClick={() => onCancel(appt)} className="text-xs text-zinc-400 hover:text-red-400 border border-zinc-600 rounded-lg px-2.5 py-1">
                  Cancelar
                </button>
              )}
            </>
          )}
          {appt.status === 'atendido' && !appt.transaction_id && (
            <button onClick={() => onPrecarga(appt)} className="text-xs text-zinc-950 bg-amber-500 hover:bg-amber-400 font-semibold rounded-lg px-2.5 py-1">
              Cargar el corte
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Editar turno (fecha, hora y servicios) ───────────────────────────────
function EditAppointmentModal({
  appt,
  services,
  onClose,
  onSaved,
}: {
  appt: BarberAgendaAppointment
  /** Servicios reservables de la sucursal (activos y con duración). */
  services: ServiceCatalog[]
  onClose: () => void
  onSaved: () => void
}) {
  const inicio = new Date(appt.starts_at)
  const [date, setDate] = useState(inicio.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const [time, setTime] = useState(
    inicio.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
  )
  const originalIds = appt.services.map((s) => s.service_id)
  const [serviceIds, setServiceIds] = useState<string[]>(originalIds)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Los servicios del turno que hoy no son reservables se muestran igual, para no perderlos al editar.
  const opciones = [
    ...services,
    ...appt.services
      .filter((s) => !services.some((x) => x.id === s.service_id))
      .map((s) => ({ id: s.service_id, name: s.name, duration_min: s.duration_min }) as ServiceCatalog),
  ]
  const totalMin = opciones.filter((s) => serviceIds.includes(s.id)).reduce((acc, s) => acc + (s.duration_min ?? 0), 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (serviceIds.length === 0) {
      setErr('Elegí al menos un servicio')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const cambiaronServicios =
        serviceIds.length !== originalIds.length || serviceIds.some((id) => !originalIds.includes(id))
      await editAppointmentBarber({
        appointmentId: appt.id,
        newStartsAt: `${date}T${time}:00-03:00`,
        serviceIds: cambiaronServicios ? serviceIds : null,
      })
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al guardar el turno'
      setErr(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg p-6 space-y-4 animate-fadein max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-base">Editar turno</h3>
          <button onClick={onClose} className="icon-btn"><span className="text-lg leading-none">✕</span></button>
        </div>
        <p className="text-zinc-500 text-xs">{appt.client_name} — {horaLocal(appt.starts_at)}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <p className="section-label mb-1">
              Servicios {totalMin > 0 && <span className="normal-case text-zinc-600">— {totalMin} min</span>}
            </p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto border border-zinc-800 rounded-lg p-2">
              {opciones.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={serviceIds.includes(s.id)}
                    onChange={() => setServiceIds((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                    className="accent-amber-500"
                  />
                  <span className="flex-1">{s.name}</span>
                  <span className="text-zinc-500 text-xs">{s.duration_min} min</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="section-label mb-1">Fecha</p>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <p className="section-label mb-1">Hora</p>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
          </div>

          {err && <p className="text-red-400 text-sm">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-40">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Nuevo turno (a mano, para el cliente que llamó) ──────────────────────
function NewAppointmentModal({
  services,
  defaultDate,
  onClose,
  onCreated,
}: {
  services: ServiceCatalog[]
  defaultDate: string
  onClose: () => void
  onCreated: () => void
}) {
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [date, setDate] = useState(defaultDate)
  const [time, setTime] = useState('10:00')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)

  const totalMin = services
    .filter((s) => selectedServices.includes(s.id))
    .reduce((acc, s) => acc + (s.duration_min ?? 0), 0)

  function toggleService(id: string) {
    setSelectedServices((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientName.trim() || !clientPhone.trim()) {
      setErr('Nombre y teléfono son obligatorios')
      void errorDialog('Nombre y teléfono son obligatorios')
      return
    }
    if (selectedServices.length === 0) {
      setErr('Elegí al menos un servicio')
      void errorDialog('Elegí al menos un servicio')
      return
    }

    // Horario de Argentina, no el del navegador -- mismo criterio que el
    // "Nuevo turno" del admin en admin/turnos/turnos-view.tsx.
    const startsAt = `${date}T${time}:00-03:00`

    setSaving(true)
    setErr(null)
    try {
      const result = await createAppointmentBarber({
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        clientEmail: clientEmail.trim() || null,
        startsAt,
        serviceIds: selectedServices,
        notes: notes.trim() || null,
      })
      setReference(result.reference)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al agendar'
      setErr(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  if (reference) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 overflow-y-auto" onClick={onCreated}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg p-6 text-center space-y-3 animate-fadein" onClick={(e) => e.stopPropagation()}>
          <p className="text-emerald-400 text-2xl">✓</p>
          <h3 className="text-white font-bold text-lg">Turno agendado</h3>
          <p className="text-zinc-400 text-sm">
            Código de referencia: <span className="text-white font-mono font-semibold">{reference}</span>
          </p>
          <button onClick={onCreated} className="btn-primary w-full mt-2">Listo</button>
        </div>
      </div>
    )
  }

  return (
    // Sin cierre por clic afuera: el formulario puede estar a medio cargar y
    // perderlo por un clic al costado es el peor final posible. Se sale con la
    // X o con Cancelar, que son explícitos.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg p-6 space-y-4 animate-fadein max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-base">Nuevo turno</h3>
          <button onClick={onClose} className="icon-btn"><span className="text-lg leading-none">✕</span></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="section-label mb-1">Cliente *</p>
              <TextInput placeholder="Nombre y apellido" value={clientName} onChange={setClientName} className="client-name-input" maxLength={60} />
            </div>
            <div>
              <p className="section-label mb-1">Teléfono *</p>
              <PhoneInput
                value={clientPhone}
                onChange={setClientPhone}
                className="client-name-input"
                hintClassName="text-zinc-500 text-xs mt-1"
              />
            </div>
          </div>

          <div>
            <p className="section-label mb-1">Email (opcional)</p>
            <TextInput placeholder="" value={clientEmail} onChange={setClientEmail} className="client-name-input" />
          </div>

          <div>
            <p className="section-label mb-1">
              Servicios {totalMin > 0 && <span className="normal-case text-zinc-600">— {totalMin} min</span>}
            </p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto border border-zinc-800 rounded-lg p-2">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={selectedServices.includes(s.id)} onChange={() => toggleService(s.id)} className="accent-amber-500" />
                  <span className="flex-1">{s.name}</span>
                  <span className="text-zinc-500 text-xs">{s.duration_min} min</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="section-label mb-1">Fecha</p>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <p className="section-label mb-1">Hora</p>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
          </div>

          <div>
            <p className="section-label mb-1">Notas (opcional)</p>
            <TextInput placeholder="" value={notes} onChange={setNotes} className="client-name-input" maxLength={120} />
          </div>

          {err && <p className="text-red-400 text-sm">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-40">
              {saving ? 'Agendando...' : 'Agendar'}
            </button>
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Bloquear horario ("me voy antes", "salgo a comer", franco) ──────────

/** ¿La franja a bloquear se superpone con un turno activo? Todo el día
 * siempre se superpone; una franja parcial se compara por horario local. */
function franjaSeSuperpone(appt: BarberAgendaAppointment, allDay: boolean, startTime: string, endTime: string): boolean {
  if (allDay) return true
  const h = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', {
    hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires',
  })
  return h(appt.starts_at) < endTime && h(appt.ends_at) > startTime
}

function BlockScheduleModal({
  defaultDate,
  onClose,
  onBlocked,
}: {
  defaultDate: string
  onClose: () => void
  onBlocked: () => void
}) {
  const [date, setDate] = useState(defaultDate)
  const [allDay, setAllDay] = useState(true)
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('21:00')
  const [reason, setReason] = useState('')
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // null = todavía no se chequeó (o cambió algo del formulario desde el
  // último chequeo). Un array = se encontraron ESTOS turnos en conflicto y
  // el barbero ya los vio -- "Bloquear igual" reintenta el submit real.
  const [conflicts, setConflicts] = useState<BarberAgendaAppointment[] | null>(null)

  // Cualquier cambio en fecha/franja invalida un chequeo de conflictos
  // anterior -- si no, "Bloquear igual" podría aplicar a una franja distinta
  // de la que se revisó.
  function resetConflicts() { if (conflicts !== null) setConflicts(null) }

  async function submitBloqueo() {
    setSaving(true)
    setErr(null)
    try {
      await createScheduleExceptionBarber({
        exceptionDate: date,
        closedAllDay: allDay,
        startTime: allDay ? null : startTime,
        endTime: allDay ? null : endTime,
        reason: reason.trim() || null,
      })
      onBlocked()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al bloquear el horario'
      setErr(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!allDay && startTime >= endTime) {
      const msg = 'La hora de inicio tiene que ser antes que la de fin'
      setErr(msg)
      void errorDialog(msg)
      return
    }
    setErr(null)

    // Ya se mostraron los conflictos y el barbero eligió seguir igual --
    // esta vez sí se manda el bloqueo.
    if (conflicts !== null) {
      await submitBloqueo()
      return
    }

    setChecking(true)
    try {
      const agenda = await getBarberAgenda(date)
      const enConflicto = agenda.filter(
        (a) => (a.status === 'reservado' || a.status === 'llego') && franjaSeSuperpone(a, allDay, startTime, endTime)
      )
      if (enConflicto.length > 0) {
        setConflicts(enConflicto)
        return
      }
    } catch {
      // Si el chequeo en sí falla (ej. sin conexión), no le impide al
      // barbero bloquear su horario -- es una ayuda extra, no un requisito.
    } finally {
      setChecking(false)
    }

    await submitBloqueo()
  }

  return (
    // Sin cierre por clic afuera: hay un formulario cargado y perderlo por un
    // clic al costado obliga a rehacerlo. Se sale con la X o con Cancelar.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg p-6 space-y-4 animate-fadein max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-base">Bloquear horario</h3>
          <button onClick={onClose} className="icon-btn"><span className="text-lg leading-none">✕</span></button>
        </div>

        {conflicts !== null ? (
          // ── Vista de conflicto: hay turnos activos en la franja a bloquear ──
          <div className="space-y-3">
            <p className="text-amber-400 text-sm font-semibold">
              ⚠️ Tenés {conflicts.length} turno{conflicts.length === 1 ? '' : 's'} en ese horario
            </p>
            <p className="text-zinc-500 text-xs">
              Bloquear igual NO cancela estos turnos. Si hace falta reprogramar, pedile al administrador que avise al cliente.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {conflicts.map((a) => (
                <div key={a.id} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5">
                  <p className="text-white text-sm font-medium truncate">{a.client_name}</p>
                  <p className="text-zinc-500 text-xs">{horaLocal(a.starts_at)}–{horaLocal(a.ends_at)}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => void submitBloqueo()} disabled={saving} className="btn-primary flex-1 disabled:opacity-40">
                {saving ? 'Guardando...' : 'Bloquear igual'}
              </button>
              <button type="button" onClick={() => setConflicts(null)} className="btn-ghost flex-1">Volver</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-zinc-500 text-xs">
              Para avisar que no atendés un día entero (franco, feriado) o parte de él (te vas antes, salís a comer).
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <p className="section-label mb-1">Fecha</p>
                <input type="date" value={date} onChange={(e) => { setDate(e.target.value); resetConflicts() }}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); resetConflicts() }} className="w-4 h-4 accent-amber-500" />
                <span className="text-sm text-zinc-300">Todo el día</span>
              </label>

              {!allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="section-label mb-1">Desde</p>
                    <input type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); resetConflicts() }}
                      className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
                  </div>
                  <div>
                    <p className="section-label mb-1">Hasta</p>
                    <input type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); resetConflicts() }}
                      className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
                  </div>
                </div>
              )}

              <div>
                <p className="section-label mb-1">Motivo (opcional)</p>
                <TextInput placeholder="ej: turno médico" value={reason} onChange={setReason} className="client-name-input" maxLength={120} />
              </div>

              {err && <p className="text-red-400 text-sm">{err}</p>}

              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={saving || checking} className="btn-primary flex-1 disabled:opacity-40">
                  {checking ? 'Revisando turnos...' : saving ? 'Guardando...' : 'Bloquear'}
                </button>
                <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancelar</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
