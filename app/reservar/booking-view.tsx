'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  listPublicBranches,
  getBookingHeader,
  getBookableServices,
  getPublicBarbers,
  getPopularServiceId,
  getWalkinWindows,
  getAvailableSlots,
  createBooking,
  lookupBooking,
  BARBER_ANY,
  slotTime,
  slotDateLong,
  todayInBusinessTz,
  addDays,
  dayChipLabel,
  todayHoursLabel,
  type PublicBranch,
  type BookingHeader,
  type BookableService,
  type PublicBarber,
  type WalkinWindow,
  type AvailableSlot,
  type BookingResult,
  type AppointmentLookup,
} from '@/lib/supabase/booking'
import { PhoneInput } from '@/app/components/phone-input'
import TurnoFicha from './turno-ficha'
import './reservar.css'
import BranchesMap from '@/app/components/branches-map'

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n)
}

/** Cuántos días hacia adelante se puede reservar. */
const DIAS_VISIBLES = 14
/** Tope del selector de "otra fecha" -- no hay límite del lado de la base
 * (get_available_slots acepta cualquier fecha), esto es solo para no ofrecer
 * un date picker sin fondo. */
const DIAS_MAX_ADELANTE = 90

/**
 * Reserva pública, un paso a la vez:
 *
 *   1. Barbero (si hay más de uno; con uno solo se salta este paso)
 *   2. Servicio
 *   3. Día y horario
 *   4. Nombre y teléfono → confirmar
 *
 * Nada se valida solo acá: el cálculo de horarios y la reserva los resuelve
 * la base (059_reserva_publica.sql). Esta pantalla muestra lo que devuelve y
 * traduce sus errores.
 */
type Step = 'barbero' | 'servicio' | 'horario' | 'contacto'

export default function BookingView() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [branch, setBranch] = useState<PublicBranch | null>(null)
  // Sucursales para elegir, SOLO cuando hay más de una activa -- con una
  // sola, branchChoices queda vacío y la pantalla no se entera de que existe
  // este paso (mismo comportamiento de siempre, cero fricción extra).
  const [branchChoices, setBranchChoices] = useState<PublicBranch[]>([])
  // Todas las sucursales activas, cargado una sola vez y NUNCA se vacía
  // (a diferencia de branchChoices) -- así "volver a sucursales" desde
  // cualquier paso no necesita pedirlas de nuevo. Con 1 sola, se usa nomás
  // para decidir que no hay a dónde volver (sin botón de volver).
  const [allBranches, setAllBranches] = useState<PublicBranch[]>([])
  // Encabezado general del selector (logo + nombre de LA sucursal marcada
  // en /admin/marca). Solo tiene sentido cuando se muestra branchChoices;
  // con una sola sucursal activa, ni se pide.
  const [bookingHeader, setBookingHeader] = useState<BookingHeader | null>(null)
  const [services, setServices] = useState<BookableService[]>([])
  const [barbers, setBarbers] = useState<PublicBarber[]>([])
  // Servicio más pedido de la sucursal (113): va primero en la lista y lleva
  // la etiqueta "Más elegido". Null mientras no haya historial.
  const [popularId, setPopularId] = useState<string | null>(null)
  // Quién atiende, para la pantalla de confirmación. Con "sin preferencia" lo
  // asigna la base, así que se lee recién después de reservar.
  const [assignedBarber, setAssignedBarber] = useState<string | null>(null)
  // Ficha completa del turno recién reservado, tal como la devuelve la base.
  const [fichaServidor, setFichaServidor] = useState<AppointmentLookup | null>(null)
  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)

  const [step, setStep] = useState<Step>('barbero')
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [barberId, setBarberId] = useState('')
  const [date, setDate] = useState(todayInBusinessTz())
  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [walkins, setWalkins] = useState<WalkinWindow[]>([])
  const [slotAt, setSlotAt] = useState<string | null>(null)

  // Tira de días: es más ancha que la pantalla (DIAS_VISIBLES=14) y se
  // desplaza con scroll horizontal, pero sin flecha ni indicio visual no se
  // nota que hay más — el degradé de la derecha avisa que se puede seguir
  // deslizando. Se oculta solo cuando ya se llegó al final de la tira.
  const diasRef = useRef<HTMLDivElement>(null)
  const [hayMasDias, setHayMasDias] = useState(true)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<BookingResult | null>(null)
  const AUTO_RETURN_SEG = 15
  const [autoReturnIn, setAutoReturnIn] = useState(AUTO_RETURN_SEG)

  // Servicios y barberos de la sucursal ya elegida. Separado de la carga
  // inicial porque el selector de sucursal (cuando hay más de una) también
  // lo necesita, al elegir.
  const cargarSucursal = useCallback(async (b: PublicBranch) => {
    setBranch(b)
    try {
      const [svcs, brbs, popular] = await Promise.all([
        getBookableServices(b.id),
        getPublicBarbers(b.id),
        // Es un extra: si falla, la lista sale igual, sin etiqueta.
        getPopularServiceId(b.id).catch(() => null),
      ])
      // El más elegido primero; el resto conserva el orden de la base.
      setServices(popular ? [...svcs.filter((s) => s.id === popular), ...svcs.filter((s) => s.id !== popular)] : svcs)
      setPopularId(svcs.some((s) => s.id === popular) ? popular : null)
      setBarbers(brbs)
      // Con un solo barbero no tiene sentido pedir que lo "elija": se
      // preselecciona y el paso 1 arranca directo en el servicio.
      // Con más de uno no se marca ninguno: hay una opción "Sin preferencia"
      // arriba y un barbero ya resaltado de entrada parecía elegido.
      if (brbs.length === 1) setBarberId(brbs[0].id)
      setStep(brbs.length > 1 ? 'barbero' : 'servicio')
      // get_public_barbers solo devuelve barberos con al menos un día en
      // modo "turno" cargado (ver 078_public_barber_photos.sql) -- un
      // barbero activo pero sin horario de turno cargado no cuenta. Sin
      // este aviso, la pantalla seguía de largo con barberId='' y
      // terminaba mostrando "no hay horarios" sin explicar por qué.
      if (brbs.length === 0) {
        setFatal('Todavía no hay barberos disponibles para reservar online en esta sucursal.')
      } else if (svcs.length === 0) {
        setFatal('Todavía no hay servicios disponibles para reservar online.')
      }
    } catch (e) {
      setFatal(e instanceof Error ? e.message : 'No pudimos cargar la información.')
    } finally {
      setLoading(false)
    }
  }, [])

  function elegirSucursal(b: PublicBranch) {
    setBranchChoices([])
    setLoading(true)
    // Query param para que el link a esta sucursal puntual se pueda
    // compartir/guardar -- no navega, solo actualiza la URL visible.
    router.replace(`?sucursal=${b.id}`, { scroll: false })
    cargarSucursal(b)
  }

  /** Desde el primer paso de una sucursal (barbero o servicio, según haya
   * o no barbero único) vuelve al selector -- solo tiene sentido con 2+
   * sucursales. Limpia todo lo elegido: volver a sucursales es "empezar de
   * nuevo", no queremos arrastrar el barbero/servicio de la sucursal
   * anterior a la nueva. */
  function volverASucursales() {
    setFatal(null)
    setBranch(null)
    setServices([])
    setPopularId(null)
    setAssignedBarber(null)
    setFichaServidor(null)
    setBarbers([])
    setBarberId('')
    setSelectedServices([])
    setSlots([])
    setSlotAt(null)
    setWalkins([])
    setDate(todayInBusinessTz())
    setStep('barbero')
    setName(''); setPhone(''); setEmail('')
    setFormError(null)
    router.replace('/reservar', { scroll: false })
    setBranchChoices(allBranches)
  }

  // ── Carga inicial ──────────────────────────────────────────────────
  // Con una sola sucursal activa, sigue exactamente como antes: se resuelve
  // sola y no hay ningún paso de más. Con dos o más, si la URL ya trae
  // ?sucursal= válido se usa esa; si no, se muestra el selector.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const all = await listPublicBranches()
        if (!vivo) return
        setAllBranches(all)
        if (all.length === 0) {
          setFatal('La barbería todavía no configuró la reserva online.')
          setLoading(false)
          return
        }
        if (all.length === 1) {
          await cargarSucursal(all[0])
          return
        }
        const idUrl = searchParams.get('sucursal')
        const deUrl = idUrl ? all.find((b) => b.id === idUrl) : undefined
        if (deUrl) {
          await cargarSucursal(deUrl)
          return
        }
        setBranchChoices(all)
        setLoading(false)
        // Best-effort: sin sucursal marcada en /admin/marca, getBookingHeader
        // devuelve null y la pantalla cae al título de siempre.
        getBookingHeader().then((h) => { if (vivo) setBookingHeader(h) }).catch(() => {})
      } catch (e) {
        if (vivo) { setFatal(e instanceof Error ? e.message : 'No pudimos cargar la información.'); setLoading(false) }
      }
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Confirmado el turno, vuelve solo al selector a los 15s ─────────
  // Le da tiempo al cliente a leer la fecha/hora, copiar el código y, si
  // quiere, tocar WhatsApp o "Gestionar mi turno" -- no es instantáneo a
  // propósito. "Gestionar mi turno" navega fuera de esta pantalla (limpia
  // el timer solo, por el cleanup); WhatsApp abre en otra pestaña, así que
  // esta sigue su cuenta regresiva igual, sin interferir.
  useEffect(() => {
    if (!done) return
    setAutoReturnIn(AUTO_RETURN_SEG)
    const tick = setInterval(() => setAutoReturnIn((s) => Math.max(0, s - 1)), 1000)
    const irme = setTimeout(() => { window.location.href = '/reservar' }, AUTO_RETURN_SEG * 1000)
    return () => { clearInterval(tick); clearTimeout(irme) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  // ── Horarios: se recalculan ante cualquier cambio ──────────────────
  const cargarSlots = useCallback(async () => {
    if (!branch || !barberId || selectedServices.length === 0) {
      setSlots([]); setWalkins([]); return
    }
    setSlotsLoading(true)
    setSlotAt(null)
    try {
      const [s, w] = await Promise.all([
        getAvailableSlots({ branchId: branch.id, barberId, date, serviceIds: selectedServices }),
        getWalkinWindows(branch.id, date),
      ])
      setSlots(s)
      // Con "sin preferencia" el aviso de orden de llegada solo se muestra si
      // TODOS los barberos tienen esa franja y coinciden en el horario. Si solo
      // la tiene uno (o difieren), el cartel diría que toda la barbería atiende
      // sin turno cuando los demás sí dan turno a esa hora.
      const mismaFranja = new Set(w.map((x) => `${x.start_time}-${x.end_time}`)).size === 1
      const todosLaTienen = new Set(w.map((x) => x.barber_id)).size >= barbers.length
      setWalkins(
        barberId === BARBER_ANY
          ? (mismaFranja && todosLaTienen ? w : [])
          : w.filter((x) => x.barber_id === barberId),
      )
    } catch {
      setSlots([]); setWalkins([])
    } finally {
      setSlotsLoading(false)
    }
  }, [branch, barberId, barbers, date, selectedServices])

  useEffect(() => { cargarSlots() }, [cargarSlots])

  // Recalcula si queda tira de días por desplazar (al montar, al elegir un
  // servicio -- que es cuando la tira aparece -- y ante cada scroll).
  const checkHayMasDias = useCallback(() => {
    const el = diasRef.current
    if (!el) return
    setHayMasDias(el.scrollWidth - el.scrollLeft - el.clientWidth > 4)
  }, [])
  // El div de la tira se monta recién al llegar al paso "horario" (antes
  // vivía en la misma pantalla que los servicios), así que el recálculo
  // depende de `step` y no de `selectedServices.length`.
  useEffect(() => { checkHayMasDias() }, [checkHayMasDias, step])

  // Cada paso (y la confirmación) arranca desde arriba. Sin esto, la pantalla
  // nueva heredaba el scroll de la anterior: al terminar de reservar, la
  // confirmación aparecía cortada, con el título y el código fuera de vista,
  // hasta que se tocaba la pantalla. 'instant' porque la página tiene
  // scroll-behavior: smooth y no queremos ver cómo sube.
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) }, [step, done])

  // Texto del barbero en los resúmenes de los pasos (no en la confirmación,
  // donde ya hay uno asignado).
  const barberLabel = barberId === BARBER_ANY
    ? 'Sin preferencia de barbero'
    : barbers.find((b) => b.id === barberId)?.full_name

  const chosen = services.filter((s) => selectedServices.includes(s.id))
  const totalPrice = chosen.reduce((a, s) => a + s.base_price, 0)
  const totalMin = chosen.reduce((a, s) => a + s.duration_min, 0)

  const dias = Array.from({ length: DIAS_VISIBLES }, (_, i) => addDays(todayInBusinessTz(), i))

  // Un solo servicio por turno -- elegir otro reemplaza al anterior, tocar
  // el ya elegido lo deselecciona. selectedServices sigue siendo un array
  // (0 o 1 elemento) porque así lo esperan getAvailableSlots/createBooking,
  // pensadas en su momento para combinar servicios.
  function selectService(id: string) {
    setSelectedServices((prev) => (prev[0] === id ? [] : [id]))
  }

  function elegirBarbero(id: string) {
    setBarberId(id)
    setStep('servicio')
  }

  // Con un solo barbero ese paso ni se muestra (se preselecciona en
  // cargarSucursal), así que la numeración de pasos se corre.
  const activeSteps: Step[] =
    barbers.length > 1 ? ['barbero', 'servicio', 'horario', 'contacto'] : ['servicio', 'horario', 'contacto']
  const stepIndex = (s: Step) => activeSteps.indexOf(s) + 1
  const totalSteps = activeSteps.length

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (!branch || !slotAt) return
    if (!name.trim()) { setFormError('Necesitamos tu nombre'); return }
    if (phone.trim().length < 6) { setFormError('Necesitamos un teléfono válido'); return }

    setSaving(true)
    setFormError(null)
    try {
      const res = await createBooking({
        branchId: branch.id,
        barberId,
        clientName: name.trim(),
        clientPhone: phone.trim(),
        clientEmail: email.trim() || null,
        startsAt: slotAt,
        serviceIds: selectedServices,
      })
      setDone(res)

      // La ficha de la confirmación sale de la base (dirección, fecha de
      // creación y, con "sin preferencia", el barbero que se asignó), con el
      // mismo código + teléfono que usa "Gestionar mi turno". Es un extra: si
      // falla, la pantalla sale con lo que ya se sabe.
      if (barberId !== BARBER_ANY) {
        setAssignedBarber(barbers.find((b) => b.id === barberId)?.full_name ?? null)
      }
      lookupBooking(res.reference, phone.trim())
        .then((l) => { if (l) { setFichaServidor(l); setAssignedBarber(l.barber_name) } })
        .catch(() => {})

      // El turno ya quedó reservado -- el mail es un extra. Si no hay email
      // cargado, si falta la API key, o si el envío falla, no se le muestra
      // ningún error a quien reservó: la confirmación en pantalla ya cumplió.
      // Solo viajan referencia + teléfono: el destinatario y el texto los
      // saca la ruta de la base.
      if (email.trim()) {
        fetch('/api/reservar/confirmar-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference: res.reference, phone: phone.trim() }),
        }).catch(() => {})
      }

      // Igual que el mail: no-opea sola si WHATSAPP_ACCESS_TOKEN no está
      // configurado (ver isWhatsAppConfigured en lib/whatsapp.ts), así que
      // es seguro llamarla siempre. Es el único aviso por WhatsApp: ya no
      // hay botón wa.me para que el cliente se lo mande a mano.
      fetch('/api/reservar/confirmar-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: res.reference, phone: phone.trim() }),
      }).catch(() => {})
    } catch (e) {
      // Los mensajes de la base ya están redactados para el cliente final.
      setFormError(e instanceof Error ? e.message : 'No pudimos confirmar el turno.')
      // Si el horario se ocupó mientras completaba los datos, volver al paso 1
      // con la grilla actualizada en vez de dejarlo trabado.
      await cargarSlots()
    } finally {
      setSaving(false)
    }
  }

  // ── Estados de pantalla completa ───────────────────────────────────
  if (loading) {
    return <div className="bk-screen bk-center"><p className="bk-muted">Cargando...</p></div>
  }
  if (fatal) {
    // Antes esta pantalla no tenía ningún botón: si la sucursal elegida
    // todavía no tenía servicios o barberos con horario, el cliente quedaba
    // trabado acá sin poder volver a elegir otra.
    const puedeVolver = allBranches.length > 1 && branch !== null
    return (
      <div className="bk-screen bk-center">
        <div className="bk-card bk-narrow">
          <p className="bk-title">No disponible</p>
          <p className="bk-muted">
            {branch && allBranches.length > 1 ? `${branch.name}: ` : ''}{fatal}
          </p>
          <div style={{ marginTop: '1rem' }}>
            {puedeVolver ? (
              <button type="button" className="bk-btn" onClick={volverASucursales}>
                ‹ Elegir otra sucursal
              </button>
            ) : (
              <button type="button" className="bk-btn" onClick={() => window.location.reload()}>
                Reintentar
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Solo aparece con dos o más sucursales activas y sin ?sucursal= válido en
  // la URL. Con una sola, este estado nunca se alcanza.
  if (branchChoices.length > 0) {
    return (
      <div className="bk-screen">
        {bookingHeader?.logo_url && (
          // Banner de ancho completo, no un logo chico al lado del título --
          // pedido explícito del usuario con una referencia de la
          // competencia (WeiBook): la marca general va arriba de todo, la
          // pregunta de sucursal queda debajo, en el header de siempre.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bookingHeader.logo_url} alt="" className="bk-hero-banner" />
        )}
        <header className="bk-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Título fijo a propósito: bookingHeader.title es el nombre de
                UNA sucursal puntual (la que se marcó como fuente del logo
                en /admin/marca) -- usarlo acá daba la impresión de estar
                ya "adentro" de esa sucursal en vez de eligiendo entre las
                tres. El logo de arriba sí sigue viniendo de esa marca. */}
            <p className="bk-header__title">Sucursales</p>
            <p className="bk-header__sub">¿A qué sucursal querés ir?</p>
          </div>
        </header>
        <div className="bk-body">
          <div className="bk-branches bk-branches--big">
            {branchChoices.map((b) => (
              <button
                key={b.id}
                type="button"
                className="bk-branch bk-branch--big"
                onClick={() => elegirSucursal(b)}
              >
                {b.logo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.logo_url} alt="" className="bk-branch__logo" />
                )}
                <span className="bk-branch__text">
                  <span className="bk-branch__name">{b.name}</span>
                  {b.address && <span className="bk-branch__address">{b.address}</span>}
                  {todayHoursLabel(b.business_hours) && (
                    <span className="bk-branch__hours">{todayHoursLabel(b.business_hours)}</span>
                  )}
                </span>
                <span className="bk-branch__chevron" aria-hidden="true">›</span>
              </button>
            ))}
          </div>

          {/* Sin coordenadas cargadas en ninguna sucursal, BranchesMap no
              renderiza nada -- comportamiento de siempre, sin configurar. */}
          <BranchesMap branches={branchChoices} />

          <div className="bk-footer">
            {/* El © es de la marca, no de una sucursal: bookingHeader.title
                es el nombre de UNA sucursal (la fuente del logo), y mostraba
                "San Juan" como dueña de los derechos. */}
            <p className="bk-copyright">
              © {new Date().getFullYear()} Valhalla. Todos los derechos reservados.
            </p>
            {/* "Desarrollado por" es un crédito al proveedor, no una
                afirmación de propiedad -- por eso no depende de si la
                barbería configuró su propia marca arriba. */}
            <p className="bk-credit">
              Desarrollado por{' '}
              <span className="bk-credit__brand" aria-label="Flowi">
                Flow
                <span className="bk-credit__i" aria-hidden="true">
                  ı<span className="bk-credit__dot" />
                </span>
              </span>{' '}
              Estudio
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (done) {
    // Ficha del turno recién reservado. Con la respuesta de la base (que trae
    // la dirección, la fecha de creación y el barbero ya asignado) si llegó;
    // mientras tanto, con lo que la pantalla ya sabe.
    const ficha: AppointmentLookup = fichaServidor ?? {
      reference: done.reference,
      starts_at: done.starts_at,
      ends_at: done.ends_at,
      status: 'reservado',
      barber_name: assignedBarber ?? '',
      client_name: name.trim(),
      total_price: totalPrice,
      services: chosen.map((s) => ({ name: s.name, price: s.base_price, duration_min: s.duration_min })),
      branch_name: branch?.name,
      branch_address: branch?.address,
      branch_latitude: branch?.latitude,
      branch_longitude: branch?.longitude,
      created_at: new Date().toISOString(),
    }
    return (
      <div className="bk-screen bk-center">
        <div className="bk-card bk-narrow">
          <div className="bk-check">✓</div>
          <TurnoFicha
            appt={ficha}
            titulo="Tu turno quedó reservado"
            centrado
            mostrarReferencia={false}
            bajoTitulo={
              <>
                <div className="bk-ref">
                  <span className="bk-ref__label">Código de reserva</span>
                  <span className="bk-ref__code">{done.reference}</span>
                </div>

                <p className="bk-muted bk-small">
                  Guardá este código: con él y tu teléfono podés consultar o cancelar el turno.
                </p>

                <a
                  className="bk-manage-link"
                  href={`/reservar/gestionar?ref=${done.reference}${branch?.id ? `&sucursal=${branch.id}` : ''}`}
                >
                  Gestionar mi turno
                </a>
              </>
            }
          >
            <button
              className="bk-btn bk-btn--ghost"
              // Navegación dura (no router.push): la carga inicial es un
              // useEffect con deps [] que solo corre al montar, así que un
              // push de cliente a la misma ruta no la vuelve a disparar.
              // A /reservar sin ?sucursal= a propósito: con 2+ sucursales el
              // selector ("home") es lo primero que hay que ver, no quedarse
              // en la que se acaba de reservar (antes, reload() mantenía el
              // ?sucursal= de la URL y saltaba directo a esa misma).
              onClick={() => { window.location.href = '/reservar' }}
            >
              Reservar otro turno
            </button>
            <p className="bk-muted bk-small bk-center-text bk-countdown">
              Volvemos al inicio en {autoReturnIn}s...
            </p>
          </TurnoFicha>
        </div>
      </div>
    )
  }

  // ── Paso "barbero": solo aparece con más de uno ────────────────────
  if (step === 'barbero') {
    return (
      <div className="bk-screen">
        <header className="bk-header">
          {/* Solo con 2+ sucursales hay a dónde volver -- con una sola,
              este paso ES el punto de entrada de /reservar. */}
          {allBranches.length > 1 && (
            <button className="bk-back" onClick={volverASucursales} aria-label="Volver a sucursales">‹</button>
          )}
          {branch?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branch.logo_url} alt="" className="bk-logo" />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="bk-header__title">¿Con quién te querés atender?</p>
            <p className="bk-header__sub">Paso {stepIndex('barbero')} de {totalSteps}</p>
          </div>
        </header>

        <div className="bk-body">
          <div className="bk-barber-grid">
            {/* Para quien no conoce a nadie: la base asigna un barbero libre
                al confirmar (113). Va primero y ocupa todo el ancho. */}
            <button
              type="button"
              onClick={() => elegirBarbero(BARBER_ANY)}
              className={`bk-barber-card bk-barber-card--any${barberId === BARBER_ANY ? ' bk-barber-card--on' : ''}`}
            >
              <span className="bk-barber-card__photo">
                <span className="bk-barber-card__placeholder" aria-hidden="true">🎲</span>
              </span>
              <span className="bk-barber-card__text">
                <span className="bk-barber-card__name">Sin preferencia</span>
                <span className="bk-barber-card__hint">Elegimos por vos al barbero con lugar libre</span>
              </span>
            </button>
            {barbers.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => elegirBarbero(b.id)}
                className={`bk-barber-card${barberId === b.id ? ' bk-barber-card--on' : ''}`}
              >
                <span className="bk-barber-card__photo">
                  {b.avatar_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={b.avatar_url} alt="" />
                    : <span className="bk-barber-card__placeholder">👤</span>}
                </span>
                <span className="bk-barber-card__name">{b.full_name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Paso "servicio" ─────────────────────────────────────────────────
  if (step === 'servicio') {
    const esPrimerPaso = activeSteps[0] === 'servicio'
    return (
      <div className="bk-screen">
        <header className="bk-header">
          {esPrimerPaso ? (
            <>
              {allBranches.length > 1 && (
                <button className="bk-back" onClick={volverASucursales} aria-label="Volver a sucursales">‹</button>
              )}
              {branch?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={branch.logo_url} alt="" className="bk-logo" />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="bk-header__title">{branch?.welcome_title || branch?.name}</p>
                {branch?.welcome_title && branch?.name && (
                  <p className="bk-header__sub">{branch.name}</p>
                )}
                {branch?.address && <p className="bk-header__sub">{branch.address}</p>}
              </div>
            </>
          ) : (
            <>
              <button className="bk-back" onClick={() => setStep('barbero')} aria-label="Volver">‹</button>
              <div>
                <p className="bk-header__title">¿Qué te vas a hacer?</p>
                <p className="bk-header__sub">Paso {stepIndex('servicio')} de {totalSteps}</p>
              </div>
            </>
          )}
        </header>

        <div className="bk-body">
          {esPrimerPaso && branch?.welcome_description && (
            <p className="bk-welcome-desc">{branch.welcome_description}</p>
          )}
          {esPrimerPaso && <p className="bk-section">¿Qué te vas a hacer?</p>}

          <div className="bk-services">
            {services.map((s) => {
              const on = selectedServices.includes(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectService(s.id)}
                  className={`bk-service${on ? ' bk-service--on' : ''}`}
                  aria-pressed={on}
                >
                  <span className="bk-service__main">
                    <span className="bk-service__name">
                      {s.name}
                      {s.id === popularId && <span className="bk-service__badge">Más elegido</span>}
                    </span>
                    {s.description && <span className="bk-service__desc">{s.description}</span>}
                    <span className="bk-service__meta">{s.duration_min} min</span>
                  </span>
                  <span className="bk-service__price">{formatARS(s.base_price)}</span>
                </button>
              )
            })}
          </div>
        </div>

        {selectedServices.length > 0 && (
          <div className="bk-bottom">
            <div className="bk-bottom__info">
              <span className="bk-bottom__label">
                {chosen.length} servicio{chosen.length !== 1 ? 's' : ''} · {totalMin} min
              </span>
              <span className="bk-bottom__total">{formatARS(totalPrice)}</span>
            </div>
            <button className="bk-btn bk-btn--sm" onClick={() => setStep('horario')}>
              Siguiente
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Paso "horario": día y hora, en una sola lista sin franjas ──────
  if (step === 'horario') {
    return (
      <div className="bk-screen">
        <header className="bk-header">
          <button className="bk-back" onClick={() => setStep('servicio')} aria-label="Volver">‹</button>
          <div>
            <p className="bk-header__title">¿Qué día y a qué hora?</p>
            <p className="bk-header__sub">Paso {stepIndex('horario')} de {totalSteps}</p>
          </div>
        </header>

        <div className="bk-body">
          <div className="bk-card bk-mb">
            <p className="bk-slotpick">{chosen.map((s) => s.name).join(' + ')}</p>
            <p className="bk-muted bk-small">
              {totalMin} min · {barberLabel}
            </p>
          </div>

          {/* Días */}
          <p className="bk-section">¿Qué día?</p>
          <div className="bk-days-row">
            <div className={`bk-days-wrap${hayMasDias ? ' bk-days-wrap--more' : ''}`}>
              <div className="bk-days" ref={diasRef} onScroll={checkHayMasDias}>
                {dias.map((d) => {
                  const { dow, day } = dayChipLabel(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDate(d)}
                      className={`bk-day${date === d ? ' bk-day--on' : ''}`}
                    >
                      <span className="bk-day__dow">{dow}</span>
                      <span className="bk-day__num">{day}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            {/* Para reservar más allá de los DIAS_VISIBLES de la tira -- la
                base no tiene tope, solo la tira lo tenía. */}
            <label className="bk-day-jump" aria-label="Elegir otra fecha">
              📅
              <input
                type="date"
                value={date}
                min={todayInBusinessTz()}
                max={addDays(todayInBusinessTz(), DIAS_MAX_ADELANTE)}
                onChange={(e) => { if (e.target.value) setDate(e.target.value) }}
              />
            </label>
          </div>

          {/* Aviso de orden de llegada — el caso de Valhalla */}
          {walkins.length > 0 && (
            <div className="bk-walkin">
              <span className="bk-walkin__icon">ℹ️</span>
              <span>
                De {walkins[0].start_time.slice(0, 5)} a {walkins[0].end_time.slice(0, 5)} se
                atiende <strong>por orden de llegada</strong>, sin turno. Los horarios de abajo
                son los que sí se reservan.
              </span>
            </div>
          )}

          {/* Horarios: una sola lista con todo lo disponible, sin separar
              por mañana/tarde/noche. */}
          <p className="bk-section">Horarios disponibles</p>
          {slotsLoading ? (
            <p className="bk-muted bk-center-text">Buscando horarios...</p>
          ) : slots.length === 0 ? (
            <div className="bk-empty">
              <p className="bk-muted">No hay horarios disponibles este día.</p>
              <p className="bk-hint">Probá con otro día de la tira de arriba.</p>
            </div>
          ) : (
            <div className="bk-slots">
              {slots.map((s) => (
                <button
                  key={s.slot_at}
                  type="button"
                  onClick={() => setSlotAt(s.slot_at)}
                  className={`bk-slot${slotAt === s.slot_at ? ' bk-slot--on' : ''}`}
                >
                  {slotTime(s.slot_at)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bk-bottom">
          <div className="bk-bottom__info">
            <span className="bk-bottom__label">
              {slotAt ? `${slotDateLong(slotAt)} · ${slotTime(slotAt)}` : 'Elegí un horario'}
            </span>
          </div>
          <button
            className="bk-btn bk-btn--sm"
            disabled={!slotAt}
            onClick={() => setStep('contacto')}
          >
            Siguiente
          </button>
        </div>
      </div>
    )
  }

  // ── Paso "contacto": nombre y teléfono → confirmar ─────────────────
  return (
    <div className="bk-screen">
      <header className="bk-header">
        <button className="bk-back" onClick={() => setStep('horario')} aria-label="Volver">‹</button>
        <div>
          <p className="bk-header__title">Tus datos</p>
          <p className="bk-header__sub">Paso {stepIndex('contacto')} de {totalSteps}</p>
        </div>
      </header>

      <div className="bk-body">
        <div className="bk-card bk-mb">
          <p className="bk-slotpick">
            {slotAt && slotDateLong(slotAt)} · {slotAt && slotTime(slotAt)}
          </p>
          <p className="bk-muted bk-small">
            {chosen.map((s) => s.name).join(' + ')} · {totalMin} min ·{' '}
            {barberLabel}
          </p>
        </div>

        <form onSubmit={handleConfirm} className="bk-form">
          <label className="bk-label" htmlFor="bk-name">Nombre y apellido *</label>
          <input
            id="bk-name" className="bk-input" value={name} autoComplete="name"
            onChange={(e) => setName(e.target.value)} placeholder="Juan Pérez"
          />

          <label className="bk-label" htmlFor="bk-phone">Teléfono *</label>
          <PhoneInput
            id="bk-phone" className="bk-input" value={phone} onChange={setPhone}
            hintClassName="bk-hint"
          />
          <p className="bk-hint">Lo usamos para confirmarte el turno y avisarte si hay cambios.</p>

          <label className="bk-label" htmlFor="bk-email">Email (opcional)</label>
          <input
            id="bk-email" className="bk-input" value={email} type="email" autoComplete="email"
            onChange={(e) => setEmail(e.target.value)} placeholder="juan@mail.com"
          />
          <p className="bk-hint">Si lo dejás, te mandamos la confirmación con el detalle del turno.</p>

          {formError && <p className="bk-error">{formError}</p>}

          <button type="submit" className="bk-btn" disabled={saving}>
            {saving ? 'Confirmando...' : `Confirmar turno · ${formatARS(totalPrice)}`}
          </button>
          <p className="bk-hint bk-center-text">No se cobra nada online. Pagás en el local.</p>
        </form>
      </div>
    </div>
  )
}
