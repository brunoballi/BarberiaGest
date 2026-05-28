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
  weekStartDate:  string
  weekEndDate:    string
  adminId:        string
  onClose:        () => void
  onSuccess:      () => void
}

const DAY_NAMES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
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

// ── Chip de servicio ──────────────────────────────────────────────────────
function SvcChip({ label, price, active, onClick }: { label: string; price: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '0.55rem 0.4rem',
        borderRadius: '0.5rem',
        textAlign: 'center',
        cursor: 'pointer',
        background: active ? '#a78bfa' : '#18181b',
        border: `1px solid ${active ? '#a78bfa' : '#27272a'}`,
        color: active ? '#0d0d0d' : '#e4e4e7',
        fontSize: '0.78rem',
        fontWeight: 600,
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      {label}
      {price > 0 && (
        <span style={{ display: 'block', fontSize: '0.65rem', opacity: 0.6, marginTop: '0.15rem' }}>
          {formatARS(price)}
        </span>
      )}
    </button>
  )
}

// ── Chip de método de pago ────────────────────────────────────────────────
function PayChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: '0.55rem', borderRadius: '0.5rem',
        background: active ? '#a78bfa' : '#18181b',
        border: `1px solid ${active ? '#a78bfa' : '#27272a'}`,
        color: active ? '#0d0d0d' : '#e4e4e7',
        fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
        transition: 'background 0.1s',
      }}
    >
      {label}
    </button>
  )
}

export default function ManualCutModal({
  branchId, weekId, weekStartDate, adminId, onClose, onSuccess,
}: Props) {
  const [barbers,    setBarbers]   = useState<Profile[]>([])
  const [services,   setServices]  = useState<ServiceCatalog[]>([])
  const [loading,    setLoading]   = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]     = useState<string | null>(null)

  // Form — igual que formulario barbero
  const [barberId,      setBarberId]      = useState('')
  const [date,          setDate]          = useState(todayStr)
  const [serviceId,     setServiceId]     = useState('')
  const [customAmt,     setCustomAmt]     = useState('')
  const [clientName,    setClientName]    = useState('')
  const [discount,      setDiscount]      = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [observations,  setObservations]  = useState('')
  const [method,        setMethod]        = useState<PaymentMethod | ''>('')
  const [splitPayment,  setSplitPayment]  = useState(false)
  const [cashPart,      setCashPart]      = useState('')
  const [transferPart,  setTransferPart]  = useState('')

  const today      = todayStr()
  // Días hacia atrás: cubrir desde el inicio de la semana seleccionada + buffer
  const daysBack   = Math.max(30, Math.round(
    (new Date(today + 'T12:00:00').getTime() - new Date(weekStartDate + 'T12:00:00').getTime())
    / (1000 * 60 * 60 * 24)
  ) + 3)
  const scrollDays = buildScrollDays(today, daysBack, 7)
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

  useEffect(() => {
    todayRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' })
  }, [loading])

  const selectedService = services.find((s) => s.id === serviceId)
  const resolvedAmount  = customAmt ? parseFloat(customAmt) : (selectedService?.base_price ?? 0)
  const discountNum     = parseFloat(discount) || 0
  const effectiveAmount = Math.max(0, resolvedAmount - discountNum)
  const cashNum         = parseFloat(cashPart) || 0
  const transferNum     = parseFloat(transferPart) || 0

  // Cuando effectiveAmount cambia y el split está activo, recalcular partes
  useEffect(() => {
    if (!splitPayment || effectiveAmount < 0) return
    if (effectiveAmount === 0) { setCashPart('0'); setTransferPart('0'); return }
    const half = Math.round(effectiveAmount / 2)
    setCashPart(String(half))
    setTransferPart(String(effectiveAmount - half))
  }, [effectiveAmount, splitPayment])

  const splitValid = splitPayment
    ? effectiveAmount === 0 || (cashNum + transferNum > 0 && Math.abs(cashNum + transferNum - effectiveAmount) <= 1)
    : !!method
  const isValid = !!barberId && !!serviceId && effectiveAmount >= 0 && !!date && splitValid

  async function handleSubmit() {
    setError(null)
    if (!barberId)      { setError('Seleccioná un barbero'); return }
    if (!serviceId)     { setError('Seleccioná un servicio'); return }
    if (discountNum > resolvedAmount) { setError('El descuento no puede superar el precio del servicio'); return }
    if (resolvedAmount <= 0)          { setError('Ingresá un monto válido'); return }

    let paymentMethodFinal: PaymentMethod
    let cashAmt = 0
    let transferAmt = 0

    if (effectiveAmount === 0) {
      // Descuento 100%: no hay dinero que cobrar
      paymentMethodFinal = 'cash'
      cashAmt = 0; transferAmt = 0
    } else if (splitPayment) {
      if (!splitValid) {
        setError(`La suma (${formatARS(cashNum + transferNum)}) debe ser igual al total (${formatARS(effectiveAmount)})`)
        return
      }
      paymentMethodFinal = 'mixed'
      cashAmt     = cashNum
      transferAmt = transferNum
    } else {
      if (!method) { setError('Seleccioná un método de pago'); return }
      paymentMethodFinal = method as PaymentMethod
      cashAmt     = method === 'cash'     ? effectiveAmount : 0
      transferAmt = method === 'transfer' ? effectiveAmount : 0
    }

    const barber = barbers.find((b) => b.id === barberId)
    if (!barber) { setError('Barbero no encontrado'); return }

    const parts = [discountReason.trim(), observations.trim()].filter(Boolean)
    const discountReasonFinal = parts.length ? parts.join(' | ') : null

    setSubmitting(true)
    try {
      const payload: RegisterCutPayload = {
        service_id:       serviceId,
        amount:           effectiveAmount,
        payment_method:   paymentMethodFinal,
        transaction_date: date,
        cash_amount:      cashAmt,
        transfer_amount:  transferAmt,
        card_amount:      0,
        client_name:      clientName.trim() || null,
        discount_amount:  discountNum > 0 ? discountNum : 0,
        discount_reason:  discountReasonFinal,
      }
      await registerCut(payload, barber, weekId, adminId)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al registrar')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
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
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {error && <p className="form-error">{error}</p>}

              {/* ── Barbero ── */}
              <div>
                <label className="form-label">Barbero *</label>
                <select className="form-input" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
                  <option value="">— elegir barbero —</option>
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>{b.full_name}</option>
                  ))}
                </select>
              </div>

              {/* ── Día (slider) ── */}
              <div>
                <label className="form-label">Día *</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <button type="button" onClick={slideLeft} style={{ flexShrink: 0, width: '1.6rem', height: '1.6rem', borderRadius: '50%', background: '#27272a', border: '1px solid #3f3f46', color: '#a1a1aa', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                  <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '1.25rem', zIndex: 1, background: 'linear-gradient(to right, #1a1a1a, transparent)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '1.25rem', zIndex: 1, background: 'linear-gradient(to left, #1a1a1a, transparent)', pointerEvents: 'none' }} />
                    <div ref={stripRef} style={{ display: 'flex', gap: '0.3rem', overflowX: 'auto', padding: '0.1rem 0 4px', scrollbarWidth: 'none' }}>
                      {scrollDays.map((d) => {
                        const isToday  = d.date === today
                        const selected = d.date === date
                        return (
                          <button key={d.date} ref={isToday ? todayRef : undefined} type="button" onClick={() => setDate(d.date)}
                            style={{ flex: '0 0 auto', width: '2.75rem', padding: '0.45rem 0.2rem', borderRadius: '0.5rem', textAlign: 'center', cursor: 'pointer', background: selected ? '#a78bfa' : '#18181b', border: `1px solid ${selected ? '#a78bfa' : isToday ? '#52525b' : '#27272a'}`, boxShadow: selected ? '0 0 0 2px rgba(167,139,250,0.35)' : 'none', transition: 'background 0.12s, border-color 0.12s' }}
                          >
                            <div style={{ fontSize: '0.62rem', fontWeight: 600, color: selected ? '#2e006c' : '#71717a' }}>{d.label}</div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: selected ? '#0d0d0d' : '#e4e4e7' }}>{d.dayNum}</div>
                            <div style={{ fontSize: '0.58rem', color: selected ? '#2e006c' : isToday ? '#a78bfa' : '#3f3f46' }}>{isToday ? 'hoy' : d.month}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <button type="button" onClick={slideRight} style={{ flexShrink: 0, width: '1.6rem', height: '1.6rem', borderRadius: '50%', background: '#27272a', border: '1px solid #3f3f46', color: '#a1a1aa', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                </div>
              </div>

              {/* ── Servicio (chips) ── */}
              <div>
                <label className="form-label">Servicio *</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
                  {services.map((s) => (
                    <SvcChip
                      key={s.id}
                      label={s.name}
                      price={s.base_price}
                      active={serviceId === s.id}
                      onClick={() => { setServiceId(s.id); setCustomAmt('') }}
                    />
                  ))}
                </div>
              </div>

              {/* ── Monto ── */}
              <div>
                <label className="form-label">Monto cobrado</label>
                <input
                  type="number" inputMode="numeric" className="form-input"
                  placeholder={selectedService ? String(selectedService.base_price) : '0'}
                  value={customAmt}
                  onChange={(e) => setCustomAmt(e.target.value)}
                />
              </div>

              {/* ── Cliente ── */}
              <div>
                <label className="form-label">Cliente <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
                <input
                  className="form-input"
                  placeholder="Nombre del cliente"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  maxLength={60}
                />
              </div>

              {/* ── Descuento ── */}
              <div>
                <label className="form-label">Descuento <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '0.5rem' }}>
                  <input
                    type="number" inputMode="numeric" className="form-input"
                    placeholder="$0"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                  <input
                    className="form-input"
                    placeholder="Motivo del descuento"
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    disabled={discountNum <= 0}
                    maxLength={80}
                  />
                </div>
                {discountNum > 0 && resolvedAmount > 0 && (
                  <p style={{ color: '#f59e0b', fontSize: '0.75rem', marginTop: '0.3rem' }}>
                    {formatARS(resolvedAmount)} − {formatARS(discountNum)} = <strong>{formatARS(effectiveAmount)}</strong>
                  </p>
                )}
              </div>

              {/* ── Observaciones ── */}
              <div>
                <label className="form-label">Observaciones <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
                <input
                  className="form-input"
                  placeholder="Detalle adicional del servicio..."
                  value={observations}
                  onChange={(e) => setObservations(e.target.value)}
                  maxLength={120}
                />
              </div>

              {/* ── Método de pago ── */}
              <div>
                <label className="form-label">Método de pago *</label>

                {!splitPayment && (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <PayChip label="Efectivo"      active={method === 'cash'}     onClick={() => setMethod('cash')} />
                    <PayChip label="Transferencia" active={method === 'transfer'} onClick={() => setMethod('transfer')} />
                  </div>
                )}

                {/* Toggle mixto */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.6rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={splitPayment}
                    onChange={(e) => {
                      setSplitPayment(e.target.checked)
                      if (e.target.checked) {
                        setMethod('')
                        if (effectiveAmount > 0) {
                          const half = Math.round(effectiveAmount / 2)
                          setCashPart(String(half))
                          setTransferPart(String(effectiveAmount - half))
                        }
                      } else {
                        setCashPart('')
                        setTransferPart('')
                      }
                    }}
                    style={{ width: '1rem', height: '1rem', accentColor: '#a78bfa' }}
                  />
                  <span style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Pago mixto (efectivo + transferencia)</span>
                </label>

                {splitPayment && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <div>
                      <p style={{ fontSize: '0.72rem', color: '#71717a', marginBottom: '0.25rem' }}>Efectivo $</p>
                      <input
                        type="number" inputMode="numeric" className="form-input"
                        placeholder="0" value={cashPart}
                        onChange={(e) => {
                          setCashPart(e.target.value)
                          const rest = effectiveAmount - (parseFloat(e.target.value) || 0)
                          if (rest >= 0) setTransferPart(String(Math.round(rest)))
                        }}
                      />
                    </div>
                    <div>
                      <p style={{ fontSize: '0.72rem', color: '#71717a', marginBottom: '0.25rem' }}>Transferencia $</p>
                      <input
                        type="number" inputMode="numeric" className="form-input"
                        placeholder="0" value={transferPart}
                        onChange={(e) => {
                          setTransferPart(e.target.value)
                          const rest = effectiveAmount - (parseFloat(e.target.value) || 0)
                          if (rest >= 0) setCashPart(String(Math.round(rest)))
                        }}
                      />
                    </div>
                    {(cashNum + transferNum) > 0 && (
                      <p style={{ gridColumn: '1/-1', fontSize: '0.75rem', textAlign: 'right', color: Math.abs(cashNum + transferNum - effectiveAmount) <= 1 ? '#34d399' : '#f87171' }}>
                        Suma: {formatARS(cashNum + transferNum)} · Total: {formatARS(effectiveAmount)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Resumen ── */}
              {isValid && (
                <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '0.5rem', padding: '0.65rem 0.85rem', fontSize: '0.84rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#a1a1aa' }}>Total a cobrar</span>
                    <strong style={{ color: '#fff' }}>{formatARS(effectiveAmount)}</strong>
                  </div>
                  {splitPayment && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#71717a' }}>
                      <span>Ef {formatARS(cashNum)} + Transf {formatARS(transferNum)}</span>
                    </div>
                  )}
                  {discountNum > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', fontSize: '0.75rem' }}>
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
                disabled={submitting}
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
