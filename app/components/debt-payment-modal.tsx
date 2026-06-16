'use client'

import { useState } from 'react'
import { recordDebtPayment } from '@/lib/supabase/supabase.client'
import type { PaymentMethod } from '@/lib/supabase/database.types'
import { CurrencyInput } from '@/app/components/currency-input'
import '@/app/admin/admin-dashboard.css'

interface Props {
  barberId:      string
  branchId:      string
  barberName:    string
  registeredBy:  string
  /** Deuda pendiente, usada para pre-rellenar el monto. */
  outstanding:   number
  onClose:       () => void
  onSuccess:     () => void
  /** Acción a ejecutar ANTES de registrar el pago (ej: marcar la liquidación
   *  como pagada). Solo corre al confirmar; si se cancela, nunca se ejecuta. */
  beforeSubmit?: () => Promise<void>
  /** Si se provee, muestra un botón "Solo marcar pagado" (cerrar la deuda sin
   *  registrar una devolución). */
  onMarkPaidOnly?: () => void | Promise<void>
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

export function DebtPaymentModal({
  barberId, branchId, barberName, registeredBy, outstanding, onClose, onSuccess,
  beforeSubmit, onMarkPaidOnly,
}: Props) {
  const [amount,    setAmount]    = useState(outstanding > 0 ? String(outstanding) : '')
  const [method,    setMethod]    = useState<PaymentMethod>('cash')
  const [date,      setDate]      = useState(todayStr)
  const [notes,     setNotes]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const amountNum = parseFloat(amount) || 0
  const isValid   = amountNum > 0 && !!date

  async function handleSubmit() {
    setError(null)
    if (amountNum <= 0) { setError('Ingresá un monto válido'); return }
    setSubmitting(true)
    try {
      if (beforeSubmit) await beforeSubmit()
      await recordDebtPayment({
        barberId, branchId, amount: amountNum,
        paymentMethod: method, paymentDate: date,
        notes: notes.trim() || null, registeredBy,
      })
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error registrando el pago')
      setSubmitting(false)
    }
  }

  async function handleMarkPaidOnly() {
    if (!onMarkPaidOnly) return
    setError(null)
    setSubmitting(true)
    try {
      await onMarkPaidOnly()
      // onMarkPaidOnly cierra el modal desde el padre; no reseteamos submitting.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error marcando como pagado')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Registrar devolución · {barberName}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error && <p className="form-error">{error}</p>}

          {beforeSubmit && (
            <p style={{ fontSize: '0.78rem', color: '#a1a1aa', background: '#1c1c20', border: '1px solid #27272a', borderRadius: '0.5rem', padding: '0.55rem 0.7rem' }}>
              La liquidación se marcará como <strong>pagada</strong> recién al confirmar. Si cancelás o cerrás, queda sin cambios.
            </p>
          )}

          {outstanding > 0 && (
            <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '0.5rem', padding: '0.6rem 0.85rem', fontSize: '0.84rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#a1a1aa' }}>Saldo deudor pendiente</span>
                <strong style={{ color: '#f87171' }}>{formatARS(outstanding)}</strong>
              </div>
            </div>
          )}

          <div>
            <label className="form-label">Monto devuelto *</label>
            <CurrencyInput className="form-input" placeholder="0" value={amount} onChange={setAmount} />
          </div>

          <div>
            <label className="form-label">Fecha *</label>
            <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div>
            <label className="form-label">Método</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['cash', 'transfer'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  style={{
                    flex: 1, padding: '0.55rem', borderRadius: '0.5rem',
                    background: method === m ? '#a78bfa' : '#18181b',
                    border: `1px solid ${method === m ? '#a78bfa' : '#27272a'}`,
                    color: method === m ? '#0d0d0d' : '#e4e4e7',
                    fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {m === 'cash' ? 'Efectivo' : 'Transferencia'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="form-label">Notas <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
            <input
              className="form-input"
              placeholder="Detalle del pago..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={120}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="admin-btn admin-btn--ghost">Cancelar</button>
          {onMarkPaidOnly && (
            <button onClick={handleMarkPaidOnly} disabled={submitting} className="admin-btn admin-btn--ghost">
              Solo marcar pagado
            </button>
          )}
          <button onClick={handleSubmit} disabled={submitting || !isValid} className="admin-btn admin-btn--primary">
            {submitting ? 'Guardando...' : 'Registrar devolución'}
          </button>
        </div>
      </div>
    </div>
  )
}
