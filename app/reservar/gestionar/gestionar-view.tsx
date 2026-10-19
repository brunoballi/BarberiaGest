'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  lookupBooking,
  cancelBooking,
  type AppointmentLookup,
} from '@/lib/supabase/booking'
import { PhoneInput } from '@/app/components/phone-input'
import TurnoFicha from '../turno-ficha'
import '../reservar.css'

const CANCELABLE: string[] = ['reservado', 'llego']

/**
 * Consultar/cancelar un turno con código + teléfono -- los dos juntos,
 * nunca uno solo (mismo criterio de seguridad que el resto de la reserva
 * pública, sección 5.7 del handoff: con el código solo, alguien podría
 * probar combinaciones y cancelarle el turno a otro).
 *
 * `lookupBooking`/`cancelBooking` (lib/supabase/booking.ts) ya existían
 * desde la Fase 2 del turnero, sin usar en ningún lado -- esta es la
 * primera pantalla que las consume.
 */
export default function GestionarView() {
  const searchParams = useSearchParams()
  const refParam = searchParams.get('ref') ?? ''
  const sucursalParam = searchParams.get('sucursal')
  // Con esto en la URL, "reservar otro turno" vuelve a la misma sucursal en
  // vez de mandar de nuevo al selector (solo importa si hay 2+ activas).
  const volverAReservarHref = sucursalParam ? `/reservar?sucursal=${sucursalParam}` : '/reservar'

  const [reference, setReference] = useState(refParam)
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appt, setAppt] = useState<AppointmentLookup | null>(null)

  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // Al mostrar la ficha (y al pasar a "cancelado") se arranca desde arriba: la
  // ficha es más larga que el formulario y heredaba el scroll de la pantalla anterior.
  const estadoDelTurno = appt?.status
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) }, [estadoDelTurno])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!reference.trim() || !phone.trim()) return
    setLoading(true)
    setError(null)
    try {
      const found = await lookupBooking(reference.trim().toUpperCase(), phone.trim())
      if (!found) {
        // Mensaje a propósito genérico: no distingue "código inexistente" de
        // "teléfono incorrecto" -- eso le confirmaría a un curioso que el
        // código es válido.
        setError('No encontramos ningún turno con ese código y teléfono.')
        return
      }
      setAppt(found)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al consultar el turno')
    } finally {
      setLoading(false)
    }
  }

  async function handleCancel() {
    if (!appt) return
    setCancelling(true)
    setError(null)
    try {
      await cancelBooking(reference.trim().toUpperCase(), phone.trim())
      setConfirmingCancel(false)
      // Se muestra la misma ficha, ya con la etiqueta "Cancelado". Si la
      // relectura fallara, se marca a mano: el turno ya quedó cancelado.
      const fresca = await lookupBooking(reference.trim().toUpperCase(), phone.trim()).catch(() => null)
      setAppt(fresca ?? { ...appt, status: 'cancelado', cancelled_at: new Date().toISOString() })

      // El turno ya quedó cancelado -- el aviso es un extra, igual que el
      // mail/WhatsApp de confirmación al reservar. No-opea sola si
      // WHATSAPP_ACCESS_TOKEN no está configurado (ver isWhatsAppConfigured
      // en lib/whatsapp.ts), así que es seguro llamarla siempre. El nombre
      // de la sucursal lo saca la ruta de la base.
      fetch('/api/reservar/cancelar-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: reference.trim().toUpperCase(),
          phone: phone.trim(),
        }),
      }).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cancelar el turno')
    } finally {
      setCancelling(false)
    }
  }

  if (appt) {
    const puedeCancelar = CANCELABLE.includes(appt.status)
    return (
      <div className="bk-screen bk-center">
        <div className="bk-card bk-narrow">
          <TurnoFicha appt={appt}>
            {!puedeCancelar && appt.status !== 'cancelado' && (
              <p className="bk-muted bk-small bk-mt">
                Este turno ya no se puede cancelar desde acá. Consultá directo con la barbería.
              </p>
            )}

            {puedeCancelar && !confirmingCancel && (
              <button className="bk-btn bk-btn--danger" onClick={() => setConfirmingCancel(true)}>
                Cancelar turno
              </button>
            )}

            {puedeCancelar && confirmingCancel && (
              <div className="bk-confirm-cancel">
                <p className="bk-muted bk-small">¿Seguro que querés cancelar este turno?</p>
                <div className="bk-confirm-cancel__actions">
                  <button className="bk-btn bk-btn--danger" disabled={cancelling} onClick={handleCancel}>
                    {cancelling ? 'Cancelando...' : 'Sí, cancelar'}
                  </button>
                  <button className="bk-btn bk-btn--ghost" disabled={cancelling} onClick={() => setConfirmingCancel(false)}>
                    No
                  </button>
                </div>
              </div>
            )}

            {!puedeCancelar && (
              <a className="bk-btn bk-btn--ghost" href={volverAReservarHref}>Reservar otro turno</a>
            )}

            {error && <p className="bk-error">{error}</p>}
          </TurnoFicha>
        </div>
      </div>
    )
  }

  return (
    <div className="bk-screen bk-center">
      <div className="bk-card bk-narrow">
        <h1 className="bk-title">Gestionar mi turno</h1>
        <p className="bk-muted bk-mb">Ingresá el código de reserva y el teléfono con el que reservaste.</p>

        <form onSubmit={handleSubmit} className="bk-form">
          <div>
            <p className="bk-section">Código de reserva</p>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value.toUpperCase())}
              placeholder="Ej: F9626047"
              maxLength={12}
              className="bk-input"
              required
            />
          </div>
          <div>
            <p className="bk-section">Teléfono</p>
            <PhoneInput value={phone} onChange={setPhone} className="bk-input" />
          </div>

          {error && <p className="bk-error">{error}</p>}

          <button type="submit" className="bk-btn" disabled={loading}>
            {loading ? 'Buscando...' : 'Buscar mi turno'}
          </button>
        </form>
      </div>
    </div>
  )
}
