'use client'

import { useEffect, useState } from 'react'
import {
  getAllBarbersByBranch,
  getServicesByBranch,
  getWeeksByBranch,
  getActiveBenefitsByBranch,
  computeBenefitDiscount,
  registerCut,
} from '@/lib/supabase/supabase.client'
import type {
  Profile,
  ServiceCatalog,
  PaymentMethod,
  RegisterCutPayload,
  Week,
  Benefit,
} from '@/lib/supabase/database.types'
import './admin-dashboard.css'
import { CurrencyInput } from '@/app/components/currency-input'
import { TextInput } from '@/app/components/text-input'

interface Props {
  branchId:       string
  weekId:         string
  weekStartDate:  string
  weekEndDate:    string
  adminId:        string
  onClose:        () => void
  onSuccess:      () => void
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n)
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Mini Calendar ─────────────────────────────────────────────────────────
const CAL_MONTH_LABELS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const CAL_DOW          = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']

function MiniCalendar({ selected, onSelect }: { selected: string; onSelect: (d: string) => void }) {
  const today = todayStr()
  const [viewYear,  setViewYear]  = useState(() => Number(selected.slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => Number(selected.slice(5, 7)))

  function prevMonth() {
    if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1) }
    else setViewMonth(m => m + 1)
  }

  const todayY = Number(today.slice(0, 4))
  const todayM = Number(today.slice(5, 7))
  const isNextMonthInFuture = viewYear > todayY || (viewYear === todayY && viewMonth >= todayM)

  const firstDow    = new Date(viewYear, viewMonth - 1, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '0.75rem', padding: '0.65rem 0.75rem 0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
        <button type="button" onClick={prevMonth}
          style={{ width: '1.8rem', height: '1.8rem', borderRadius: '50%', background: '#27272a', border: '1px solid #3f3f46', color: '#a1a1aa', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ‹
        </button>
        <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#e4e4e7' }}>
          {CAL_MONTH_LABELS[viewMonth - 1]} {viewYear}
        </span>
        <button type="button" onClick={nextMonth} disabled={isNextMonthInFuture}
          style={{ width: '1.8rem', height: '1.8rem', borderRadius: '50%', background: isNextMonthInFuture ? 'transparent' : '#27272a', border: `1px solid ${isNextMonthInFuture ? 'transparent' : '#3f3f46'}`, color: isNextMonthInFuture ? '#3f3f46' : '#a1a1aa', fontSize: '1.1rem', cursor: isNextMonthInFuture ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ›
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '3px' }}>
        {CAL_DOW.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '0.6rem', fontWeight: 600, color: '#52525b', padding: '0.1rem 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`b${i}`} />
          const ds       = `${viewYear}-${String(viewMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const isSel    = ds === selected
          const isToday  = ds === today
          const isFuture = ds > today
          return (
            <button key={ds} type="button"
              onClick={() => { if (!isFuture) onSelect(ds) }}
              style={{
                padding: '0.3rem 0.1rem',
                borderRadius: '0.4rem',
                textAlign: 'center',
                cursor: isFuture ? 'default' : 'pointer',
                background: isSel ? '#a78bfa' : 'transparent',
                border: `1px solid ${isSel ? '#a78bfa' : isToday ? '#52525b' : 'transparent'}`,
                color: isSel ? '#0d0d0d' : isFuture ? '#3f3f46' : isToday ? '#a78bfa' : '#e4e4e7',
                fontSize: '0.78rem',
                fontWeight: isSel || isToday ? 700 : 400,
              }}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
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
  branchId, weekId, adminId, onClose, onSuccess,
}: Props) {
  const [barbers,    setBarbers]   = useState<Profile[]>([])
  const [services,   setServices]  = useState<ServiceCatalog[]>([])
  const [benefits,   setBenefits]  = useState<Benefit[]>([])
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
  const [benefitId,     setBenefitId]     = useState('')
  const [observations,  setObservations]  = useState('')
  const [method,        setMethod]        = useState<PaymentMethod | ''>('')
  const [splitPayment,  setSplitPayment]  = useState(false)
  const [cashPart,      setCashPart]      = useState('')
  const [transferPart,  setTransferPart]  = useState('')

  // week_id efectivo: puede diferir del prop si el admin elige una fecha de otra semana
  const [effectiveWeekId,   setEffectiveWeekId]   = useState(weekId)
  const [effectiveWeekLabel, setEffectiveWeekLabel] = useState<string | null>(null)
  const [allWeeks,          setAllWeeks]           = useState<Week[]>([])

  useEffect(() => {
    async function load() {
      try {
        const [bs, svcs, weeks, bens] = await Promise.all([
          getAllBarbersByBranch(branchId),
          getServicesByBranch(branchId),
          getWeeksByBranch(branchId),
          getActiveBenefitsByBranch(branchId),
        ])
        setBarbers(bs.filter((b) => b.is_active))
        setServices(svcs.filter((s) => s.is_active))
        setAllWeeks(weeks)
        setBenefits(bens)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error cargando datos')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [branchId])

  // Cuando cambia la fecha, resolver a qué semana pertenece
  useEffect(() => {
    if (allWeeks.length === 0) return
    const match = allWeeks.find((w) => w.start_date <= date && date <= w.end_date)
    if (match) {
      setEffectiveWeekId(match.id)
      setEffectiveWeekLabel(match.id === weekId ? null : `Semana ${match.start_date} → ${match.end_date}`)
    } else {
      // Fecha fuera de cualquier semana registrada
      setEffectiveWeekId(weekId)
      setEffectiveWeekLabel('⚠️ Esta fecha no pertenece a ninguna semana registrada')
    }
  }, [date, allWeeks, weekId])

  const selectedService = services.find((s) => s.id === serviceId)
  const resolvedAmount  = customAmt ? parseFloat(customAmt) : (selectedService?.base_price ?? 0)
  const discountNum     = parseFloat(discount) || 0
  const selectedBenefit = benefits.find((b) => b.id === benefitId)
  const selectedBarber  = barbers.find((b) => b.id === barberId)
  const isVipFullToBarberPreview =
    !!selectedBenefit?.full_amount_to_barber && selectedBarber?.compensation_type === 'percentage'

  // Mejora 1: al elegir un beneficio, pre-rellenar descuento y motivo.
  // Para % se recalcula si cambia el monto. La matemática del descuento NO cambia (50/50).
  useEffect(() => {
    if (!benefitId) return
    const b = benefits.find((x) => x.id === benefitId)
    if (!b) return
    const d = computeBenefitDiscount(b, resolvedAmount)
    setDiscount(d > 0 ? String(d) : '')
    setDiscountReason(b.name)
  }, [benefitId, resolvedAmount, benefits])
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
        benefit_id:       benefitId || null,
        benefit_full_amount_to_barber: isVipFullToBarberPreview,
      }
      await registerCut(payload, barber, effectiveWeekId, adminId)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al registrar')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={onClose}>
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

              {/* ── Día (calendario) ── */}
              <div>
                <label className="form-label">Día *</label>
                <MiniCalendar selected={date} onSelect={setDate} />
                {effectiveWeekLabel && (
                  <p style={{ fontSize: '0.73rem', marginTop: '0.35rem', color: effectiveWeekLabel.startsWith('⚠️') ? '#f87171' : '#34d399' }}>
                    {effectiveWeekLabel.startsWith('⚠️') ? effectiveWeekLabel : `✓ Se registrará en: ${effectiveWeekLabel}`}
                  </p>
                )}
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
                <CurrencyInput
                  className="form-input"
                  placeholder={selectedService ? String(selectedService.base_price) : '0'}
                  value={customAmt}
                  onChange={setCustomAmt}
                />
              </div>

              {/* ── Cliente ── */}
              <div>
                <label className="form-label">Cliente <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
                <TextInput
                  className="form-input"
                  placeholder="Nombre del cliente"
                  value={clientName}
                  onChange={setClientName}
                  maxLength={60}
                />
              </div>

              {/* ── Beneficio (Mejora 1) ── */}
              {benefits.length > 0 && (
                <div>
                  <label className="form-label">Beneficio <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
                  <select
                    className="form-input"
                    value={benefitId}
                    onChange={(e) => {
                      const id = e.target.value
                      setBenefitId(id)
                      if (!id) { setDiscount(''); setDiscountReason(''); return }
                      // Calcular el descuento en el acto (no esperar al efecto):
                      const b = benefits.find((x) => x.id === id)
                      if (b) {
                        const d = computeBenefitDiscount(b, resolvedAmount)
                        setDiscount(d > 0 ? String(d) : '')
                        setDiscountReason(b.name)
                      }
                    }}
                  >
                    <option value="">— sin beneficio —</option>
                    {benefits.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.discount_type === 'percentage' ? `${b.discount_value}%` : formatARS(b.discount_value)})
                      </option>
                    ))}
                  </select>
                  {selectedBenefit && discountNum > 0 && (
                    <p style={{ color: '#34d399', fontSize: '0.75rem', marginTop: '0.3rem' }}>
                      Ahorra {formatARS(discountNum)} con &quot;{selectedBenefit.name}&quot;
                    </p>
                  )}
                  {isVipFullToBarberPreview && (
                    <p style={{ color: '#f59e0b', fontSize: '0.75rem', marginTop: '0.3rem' }}>
                      ⚠️ Beneficio VIP: el monto cobrado va 100% al barbero, la barbería no gana nada de este corte.
                    </p>
                  )}
                </div>
              )}

              {/* ── Descuento ── */}
              <div>
                <label className="form-label">Descuento <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '0.5rem' }}>
                  <CurrencyInput
                    className="form-input"
                    placeholder="$0"
                    value={discount}
                    onChange={(v) => { setBenefitId(''); setDiscount(v) }}
                  />
                  <input
                    className="form-input"
                    placeholder="Motivo del descuento"
                    value={discountReason}
                    onChange={(e) => { setBenefitId(''); setDiscountReason(e.target.value) }}
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
                      <CurrencyInput
                        className="form-input"
                        placeholder="0" value={cashPart}
                        onChange={(v) => {
                          setCashPart(v)
                          const rest = effectiveAmount - (parseFloat(v) || 0)
                          if (rest >= 0) setTransferPart(String(Math.round(rest)))
                        }}
                      />
                    </div>
                    <div>
                      <p style={{ fontSize: '0.72rem', color: '#71717a', marginBottom: '0.25rem' }}>Transferencia $</p>
                      <CurrencyInput
                        className="form-input"
                        placeholder="0" value={transferPart}
                        onChange={(v) => {
                          setTransferPart(v)
                          const rest = effectiveAmount - (parseFloat(v) || 0)
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
