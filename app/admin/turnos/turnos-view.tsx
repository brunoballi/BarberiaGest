'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import { getCurrentProfile, getAllBarbersByBranch, getServicesByBranch } from '@/lib/supabase/supabase.client'
import type { Profile, ServiceCatalog } from '@/lib/supabase/database.types'
import {
  getAdminAgenda,
  createAppointmentAdmin,
  moveAppointment,
  cancelAppointment,
  setAppointmentStatus,
  APPOINTMENT_STATUS_LABELS,
  getScheduleExceptions,
  type AgendaAppointment,
  type AppointmentStatus,
  type ScheduleException,
} from '@/lib/supabase/appointments'
import {
  getWhatsAppDeliveries,
  getRecentWhatsAppFailures,
  whatsappErrorHint,
  WHATSAPP_KIND_LABELS,
  WHATSAPP_STATUS_LABELS,
  type WhatsAppDelivery,
  type WhatsAppFailureSummary,
} from '@/lib/supabase/whatsapp-status'
import { getPublicBranch, type DayHours } from '@/lib/supabase/booking'
import { PhoneInput } from '@/app/components/phone-input'
import { confirmDialog, alertDialog, errorDialog } from '@/lib/confirm-dialog'
import AgendaGrid from './agenda-grid'
import '../admin-dashboard.css'

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

/**
 * Agenda del día para el admin: crear, mover y cancelar turnos a mano.
 *
 * Grilla del día en columnas (una por barbero). No hay arrastre: se toca un
 * turno y se abre su detalle, con las acciones como botones. Mover un turno abre un formulario
 * chico con la fecha/hora nueva, en vez de arrastrar tarjetas: mismo nivel de
 * interacción que el resto del panel (ver manual-cut-modal.tsx).
 *
 * La garantía de que dos turnos no se pisan NO está acá: vive en la base
 * (restricción de exclusión). Si el admin intenta algo imposible, la RPC lo
 * rechaza y acá solo se muestra el motivo.
 */
export default function TurnosView() {
  const router = useRouter()
  const [, setSelectedBranch] = usePersistedBranch()
  const [branchId, setBranchId] = useState('')
  const [barbers, setBarbers] = useState<Profile[]>([])
  const [services, setServices] = useState<ServiceCatalog[]>([])
  const [date, setDate] = useState(todayISO())
  const [agenda, setAgenda] = useState<AgendaAppointment[]>([])
  const [bloqueos, setBloqueos] = useState<ScheduleException[]>([])
  // Horario de atención de la sucursal: define el rango de horas de la grilla.
  const [businessHours, setBusinessHours] = useState<DayHours[] | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loadingAgenda, setLoadingAgenda] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [moving, setMoving] = useState<AgendaAppointment | null>(null)
  const [selected, setSelected] = useState<AgendaAppointment | null>(null)
  const [wa, setWa] = useState<Map<string, WhatsAppDelivery[]>>(new Map())
  const [waFailures, setWaFailures] = useState<WhatsAppFailureSummary | null>(null)

  const cargarAgenda = useCallback(async (bId: string, d: string) => {
    setLoadingAgenda(true)
    try {
      const [filas, excepciones] = await Promise.all([
        getAdminAgenda(bId, d),
        // Los bloqueos son un extra visual: si fallan, la agenda se ve igual.
        getScheduleExceptions(bId, d).catch(() => [] as ScheduleException[]),
      ])
      setAgenda(filas)
      setBloqueos(excepciones.filter((x) => x.exception_date === d))
      // El estado de entrega es un extra: no frena la agenda si tarda o falla.
      void getWhatsAppDeliveries(filas.map((f) => f.id)).then(setWa)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error cargando la agenda'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setLoadingAgenda(false)
    }
  }, [])

  const cargarInicial = useCallback(async () => {
    try {
      setLoading(true)
      const p = await getCurrentProfile()
      if (!p) { setError('No autenticado'); void errorDialog('No autenticado'); return }

      const stored = getStoredBranch()
      if (!stored) { router.replace('/admin/select-branch'); return }

      setSelectedBranch(stored)
      setBranchId(stored)
      void getRecentWhatsAppFailures(stored).then(setWaFailures)
      // Extra visual: si falla, la grilla usa el rango de siempre (9 a 21).
      void getPublicBranch(stored).then((b) => setBusinessHours(b?.business_hours)).catch(() => {})

      const [bs, svcs] = await Promise.all([
        getAllBarbersByBranch(stored),
        getServicesByBranch(stored),
      ])
      setBarbers(bs.filter((b) => b.is_active))
      setServices(svcs.filter((s) => s.is_active && s.is_bookable && s.duration_min != null))
      await cargarAgenda(stored, date)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error inesperado'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, setSelectedBranch, cargarAgenda])

  useEffect(() => { cargarInicial() }, [cargarInicial])

  function cambiarDia(nuevaFecha: string) {
    setDate(nuevaFecha)
    if (branchId) cargarAgenda(branchId, nuevaFecha)
  }

  async function handleStatus(appt: AgendaAppointment, status: Exclude<AppointmentStatus, 'reservado'>) {
    try {
      await setAppointmentStatus(appt.id, status)
      await cargarAgenda(branchId, date)
    } catch (e) {
      await alertDialog(e instanceof Error ? e.message : 'Error al cambiar el estado')
    }
  }

  async function handleCancel(appt: AgendaAppointment) {
    if (!(await confirmDialog({
      message: `¿Cancelar el turno de ${appt.client_name} a las ${horaLocal(appt.starts_at)}?`,
      danger: true,
    }))) return
    try {
      await cancelAppointment(appt.id)
      await cargarAgenda(branchId, date)
    } catch (e) {
      await alertDialog(e instanceof Error ? e.message : 'Error al cancelar')
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">Cargando turnos...</div>
  if (error) return <div className="p-6 text-red-400">{error}</div>

  const barberById = new Map(barbers.map((b) => [b.id, b]))

  return (
    <div className="w-full px-4 py-8 space-y-6">
      <div className="flowi-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Agenda</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">{barbers.length} {barbers.length === 1 ? 'barbero activo' : 'barberos activos'} · tocá un turno para ver el detalle</p>
        </div>
        {barbers.length > 0 && services.length > 0 && (
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            Nuevo turno
          </button>
        )}
      </div>

      {services.length === 0 && (
        <div className="bg-[var(--bg2)] border border-amber-500/30 rounded-xl px-5 py-4 text-sm text-[var(--text)]">
          Ningún servicio tiene duración configurada todavía. Cargala en{' '}
          <a href="/admin/servicios" className="text-amber-400 hover:underline">Servicios</a>{' '}
          para poder agendar turnos.
        </div>
      )}

      {waFailures && waFailures.count > 0 && (
        <div className="bg-[var(--bg2)] border border-red-500/30 rounded-xl px-5 py-4 text-sm text-[var(--text)]">
          <strong className="text-red-300">
            {waFailures.count} {waFailures.count === 1 ? 'mensaje de WhatsApp no llegó' : 'mensajes de WhatsApp no llegaron'}
          </strong>{' '}
          en los últimos 7 días. {whatsappErrorHint(waFailures.lastCode, waFailures.lastTitle)}
        </div>
      )}

      {/* Navegación de día */}
      <div className="flex items-center gap-2">
        <button onClick={() => cambiarDia(addDaysISO(date, -1))}
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-[var(--border-mid)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-mid)]">
          ‹
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => cambiarDia(e.target.value)}
          className="bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button onClick={() => cambiarDia(addDaysISO(date, 1))}
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-[var(--border-mid)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-mid)]">
          ›
        </button>
        {date !== todayISO() && (
          <button onClick={() => cambiarDia(todayISO())} className="text-xs text-amber-400 hover:text-amber-300 ml-1">
            Hoy
          </button>
        )}
      </div>

      {/* Agenda */}
      {loadingAgenda ? (
        <p className="text-[var(--text-muted)] text-sm">Cargando...</p>
      ) : barbers.length === 0 ? (
        <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl px-5 py-10 text-center">
          <p className="text-[var(--text-muted)] text-sm">No hay barberos activos en esta sucursal.</p>
        </div>
      ) : (
        <>
          <AgendaGrid barbers={barbers} appointments={agenda} date={date} bloqueos={bloqueos} businessHours={businessHours} onSelect={setSelected} />
          {agenda.every((a) => a.status === 'cancelado') && (
            <p className="text-[var(--text-muted)] text-sm text-center">No hay turnos este día.</p>
          )}
          {agenda.some((a) => a.status === 'cancelado') && (
            <details className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl px-4 py-3">
              <summary className="cursor-pointer text-sm text-[var(--text-muted)]">
                Turnos cancelados ({agenda.filter((a) => a.status === 'cancelado').length})
              </summary>
              <div className="space-y-2 mt-3">
                {agenda.filter((a) => a.status === 'cancelado').map((appt) => (
                  <AppointmentCard
                    key={appt.id}
                    appt={appt}
                    wa={wa.get(appt.id)}
                    onStatus={handleStatus}
                    onCancel={handleCancel}
                    onMove={() => setMoving(appt)}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {selected && (() => {
        // Siempre se muestra la versión fresca del turno (tras cambiar el estado se recarga la agenda).
        const appt = agenda.find((a) => a.id === selected.id)
        if (!appt) return null
        return (
          <div className="modal-overlay" onClick={() => setSelected(null)}>
            <div className="modal-box p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-[var(--text)] font-bold text-base">Detalle del turno</h3>
                <button onClick={() => setSelected(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
              </div>
              <AppointmentCard
                appt={appt}
                wa={wa.get(appt.id)}
                onStatus={async (a, s) => { await handleStatus(a, s) }}
                onCancel={async (a) => { await handleCancel(a); setSelected(null) }}
                onMove={() => { setSelected(null); setMoving(appt) }}
              />
            </div>
          </div>
        )
      })()}

      {showNew && (
        <NewAppointmentModal
          branchId={branchId}
          barbers={barbers}
          services={services}
          defaultDate={date}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); cargarAgenda(branchId, date) }}
        />
      )}

      {moving && (
        <MoveAppointmentModal
          appt={moving}
          barbers={barbers}
          barberName={barberById.get(moving.barber_id)?.full_name ?? moving.barber_name}
          onClose={() => setMoving(null)}
          onMoved={() => { setMoving(null); cargarAgenda(branchId, date) }}
        />
      )}
    </div>
  )
}

// ─── Tarjeta de turno ──────────────────────────────────────────────────
const STATUS_STYLE: Record<AppointmentStatus, string> = {
  reservado: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  llego: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  atendido: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  no_vino: 'bg-red-500/15 text-red-300 border-red-500/30',
  cancelado: 'bg-[var(--border)]/40 text-[var(--text-muted)] border-[var(--border-mid)]',
}

function AppointmentCard({
  appt,
  wa,
  onStatus,
  onCancel,
  onMove,
}: {
  appt: AgendaAppointment
  wa?: WhatsAppDelivery[]
  onStatus: (a: AgendaAppointment, s: Exclude<AppointmentStatus, 'reservado'>) => void
  onCancel: (a: AgendaAppointment) => void
  onMove: () => void
}) {
  const activo = appt.status === 'reservado' || appt.status === 'llego'

  return (
    <div className={`bg-[var(--bg2)] border rounded-xl px-4 py-3 ${appt.status === 'cancelado' ? 'border-[var(--border)] opacity-50' : 'border-[var(--border)]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[var(--text)] font-semibold text-sm">
              {horaLocal(appt.starts_at)}–{horaLocal(appt.ends_at)}
            </span>
            <span className={`text-[0.65rem] font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 ${STATUS_STYLE[appt.status]}`}>
              {APPOINTMENT_STATUS_LABELS[appt.status]}
            </span>
            <span className="text-[var(--text-muted)] text-xs font-mono">{appt.reference}</span>
          </div>
          <p className="text-[var(--text)] text-sm mt-1">
            <span className="font-medium">{appt.client_name}</span>
            <span className="text-[var(--text-muted)]"> · {appt.client_phone}</span>
            <span className="text-[var(--text-muted)]"> · con {appt.barber_name}</span>
          </p>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            {appt.services.map((s) => s.name).join(', ')} — {formatARS(appt.total_price)}
          </p>
          {appt.notes && <p className="text-[var(--text-muted)] text-xs mt-0.5 italic">{appt.notes}</p>}
          {wa && wa.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {wa.map((m, i) => (
                <p
                  key={i}
                  className={`text-xs ${m.status === 'failed' ? 'text-red-400' : m.status === 'delivered' || m.status === 'read' ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`}
                >
                  WhatsApp · {WHATSAPP_KIND_LABELS[m.kind]}: {WHATSAPP_STATUS_LABELS[m.status]}
                  {m.status === 'failed' && ` — ${whatsappErrorHint(m.error_code, m.error_title)}`}
                </p>
              ))}
            </div>
          )}
        </div>

        {activo && (
          <div className="flex flex-wrap gap-1.5 flex-shrink-0">
            {appt.status === 'reservado' && (
              <button onClick={() => onStatus(appt, 'llego')} className="text-xs text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded-lg px-2.5 py-1">
                Llegó
              </button>
            )}
            <button onClick={() => onStatus(appt, 'atendido')} className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded-lg px-2.5 py-1">
              Atendido
            </button>
            <button onClick={() => onStatus(appt, 'no_vino')} className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg px-2.5 py-1">
              No vino
            </button>
            <button onClick={onMove} className="text-xs text-[var(--text)] hover:text-[var(--text)] border border-[var(--border-mid)] rounded-lg px-2.5 py-1">
              Mover
            </button>
            <button onClick={() => onCancel(appt)} className="text-xs text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-mid)] rounded-lg px-2.5 py-1">
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Nuevo turno ───────────────────────────────────────────────────────
function NewAppointmentModal({
  branchId,
  barbers,
  services,
  defaultDate,
  onClose,
  onCreated,
}: {
  branchId: string
  barbers: Profile[]
  services: ServiceCatalog[]
  defaultDate: string
  onClose: () => void
  onCreated: () => void
}) {
  const [barberId, setBarberId] = useState(barbers[0]?.id ?? '')
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
    if (!barberId) { setErr('Elegí un barbero'); void errorDialog('Elegí un barbero'); return }
    if (!clientName.trim() || !clientPhone.trim()) { setErr('Nombre y teléfono son obligatorios'); void errorDialog('Nombre y teléfono son obligatorios'); return }
    if (selectedServices.length === 0) { setErr('Elegí al menos un servicio'); void errorDialog('Elegí al menos un servicio'); return }

    // Se arma la fecha en horario de Argentina, no en la del navegador del
    // admin: si algún día se opera desde otro huso, la hora que se ve en
    // pantalla tiene que ser la hora real del turno.
    const startsAt = `${date}T${time}:00-03:00`

    setSaving(true)
    setErr(null)
    try {
      const result = await createAppointmentAdmin({
        branchId,
        barberId,
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
      <div className="modal-overlay" onClick={onCreated}>
        <div className="modal-box p-6 text-center space-y-3" onClick={(e) => e.stopPropagation()}>
          <p className="text-emerald-400 text-2xl">✓</p>
          <h3 className="text-[var(--text)] font-bold text-lg">Turno agendado</h3>
          <p className="text-[var(--text-muted)] text-sm">
            Código de referencia:{' '}
            <span className="text-[var(--text)] font-mono font-semibold">{reference}</span>
          </p>
          <button onClick={onCreated} className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-5 py-2 rounded-lg text-sm mt-2">
            Listo
          </button>
        </div>
      </div>
    )
  }

  return (
    // Sin cierre por clic afuera: el formulario puede estar a medio cargar y
    // perderlo por un clic al costado es el peor final posible. Se sale con la
    // X o con Cancelar, que son explícitos.
    <div className="modal-overlay">
      <div className="modal-box p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[var(--text)] font-bold text-base">Nuevo turno</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Barbero</label>
            <select value={barberId} onChange={(e) => setBarberId(e.target.value)}
              className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
              {barbers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Cliente *</label>
              <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)}
                placeholder="Nombre y apellido"
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] placeholder-[var(--text-muted)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Teléfono *</label>
              <PhoneInput
                value={clientPhone}
                onChange={setClientPhone}
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] placeholder-[var(--text-muted)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                hintClassName="text-[var(--text-muted)] text-xs mt-1"
              />
            </div>
          </div>

          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Email (opcional)</label>
            <input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
              className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
          </div>

          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">
              Servicios {totalMin > 0 && <span className="normal-case text-[var(--text-muted)]">— {totalMin} min</span>}
            </label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto border border-[var(--border)] rounded-lg p-2">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedServices.includes(s.id)}
                    onChange={() => toggleService(s.id)}
                    className="accent-amber-500"
                  />
                  <span className="flex-1">{s.name}</span>
                  <span className="text-[var(--text-muted)] text-xs">{s.duration_min} min</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Fecha</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Hora</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
          </div>

          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Notas (opcional)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
          </div>

          {err && <p className="text-red-400 text-sm">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2 rounded-lg text-sm">
              {saving ? 'Agendando...' : 'Agendar'}
            </button>
            <button type="button" onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text)] px-5 py-2 rounded-lg text-sm border border-[var(--border-mid)]">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Mover turno ───────────────────────────────────────────────────────
function MoveAppointmentModal({
  appt,
  barbers,
  barberName,
  onClose,
  onMoved,
}: {
  appt: AgendaAppointment
  barbers: Profile[]
  barberName: string
  onClose: () => void
  onMoved: () => void
}) {
  const original = new Date(appt.starts_at)
  const [date, setDate] = useState(
    original.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  )
  const [time, setTime] = useState(
    original.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
  )
  const [barberId, setBarberId] = useState(appt.barber_id)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    try {
      await moveAppointment({
        appointmentId: appt.id,
        newStartsAt: `${date}T${time}:00-03:00`,
        newBarberId: barberId !== appt.barber_id ? barberId : null,
      })
      onMoved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al mover el turno'
      setErr(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    // Sin cierre por clic afuera: ver el comentario del modal de Nuevo turno.
    <div className="modal-overlay">
      <div className="modal-box p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[var(--text)] font-bold text-base">Mover turno</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
        </div>
        <p className="text-[var(--text-muted)] text-xs">
          {appt.client_name} — actualmente con {barberName} a las {horaLocal(appt.starts_at)}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Barbero</label>
            <select value={barberId} onChange={(e) => setBarberId(e.target.value)}
              className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
              {barbers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Fecha</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Hora</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
          </div>

          {err && <p className="text-red-400 text-sm">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2 rounded-lg text-sm">
              {saving ? 'Moviendo...' : 'Mover'}
            </button>
            <button type="button" onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text)] px-5 py-2 rounded-lg text-sm border border-[var(--border-mid)]">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
