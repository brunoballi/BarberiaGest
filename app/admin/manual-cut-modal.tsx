'use client'

import { useEffect, useRef, useState } from 'react'
import {
  getAllBarbersByBranch,
  getServicesByBranch,
  registerCut,
} from '@/lib/supabase/supabase.client'
import type {
  Profile,
  ServiceCatalog,
  PaymentMethod,
  RegisterCutPayload,
} from '@/lib/supabase/database.types'
import './admin-dashboard.css'

interface Props {
  branchId:       string
  weekId:         string
  weekStartDate:  string  // YYYY-MM-DD (lunes)
  weekEndDate:    string  // YYYY-MM-DD (domingo)
  adminId:        string
  onClose:        () => void
  onSuccess:      () => void
}

const DAY_NAMES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildScrollDays(center: string, back = 7, forward = 7) {
  const [y, m, d] = center.split('-').map(Number)
  return Array.from({ length: back + forward + 1 }, (_, i) => {
    const dt  = new Date(y, m - 1, d - back + i)
    const str = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    return { date: str, label: DAY_NAMES[dt.getDay()], dayNum: dt.getDate(), month: MONTH_NAMES[dt.getMonth()] }
  })
}

export default function ManualCutModal({
  branchId, weekId, weekStartDate, weekEndDate, adminId, onClose, onSuccess,
}: Props) {
  const [barbers,  setBarbers]   = useState<Profile[]>([])
  const [services, setServices]  = useState<ServiceCatalog[]>([])
  const [loading,  setLoading]   = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error,    setError]     = useState<string | null>(null)

  // Form
  const [barberId,    setBarberId]    = useState('')
  const [serviceId,   setServiceId]   = useState('')
  const [customAmt,   setCustomAmt]   = useState('')
  const [method,      setMethod]      = useState<PaymentMethod | ''>('')
  const [date,        setDate]        = useState(todayStr)
  const [clientName,  setClientName]  = useState('')
  const [discount,    setDiscount]    = useState('')

  const today      = todayStr()
  const scrollDays = buildScrollDays(today, 7, 7)
  const todayRef   = useRef<HTMLButtonElement>(null)
  const stripRef   = useRef<HTMLDivElement>(null)

  function slideLeft()  { stripRef.current?.scrollBy({ left: -132, behavior: 'smooth' }) }
  function slideRight() { stripRef.current?.scrollBy({ left:  132, behavior: 'smooth' }) }

  useEffect(() => {
    async function load() {
      try {
        const [bs, svcs] = await Promise.all([
          getAllBarbersByBranch(branchId),
          getServicesByBranch(branchId),
        ])
        setBarbers(bs.filter((b) => b.is_active))
        setServices(svcs.filter((s) => s.is_active))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error cargando datos')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [branchId])

  // Auto-scroll al día de hoy al abrir
  useEffect(() => {
    todayRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' })
  }, [loading])

  const selectedService = services.find((s) => s.id === serviceId)
  const resolvedAmount  = customAmt
    ? parseFloat(customAmt)
    : selectedService?.base_price ?? 0
  const discountNum     = parseFloat(discount) || 0
  const effectiveAmount = Math.max(0, resolvedAmount - discountNum)

  const isValid = barberId && serviceId && method && effectiveAmount > 0 && !!date

  async function handleSubmit() {
    if (!isValid) return
    const barber = barbers.find((b) => b.id === barberId)
    if (!barber) { setError('Barbero no encontrado'); return }
    setSubmitting(true)
    setError(null)
    try {
      const payload: RegisterCutPayload = {
        service_id:        serviceId,
        amount:            effectiveAmount,
        payment_method:    method as PaymentMethod,
        transaction_date:  date,
        cash_amount:       method === 'cash'     ? effectiveAmount : 0,
        transfer_amount:   method === 'transfer' ? effectiveAmount : 0,
        card_amount:       0,
        client_name:       clientName.trim() || null,
        discount_amount:   discountNum > 0 ? discountNum : 0,
        discount_reason:   null,
      }
      await registerCut(payload, barber, weekId, adminId)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al registrar')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Registrar corte (admin)</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {loading ? (
          <div className="modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
            <div className="admin-loader" style={{ margin: '0 auto' }} />
          </div>
        ) : (
          <>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {error && <p className="form-error">{error}</p>}

              <label className="form-label">Barbero *</label>
              <select className="form-input" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
                <option value="">— elegir barbero —</option>
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>{b.full_name}</option>
                ))}
              </select>

              <label className="form-label">Día *</label>
              {/* ── Day slider ─────────────────────────────────── */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                {/* Arrow izquierda */}
                <button
                  type="button" onClick={slideLeft}
                  style={{
                    flexShrink: 0, width: '1.6rem', height: '1.6rem', borderRadius: '50%',
                    background: '#27272a', border: '1px solid #3f3f46', color: '#a1a1aa',
                    fontSize: '1rem', lineHeight: 1, cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >‹</button>

                {/* Strip scrolleable */}
                <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                  {/* Fade izquierda */}
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0, width: '1.25rem', zIndex: 1,
                    background: 'linear-gradient(to right, #1a1a1a, transparent)', pointerEvents: 'none',
                  }} />
                  {/* Fade derecha */}
                  <div style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: '1.25rem', zIndex: 1,
                    background: 'linear-gradient(to left, #1a1a1a, transparent)', pointerEvents: 'none',
                  }} />

                  <div
                    ref={stripRef}
                    style={{
                      display: 'flex', gap: '0.3rem', overflowX: 'auto', padding: '0.1rem 0 4px',
                      scrollbarWidth: 'none', scrollSnapType: 'x mandatory',
                    }}
                  >
                    {scrollDays.map((d) => {
                      const isToday  = d.date === today
                      const selected = d.date === date
                      return (
                        <button
                          key={d.date}
                          ref={isToday ? todayRef : undefined}
                          type="button"
                          onClick={() => setDate(d.date)}
                          style={{
                            flex: '0 0 auto', width: '2.75rem', padding: '0.45rem 0.2rem',
                            borderRadius: '0.5rem', textAlign: 'center', cursor: 'pointer',
                            scrollSnapAlign: 'center',
                            background: selected ? '#a78bfa' : '#18181b',
                            border: `1px solid ${selected ? '#a78bfa' : isToday ? '#52525b' : '#27272a'}`,
                            boxShadow: selected ? '0 0 0 2px rgba(167,139,250,0.35)' : 'none',
                            transition: 'background 0.12s, border-color 0.12s',
                          }}
                        >
                          <div style={{ fontSize: '0.62rem', fontWeight: 600, color: selected ? '#2e006c' : '#71717a' }}>
                            {d.label}
                          </div>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: selected ? '#0d0d0d' : '#e4e4e7' }}>
                            {d.dayNum}
                          </div>
                          <div style={{ fontSize: '0.58rem', color: selected ? '#2e006c' : isToday ? '#a78bfa' : '#3f3f46' }}>
                            {isToday ? 'hoy' : d.month}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Arrow derecha */}
                <button
                  type="button" onClick={slideRight}
                  style={{
                    flexShrink: 0, width: '1.6rem', height: '1.6rem', borderRadius: '50%',
                    background: '#27272a', border: '1px solid #3f3f46', color: '#a1a1aa',
                    fontSize: '1rem', lineHeight: 1, cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >›</button>
              </div>

              <label className="form-label">Servicio *</label>
              <select
                className="form-input"
                value={serviceId}
                onChange={(e) => {
                  setServiceId(e.target.value)
                  setCustomAmt('')
                }}
              >
                <option value="">— elegir servicio —</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.base_price > 0 && `· ${formatARS(s.base_price)}`}
                  </option>
                ))}
              </select>

              <label className="form-label">Monto (precio base o personalizado)</label>
              <input
                type="number"
                inputMode="numeric"
                className="form-input"
                placeholder={selectedService ? String(selectedService.base_price) : '0'}
                value={customAmt}
                onChange={(e) => setCustomAmt(e.target.value)}
              />

              <label className="form-label">Método de pago *</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(['cash', 'transfer'] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    style={{
                      flex: 1,
                      padding: '0.55rem',
                      borderRadius: '0.5rem',
                      background: method === m ? '#a78bfa' : '#18181b',
                      border: `1px solid ${method === m ? '#a78bfa' : '#27272a'}`,
                      color: method === m ? '#0d0d0d' : '#e4e4e7',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {m === 'cash' ? 'Efectivo' : 'Transferencia'}
                  </button>
                ))}
              </div>

              <label className="form-label">Cliente (opcional)</label>
              <input
                className="form-input"
                placeholder="Nombre del cliente"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />

              <label className="form-label">Descuento (opcional)</label>
              <input
                type="number"
                inputMode="numeric"
                className="form-input"
                placeholder="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />

              {effectiveAmount > 0 && (
                <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.85rem', marginTop: '0.4rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#a1a1aa' }}>Total a cobrar</span>
                    <strong style={{ color: '#fff' }}>{formatARS(effectiveAmount)}</strong>
                  </div>
                  {discountNum > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', fontSize: '0.78rem' }}>
                      <span>Descuento</span>
                      <span>−{formatARS(discountNum)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={onClose} className="admin-btn admin-btn--ghost">Cancelar</button>
              <button
                onClick={handleSubmit}
                disabled={!isValid || submitting}
                className="admin-btn admin-btn--primary"
              >
                {submitting ? 'Registrando...' : 'Registrar corte'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
