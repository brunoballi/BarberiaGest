'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import { usePagination } from '@/lib/hooks/usePagination'
import { PaginationControls } from '@/app/components/pagination-controls'
import { getCurrentProfile } from '@/lib/supabase/supabase.client'
import { listAppointmentClients, type AppointmentClient } from '@/lib/supabase/clients'
import { toWhatsAppRecipient } from '@/lib/whatsapp'
import { errorDialog } from '@/lib/confirm-dialog'
import '../admin-dashboard.css'

const TZ = 'America/Argentina/Buenos_Aires'
const DIAS_INACTIVO = 30

type Filtro = 'todos' | 'proximo' | 'inactivos' | 'faltaron'
type Orden = 'ultima' | 'mas_turnos' | 'nombre' | 'recientes'

const FILTRO_LABELS: Record<Filtro, string> = {
  todos: 'Todos',
  proximo: 'Con turno próximo',
  inactivos: `Hace más de ${DIAS_INACTIVO} días que no vienen`,
  faltaron: 'Faltaron alguna vez',
}

const ORDEN_LABELS: Record<Orden, string> = {
  ultima: 'Última visita',
  mas_turnos: 'Más turnos',
  nombre: 'Nombre (A-Z)',
  recientes: 'Más nuevos primero',
}

function fecha(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ })
}

/** Sin tildes ni mayúsculas, para que "perez" encuentre "Pérez". */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function esInactivo(c: AppointmentClient, ahora: number): boolean {
  if (!c.ultimo_turno || c.proximo_turno) return false
  return ahora - new Date(c.ultimo_turno).getTime() > DIAS_INACTIVO * 24 * 3600 * 1000
}

/**
 * Una celda de CSV. Los nombres los escribe cualquiera desde la reserva
 * pública: si empiezan con = + - @ Excel los interpreta como fórmula, así que
 * se les antepone un apóstrofo (inyección de fórmulas en CSV).
 */
function csvCell(value: string | number | null): string {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return `"${s.replace(/"/g, '""')}"`
}

function exportarCSV(clientes: AppointmentClient[]) {
  const header = ['Nombre', 'Teléfono', 'Email', 'Turnos', 'Atendidos', 'No vino', 'Cancelados', 'Última visita', 'Próximo turno']
  const rows = clientes.map((c) => [
    c.full_name, c.phone, c.email, c.total_turnos, c.atendidos, c.no_vino, c.cancelados,
    c.ultimo_turno ? fecha(c.ultimo_turno) : '', c.proximo_turno ? fecha(c.proximo_turno) : '',
  ])
  // BOM al principio para que Excel respete las tildes.
  const csv = String.fromCharCode(0xfeff) + [header, ...rows].map((r) => r.map(csvCell).join(',')).join(String.fromCharCode(13, 10))
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Base de clientes del turnero: cada persona que reservó, con cuántas veces
 * vino, cuándo fue la última y si tiene un turno por delante. Sirve para
 * decidir a quién escribirle -- el botón de WhatsApp abre el chat desde el
 * celular del admin, sin pasar por una plantilla de Meta.
 */
export default function ClientesView() {
  const router = useRouter()
  const [, setSelectedBranch] = usePersistedBranch()
  const [clientes, setClientes] = useState<AppointmentClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [orden, setOrden] = useState<Orden>('ultima')
  // Se fija una vez al cargar: Date.now() en el render no es puro.
  const [ahora, setAhora] = useState(0)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        const p = await getCurrentProfile()
        if (!p) { setError('No autenticado'); return }

        const stored = getStoredBranch()
        if (!stored) { router.replace('/admin/select-branch'); return }
        setSelectedBranch(stored)

        const lista = await listAppointmentClients(stored)
        if (cancelado) return
        setClientes(lista)
        setAhora(Date.now())
      } catch (e) {
        if (cancelado) return
        const msg = e instanceof Error ? e.message : 'Error cargando los clientes'
        setError(msg)
        void errorDialog(msg)
      } finally {
        if (!cancelado) setLoading(false)
      }
    })()
    return () => { cancelado = true }
  }, [router, setSelectedBranch])

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim())
    const qDigitos = busqueda.replace(/\D/g, '')
    const lista = clientes.filter((c) => {
      if (q) {
        const coincide =
          normalizar(c.full_name).includes(q) ||
          normalizar(c.email ?? '').includes(q) ||
          (qDigitos.length >= 3 && c.phone.replace(/\D/g, '').includes(qDigitos))
        if (!coincide) return false
      }
      if (filtro === 'proximo') return c.proximo_turno != null
      if (filtro === 'inactivos') return esInactivo(c, ahora)
      if (filtro === 'faltaron') return c.no_vino > 0
      return true
    })
    // La RPC ya viene por última visita; solo se reordena si se pidió otra cosa.
    if (orden === 'mas_turnos') lista.sort((a, b) => b.total_turnos - a.total_turnos || a.full_name.localeCompare(b.full_name, 'es'))
    if (orden === 'nombre') lista.sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
    if (orden === 'recientes') lista.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return lista
  }, [clientes, busqueda, filtro, orden, ahora])

  const pagination = usePagination(visibles, 20)

  const conProximo = clientes.filter((c) => c.proximo_turno).length
  const inactivos = clientes.filter((c) => esInactivo(c, ahora)).length

  if (loading) return <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">Cargando clientes...</div>
  if (error) return <div className="p-6 text-red-400">{error}</div>

  return (
    <div className="w-full px-4 py-8 space-y-6">
      <div className="flowi-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Clientes</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">Todas las personas que reservaron un turno</p>
        </div>
        <button
          onClick={() => exportarCSV(visibles)}
          disabled={visibles.length === 0}
          className="inline-flex items-center gap-2 border border-[var(--border-mid)] text-[var(--text)] hover:border-amber-500 disabled:opacity-40 px-4 py-2.5 rounded-lg text-sm transition-colors"
        >
          Exportar a Excel (CSV)
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Resumen valor={clientes.length} etiqueta="clientes en total" />
        <Resumen valor={conProximo} etiqueta="con turno próximo" />
        <Resumen valor={inactivos} etiqueta={`sin venir hace más de ${DIAS_INACTIVO} días`} />
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, teléfono o mail"
          className="flex-1 bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as Filtro)}
          className="bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        >
          {(Object.keys(FILTRO_LABELS) as Filtro[]).map((f) => <option key={f} value={f}>{FILTRO_LABELS[f]}</option>)}
        </select>
        <select
          value={orden}
          onChange={(e) => setOrden(e.target.value as Orden)}
          className="bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        >
          {(Object.keys(ORDEN_LABELS) as Orden[]).map((o) => <option key={o} value={o}>{ORDEN_LABELS[o]}</option>)}
        </select>
      </div>

      {clientes.length === 0 ? (
        <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl px-5 py-10 text-center">
          <p className="text-[var(--text-muted)] text-sm">Todavía no hay clientes. Aparecen solos cuando alguien reserva un turno.</p>
        </div>
      ) : visibles.length === 0 ? (
        <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl px-5 py-10 text-center">
          <p className="text-[var(--text-muted)] text-sm">Ningún cliente coincide con la búsqueda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pagination.paginatedData.map((c) => <ClienteCard key={c.client_id} c={c} />)}
        </div>
      )}

      <PaginationControls
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        pageSize={pagination.pageSize}
        totalItems={pagination.totalItems}
        startIdx={pagination.startIdx}
        endIdx={pagination.endIdx}
        canGoPrevious={pagination.canGoPrevious}
        canGoNext={pagination.canGoNext}
        onPageChange={pagination.goToPage}
        onPageSizeChange={pagination.setPageSize}
        itemLabel="clientes"
      />
    </div>
  )
}

function Resumen({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl px-4 py-3">
      <p className="text-2xl font-bold text-[var(--text)]">{valor}</p>
      <p className="text-xs text-[var(--text-muted)] mt-0.5">{etiqueta}</p>
    </div>
  )
}

function ClienteCard({ c }: { c: AppointmentClient }) {
  const destino = toWhatsAppRecipient(c.phone)
  const primerNombre = c.full_name.trim().split(/\s+/)[0]
  const waLink = destino ? `https://wa.me/${destino}?text=${encodeURIComponent(`Hola ${primerNombre}! `)}` : null

  return (
    <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[var(--text)] text-sm">
            <span className="font-semibold">{c.full_name}</span>
            <span className="text-[var(--text-muted)]"> · {c.phone}</span>
          </p>
          {c.email && <p className="text-[var(--text-muted)] text-xs mt-0.5 break-all">{c.email}</p>}
          <p className="text-[var(--text-muted)] text-xs mt-1">
            {c.total_turnos} {c.total_turnos === 1 ? 'turno' : 'turnos'}
            {c.atendidos > 0 && <> · {c.atendidos} {c.atendidos === 1 ? 'atendido' : 'atendidos'}</>}
            {c.no_vino > 0 && <span className="text-red-400"> · faltó {c.no_vino} {c.no_vino === 1 ? 'vez' : 'veces'}</span>}
            {c.cancelados > 0 && <> · {c.cancelados} {c.cancelados === 1 ? 'cancelado' : 'cancelados'}</>}
          </p>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            Última visita: {fecha(c.ultimo_turno)}
            {c.proximo_turno && <span className="text-sky-300"> · Próximo turno: {fecha(c.proximo_turno)}</span>}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 flex-shrink-0">
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded-lg px-2.5 py-1"
            >
              Escribir por WhatsApp
            </a>
          )}
          {c.email && (
            <a
              href={`mailto:${c.email}`}
              className="text-xs text-[var(--text)] border border-[var(--border-mid)] rounded-lg px-2.5 py-1"
            >
              Mail
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
