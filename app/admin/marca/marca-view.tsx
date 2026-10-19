'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import { getCurrentProfile } from '@/lib/supabase/supabase.client'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import {
  getBranchBranding,
  getBookingHeaderOwner,
  updateBranchBranding,
  uploadBranchLogo,
  type BranchBranding,
  type BookingHeaderOwner,
} from '@/lib/supabase/branding'
import type { DayHours } from '@/lib/supabase/booking'
import { confirmDialog, errorDialog } from '@/lib/confirm-dialog'
import WhatsAppSenderCard from './whatsapp-sender-card'
import '../admin-dashboard.css'

/** "-32.9442, -60.6505" -> {lat, lng}, o null si está vacío o mal escrito. */
function parseCoords(text: string): { lat: number; lng: number } | null {
  const cleaned = text.trim()
  if (!cleaned) return null
  const parts = cleaned.split(',').map((p) => p.trim())
  if (parts.length !== 2) return null
  const lat = parseFloat(parts[0])
  const lng = parseFloat(parts[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

function formatCoords(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return ''
  return `${lat}, ${lng}`
}

// weekday: 0=domingo..6=sábado (mismo criterio que barber_schedules y
// 098_horario_de_atencion.sql). Se muestra en orden lunes-a-domingo.
const DIAS_SEMANA: { weekday: number; label: string }[] = [
  { weekday: 1, label: 'Lunes' },
  { weekday: 2, label: 'Martes' },
  { weekday: 3, label: 'Miércoles' },
  { weekday: 4, label: 'Jueves' },
  { weekday: 5, label: 'Viernes' },
  { weekday: 6, label: 'Sábado' },
  { weekday: 0, label: 'Domingo' },
]

const HORARIO_VACIO: DayHours[] = Array.from({ length: 7 }, (_, weekday) => ({
  weekday, open: '00:00', close: '00:00',
}))

const HORAS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
const MINUTOS = Array.from({ length: 60 }, (_, m) => String(m).padStart(2, '0'))

const selectClass =
  'bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-md px-1.5 py-1 text-xs focus:outline-none focus:border-amber-500'

/** Un <select> de hora o de minuto, chico -- se usan 4 por día (abre h/m,
 * cierra h/m) x 7 días, así que el tamaño importa para que la lista entre
 * cómoda en pantalla. */
function TimeSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

/**
 * Marca de la barbería en la reserva pública.
 *
 * Lo que se configura acá es lo que ven los CLIENTES de la barbería en
 * /reservar, no el panel interno. Por eso la pantalla muestra una vista
 * previa: sin ella, el admin edita a ciegas un texto que nunca ve.
 *
 * Los tres campos de marca son opcionales — si quedan vacíos, /reservar cae
 * al comportamiento de siempre (nombre + dirección).
 */
export default function MarcaView() {
  const router = useRouter()
  const [, setSelectedBranch] = usePersistedBranch()
  const [branchId, setBranchId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [welcomeTitle, setWelcomeTitle] = useState('')
  const [welcomeDescription, setWelcomeDescription] = useState('')
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [defaultAreaCode, setDefaultAreaCode] = useState('')
  const [businessHours, setBusinessHours] = useState<DayHours[]>(HORARIO_VACIO)

  // Encabezado general del selector de sucursales (097): solo tiene sentido
  // con 2+ sucursales -- con una sola, ese selector ni se muestra.
  const [multiSucursal, setMultiSucursal] = useState(false)
  const [bookingHeaderEnabled, setBookingHeaderEnabled] = useState(false)
  const [bookingHeaderLogoUrl, setBookingHeaderLogoUrl] = useState<string | null>(null)
  const [headerOwner, setHeaderOwner] = useState<BookingHeaderOwner | null>(null)
  const [coordsText, setCoordsText] = useState('')
  const [uploadingHeaderLogo, setUploadingHeaderLogo] = useState(false)
  const headerLogoFileRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const aplicar = useCallback((b: BranchBranding) => {
    setName(b.name)
    setAddress(b.address ?? '')
    setLogoUrl(b.logo_url)
    setWelcomeTitle(b.welcome_title ?? '')
    setWelcomeDescription(b.welcome_description ?? '')
    setWhatsappPhone(b.whatsapp_phone ?? '')
    setDefaultAreaCode(b.default_area_code ?? '')
    setBookingHeaderEnabled(b.booking_header_enabled)
    setBookingHeaderLogoUrl(b.booking_header_logo_url)
    setCoordsText(formatCoords(b.latitude, b.longitude))
    setBusinessHours(b.business_hours?.length === 7 ? b.business_hours : HORARIO_VACIO)
  }, [])

  function updateDayHours(weekday: number, field: 'open' | 'close', part: 'hour' | 'minute', value: string) {
    setBusinessHours((prev) => prev.map((d) => {
      if (d.weekday !== weekday) return d
      const [h, m] = d[field].split(':')
      const nextH = part === 'hour' ? value : h
      const nextM = part === 'minute' ? value : m
      return { ...d, [field]: `${nextH}:${nextM}` }
    }))
  }

  const cargar = useCallback(async () => {
    try {
      setLoading(true)
      const p = await getCurrentProfile()
      if (!p) { setError('No autenticado'); void errorDialog('No autenticado'); return }

      const stored = getStoredBranch()
      if (!stored) { router.replace('/admin/select-branch'); return }
      setSelectedBranch(stored)
      setBranchId(stored)

      const [b, misSucursales, owner] = await Promise.all([
        getBranchBranding(stored),
        getMyBranchesCached(),
        getBookingHeaderOwner(),
      ])
      if (b) aplicar(b)
      setMultiSucursal(misSucursales.length > 1)
      setHeaderOwner(owner)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error inesperado'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setLoading(false)
    }
  }, [router, setSelectedBranch, aplicar])

  useEffect(() => { cargar() }, [cargar])

  // Coordenadas ya validadas, listas para mandar al RPC -- o null si lo que
  // hay tipeado no se puede interpretar. Centralizado acá porque
  // updateBranchBranding escribe TODAS las columnas en cada llamada (ver
  // comentario más abajo): cualquier guardado incidental (subir un logo,
  // tildar el encabezado) tiene que mandar las coordenadas vigentes, no
  // solo el "Guardar" del formulario.
  function currentCoords(): { lat: number | null; lng: number | null } | null {
    if (!coordsText.trim()) return { lat: null, lng: null }
    const parsed = parseCoords(coordsText)
    return parsed ? { lat: parsed.lat, lng: parsed.lng } : null
  }

  const COORDS_INVALIDAS = 'Coordenadas inválidas. Formato: -32.9442, -60.6505 (latitud, longitud).'

  async function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !branchId) return
    const coords = currentCoords()
    if (!coords) { void errorDialog(COORDS_INVALIDAS); return }
    setUploading(true)
    setError(null)
    try {
      const url = await uploadBranchLogo(branchId, file)
      setLogoUrl(url)
      // Se guarda en el acto: si el admin sube el logo y se va sin tocar
      // "Guardar", el archivo ya está en el bucket pero la sucursal no lo
      // apuntaría — quedaría subido y perdido.
      await updateBranchBranding({
        branchId, name, address, logoUrl: url,
        welcomeTitle: welcomeDescription === '' && welcomeTitle === '' ? null : welcomeTitle,
        welcomeDescription,
        // Van en TODAS las llamadas, no solo en "Guardar": el RPC siempre
        // escribe estas columnas, así que omitirlas acá las borraría con
        // solo subir un logo.
        whatsappPhone, defaultAreaCode,
        bookingHeaderEnabled, bookingHeaderLogoUrl,
        latitude: coords.lat, longitude: coords.lng,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo subir el logo'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleQuitarLogo() {
    if (!branchId) return
    if (!(await confirmDialog('¿Quitar el logo? La reserva pública vuelve a mostrar solo el nombre.'))) return
    const coords = currentCoords()
    if (!coords) { void errorDialog(COORDS_INVALIDAS); return }
    setSaving(true)
    setError(null)
    try {
      setLogoUrl(null)
      await updateBranchBranding({
        branchId, name, address, logoUrl: null, welcomeTitle, welcomeDescription, whatsappPhone, defaultAreaCode,
        bookingHeaderEnabled, bookingHeaderLogoUrl,
        latitude: coords.lat, longitude: coords.lng,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo quitar el logo'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  /** Tilda/destilda esta sucursal como fuente del encabezado general del
   * selector. Chequea la exclusividad ANTES de llamar al RPC para dar un
   * mensaje inmediato -- el RPC igual la vuelve a chequear (097). */
  async function handleToggleBookingHeader(checked: boolean) {
    if (!branchId) return
    if (checked && headerOwner && headerOwner.id !== branchId) {
      void errorDialog(
        `Ya usás "${headerOwner.name}" para el encabezado de la reserva. Sacale esa marca ahí antes de asignarla acá.`
      )
      return
    }
    const coords = currentCoords()
    if (!coords) { void errorDialog(COORDS_INVALIDAS); return }
    setSaving(true)
    setError(null)
    try {
      await updateBranchBranding({
        branchId, name, address, logoUrl, welcomeTitle, welcomeDescription, whatsappPhone, defaultAreaCode,
        bookingHeaderEnabled: checked, bookingHeaderLogoUrl,
        latitude: coords.lat, longitude: coords.lng,
      })
      setBookingHeaderEnabled(checked)
      setHeaderOwner(await getBookingHeaderOwner())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleHeaderLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !branchId) return
    const coords = currentCoords()
    if (!coords) { void errorDialog(COORDS_INVALIDAS); return }
    setUploadingHeaderLogo(true)
    setError(null)
    try {
      const url = await uploadBranchLogo(branchId, file)
      setBookingHeaderLogoUrl(url)
      await updateBranchBranding({
        branchId, name, address, logoUrl, welcomeTitle, welcomeDescription, whatsappPhone, defaultAreaCode,
        bookingHeaderEnabled, bookingHeaderLogoUrl: url,
        latitude: coords.lat, longitude: coords.lng,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo subir el logo'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setUploadingHeaderLogo(false)
      if (headerLogoFileRef.current) headerLogoFileRef.current.value = ''
    }
  }

  async function handleQuitarHeaderLogo() {
    if (!branchId) return
    const coords = currentCoords()
    if (!coords) { void errorDialog(COORDS_INVALIDAS); return }
    setSaving(true)
    setError(null)
    try {
      setBookingHeaderLogoUrl(null)
      await updateBranchBranding({
        branchId, name, address, logoUrl, welcomeTitle, welcomeDescription, whatsappPhone, defaultAreaCode,
        bookingHeaderEnabled, bookingHeaderLogoUrl: null,
        latitude: coords.lat, longitude: coords.lng,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo quitar el logo'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault()
    if (!branchId) return
    if (!name.trim()) { setError('El nombre de la barbería es obligatorio'); void errorDialog('El nombre de la barbería es obligatorio'); return }
    const coords = currentCoords()
    if (!coords) { setError(COORDS_INVALIDAS); void errorDialog(COORDS_INVALIDAS); return }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await updateBranchBranding({
        branchId, name, address, logoUrl, welcomeTitle, welcomeDescription, whatsappPhone, defaultAreaCode,
        bookingHeaderEnabled, bookingHeaderLogoUrl,
        latitude: coords.lat, longitude: coords.lng,
        businessHours,
      })
      setHeaderOwner(await getBookingHeaderOwner())
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar'
      setError(msg)
      void errorDialog(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">Cargando...</div>
  }

  return (
    <div className="w-full px-4 py-8 space-y-6">
      <div className="flowi-page-header">
        <h1 className="text-2xl font-bold text-[var(--text)]">Marca</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          Cómo ven tus clientes la pantalla de reserva online.
        </p>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Formulario ─────────────────────────────────────────── */}
        <form onSubmit={handleGuardar} className="space-y-4">
          {/* Logo */}
          <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Logo</p>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl border border-[var(--border-mid)] bg-[var(--bg3)] flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                  : <span className="text-[var(--text-muted)] text-xs text-center px-1">Sin logo</span>}
              </div>
              <div className="space-y-2 min-w-0">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleLogo}
                  disabled={uploading}
                  className="block w-full max-w-full text-sm text-[var(--text-muted)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-amber-500 file:text-zinc-950 file:cursor-pointer disabled:opacity-40"
                />
                <p className="text-[var(--text-muted)] text-xs">PNG, JPG, WEBP o SVG. Hasta 2 MB.</p>
                {uploading && <p className="text-amber-400 text-xs">Subiendo...</p>}
                {logoUrl && !uploading && (
                  <button type="button" onClick={handleQuitarLogo}
                    className="text-xs text-[var(--text-muted)] hover:text-red-400 underline">
                    Quitar logo
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Textos */}
          <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                Nombre de la barbería *
              </label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                Dirección
              </label>
              <input
                type="text" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={120}
                placeholder="Av. Siempreviva 742"
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] placeholder-[var(--text-muted)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                Coordenadas (para el mapa)
              </label>
              <input
                type="text" value={coordsText} onChange={(e) => setCoordsText(e.target.value)}
                placeholder="-32.9442, -60.6505"
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] placeholder-[var(--text-muted)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <p className="text-xs text-[var(--text-muted)] mt-1.5">
                Opcional: si las cargás, esta sucursal aparece en el mapa de la
                reserva pública. Sacalas de Google Maps: clic derecho sobre el
                punto exacto → &quot;Copiar coordenadas&quot;, y pegalas tal cual acá
                (latitud, longitud).
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                Código de área
              </label>
              <input
                type="tel"
                value={defaultAreaCode}
                onChange={(e) => setDefaultAreaCode(e.target.value.replace(/[^0-9]/g, ''))}
                maxLength={4}
                inputMode="numeric"
                placeholder="341"
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] placeholder-[var(--text-muted)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <p className="text-xs text-[var(--text-muted)] mt-1.5">
                Sin el 0. Se usa para completar el WhatsApp de abajo si cargás
                solo el número local, sin el área.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                WhatsApp de la barbería
              </label>
              <input
                type="tel"
                value={whatsappPhone}
                // Se filtra a dígitos mientras se escribe, para que lo que
                // se ve sea lo que se va a normalizar. El +54 y el 9 de
                // celular NO hacen falta tipearlos: el RPC los completa solo.
                onChange={(e) => setWhatsappPhone(e.target.value.replace(/[^0-9]/g, ''))}
                maxLength={15}
                inputMode="numeric"
                placeholder="3417505219"
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] placeholder-[var(--text-muted)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <p className="text-xs text-[var(--text-muted)] mt-1.5">
                Solo números, sin +54 ni el 9: eso lo agrega el sistema solo.
                Podés escribir el número con área (<strong>3417505219</strong>) o,
                si ya cargaste el código de área arriba, solo el número
                (<strong>7505219</strong>). Al confirmar el turno, el cliente ve
                un botón para enviarte el detalle por WhatsApp.
              </p>
            </div>

            {branchId && <WhatsAppSenderCard branchId={branchId} />}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                Mensaje de bienvenida
              </label>
              <input
                type="text" value={welcomeTitle} onChange={(e) => setWelcomeTitle(e.target.value)} maxLength={80}
                placeholder="¡Bienvenido!"
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] placeholder-[var(--text-muted)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <p className="text-[var(--text-muted)] text-xs mt-1">
                Si lo dejás vacío, se muestra el nombre de la barbería.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                Descripción
              </label>
              <textarea
                value={welcomeDescription} onChange={(e) => setWelcomeDescription(e.target.value)}
                maxLength={300} rows={3}
                placeholder="Contales algo: horarios especiales, cómo llegar, si hay estacionamiento..."
                className="w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] placeholder-[var(--text-muted)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 resize-y"
              />
              <p className="text-[var(--text-muted)] text-xs mt-1">
                Aparece debajo del saludo, una vez elegida la sucursal. {welcomeDescription.length}/300
              </p>
            </div>
          </div>

          {/* Horario de atención: se muestra en la tarjeta de esta sucursal
              en el selector de sucursales. Un día en 00:00 a 00:00 (el
              default) se toma como cerrado / sin configurar y no se
              muestra ahí -- no hace falta un check de "cerrado" aparte. */}
          <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Horario de atención
            </p>
            <p className="text-[var(--text-muted)] text-xs -mt-1">
              Se muestra en la tarjeta de esta sucursal, en el selector. Un
              día en 00:00 a 00:00 queda como cerrado y no aparece.
            </p>
            <div className="space-y-1.5">
              {DIAS_SEMANA.map(({ weekday, label }) => {
                const day = businessHours.find((d) => d.weekday === weekday) ?? { weekday, open: '00:00', close: '00:00' }
                const [openH, openM] = day.open.split(':')
                const [closeH, closeM] = day.close.split(':')
                return (
                  <div key={weekday} className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-[var(--text)] w-20 flex-shrink-0">{label}</span>
                    <span className="text-[var(--text-muted)] text-xs">De</span>
                    <TimeSelect value={openH} options={HORAS} onChange={(v) => updateDayHours(weekday, 'open', 'hour', v)} />
                    <span className="text-[var(--text-muted)] text-xs">:</span>
                    <TimeSelect value={openM} options={MINUTOS} onChange={(v) => updateDayHours(weekday, 'open', 'minute', v)} />
                    <span className="text-[var(--text-muted)] text-xs">a</span>
                    <TimeSelect value={closeH} options={HORAS} onChange={(v) => updateDayHours(weekday, 'close', 'hour', v)} />
                    <span className="text-[var(--text-muted)] text-xs">:</span>
                    <TimeSelect value={closeM} options={MINUTOS} onChange={(v) => updateDayHours(weekday, 'close', 'minute', v)} />
                    {day.open === day.close && (
                      <span className="text-[var(--text-muted)] text-xs italic">Cerrado</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Encabezado del selector de sucursales: solo tiene sentido con
              2+ sucursales activas -- con una sola, ese selector ni se
              muestra y esta sección no aplicaría a nada. */}
          {multiSucursal && (
            <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl p-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                Encabezado del selector de sucursales
              </p>
              <p className="text-[var(--text-muted)] text-xs -mt-1">
                Con varias sucursales, la reserva pública primero pregunta a
                cuál ir. Una sola sucursal puede prestarle su nombre y logo a
                esa pantalla -- las demás siguen mostrando su propia marca
                una vez elegidas.
              </p>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bookingHeaderEnabled}
                  onChange={(e) => handleToggleBookingHeader(e.target.checked)}
                  disabled={saving}
                  className="w-4 h-4 accent-amber-500"
                />
                <span className="text-sm text-[var(--text)]">
                  Usar esta sucursal para ese encabezado
                </span>
              </label>

              {!bookingHeaderEnabled && headerOwner && headerOwner.id !== branchId && (
                <p className="text-xs text-[var(--text-muted)]">
                  Hoy lo usa <strong className="text-[var(--text)]">{headerOwner.name}</strong>.
                </p>
              )}

              {bookingHeaderEnabled && (
                <div className="pt-2 border-t border-[var(--border)] space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                    Logo del encabezado
                  </p>
                  <p className="text-[var(--text-muted)] text-xs">
                    Opcional: si no cargás uno acá, se usa el logo de esta
                    sucursal (arriba de todo).
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl border border-[var(--border-mid)] bg-[var(--bg3)] flex items-center justify-center overflow-hidden flex-shrink-0">
                      {bookingHeaderLogoUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={bookingHeaderLogoUrl} alt="Logo del encabezado" className="w-full h-full object-contain" />
                        : <span className="text-[var(--text-muted)] text-[0.65rem] text-center px-1">Logo propio</span>}
                    </div>
                    <div className="space-y-2 min-w-0">
                      <input
                        ref={headerLogoFileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={handleHeaderLogo}
                        disabled={uploadingHeaderLogo}
                        className="block w-full max-w-full text-sm text-[var(--text-muted)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-amber-500 file:text-zinc-950 file:cursor-pointer disabled:opacity-40"
                      />
                      {uploadingHeaderLogo && <p className="text-amber-400 text-xs">Subiendo...</p>}
                      {bookingHeaderLogoUrl && !uploadingHeaderLogo && (
                        <button type="button" onClick={handleQuitarHeaderLogo}
                          className="text-xs text-[var(--text-muted)] hover:text-red-400 underline">
                          Usar el logo de esta sucursal
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving || uploading}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            {saved && <span className="text-emerald-400 text-sm">✓ Guardado</span>}
            <a href="/reservar" target="_blank" rel="noreferrer"
              className="text-[var(--text-muted)] hover:text-[var(--text)] text-sm underline ml-auto">
              Ver la página real ↗
            </a>
          </div>
        </form>

        {/* ── Vista previa ───────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Vista previa
          </p>
          <div className="bg-[var(--bg2)] border border-[var(--border)] rounded-xl p-6 text-center space-y-2">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-16 mx-auto object-contain mb-2" />
            )}
            <p className="text-[var(--text)] text-lg font-bold">
              {welcomeTitle.trim() || name || 'Tu barbería'}
            </p>
            {address.trim() && (
              <p className="text-[var(--text-muted)] text-sm">{address}</p>
            )}
            {welcomeDescription.trim() && (
              <p className="text-[var(--text-muted)] text-sm whitespace-pre-line pt-1">
                {welcomeDescription}
              </p>
            )}
            <div className="border-t border-[var(--border)] pt-3 mt-3">
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-widest">
                ¿Qué te vas a hacer?
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
