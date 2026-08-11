'use client'

import { useState } from 'react'
import {
  type Week,
  type ExpenseInsert,
  type ExpenseUpdate,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
} from '@/lib/supabase/database.types'
import {
  createExpense,
  updateExpense,
  todayLocal,
  type ExpenseWithUser,
} from '@/lib/supabase/supabase.client'
import { CurrencyInput } from '@/app/components/currency-input'

// ─── Modal: Nuevo / Editar gasto ───────────────────────────────────────────
export function ExpenseFormModal({
  expense,
  branchId,
  weeks,
  registeredBy,
  fixedCategory,
  partners,
  title,
  submitLabel,
  onClose,
  onSaved,
}: {
  expense?: ExpenseWithUser | null
  branchId: string
  /** Semanas de la sucursal: el week_id se deriva de la fecha del gasto, no de una semana elegida a mano. */
  weeks: Week[]
  registeredBy: string
  /** Si viene, la categoría queda fija y no se muestra el selector (ej: retiros de socios). */
  fixedCategory?: string
  /** Si viene, se pide elegir el socio que retira (obligatorio). */
  partners?: { id: string; full_name: string }[]
  title?: string
  /** Texto del botón de alta. Por defecto "Guardar gasto". */
  submitLabel?: string
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!expense
  const [form, setForm] = useState({
    concept: expense?.concept ?? '',
    expense_date: expense?.expense_date ?? todayLocal(),
    amount: expense ? String(expense.amount) : '',
    category: expense?.category ?? fixedCategory ?? '',
    notes: expense?.notes ?? '',
    partner_id: expense?.partner_id ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave() {
    if (!form.concept || !form.amount || parseFloat(form.amount) <= 0) {
      setErr('Concepto y monto son obligatorios.')
      return
    }
    if (partners && !form.partner_id) {
      setErr('Elegí el socio que retira.')
      return
    }
    try {
      setSaving(true)
      if (isEdit && expense) {
        const patch: ExpenseUpdate = {
          concept: form.concept,
          expense_date: form.expense_date,
          amount: parseFloat(form.amount),
          category: form.category || null,
          notes: form.notes || null,
          partner_id: form.partner_id || null,
        }
        await updateExpense(expense.id, patch)
      } else {
        // La semana sale de la fecha del gasto (no de la que esté mirando el usuario),
        // así el gasto queda en la semana que le corresponde de verdad.
        const weekId = weeks.find(
          (w) => w.start_date <= form.expense_date && form.expense_date <= w.end_date
        )?.id ?? null
        const payload: ExpenseInsert = {
          branch_id: branchId,
          week_id: weekId,
          concept: form.concept,
          expense_date: form.expense_date,
          amount: parseFloat(form.amount),
          category: form.category || null,
          notes: form.notes || null,
          registered_by: registeredBy,
          paid_by: null,
          partner_id: form.partner_id || null,
        }
        await createExpense(payload)
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title ?? (isEdit ? 'Editar gasto' : 'Registrar gasto')}</h3>
          <button onClick={onClose} className="modal-close">✕</button>
        </div>
        <div className="modal-body">
          {err && <p className="form-error">{err}</p>}
          <label className="form-label">Concepto *</label>
          <input
            className="form-input"
            value={form.concept}
            onChange={(e) => setForm({ ...form, concept: e.target.value })}
            placeholder="Ej: Alquiler local"
          />
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Fecha *</label>
              <input
                type="date"
                className="form-input"
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Monto *</label>
              <CurrencyInput
                className="form-input"
                value={form.amount}
                onChange={(v) => setForm({ ...form, amount: v })}
                placeholder="0"
              />
            </div>
          </div>
          {partners && (
            <>
              <label className="form-label">Socio *</label>
              <select
                className="form-input"
                value={form.partner_id}
                onChange={(e) => setForm({ ...form, partner_id: e.target.value })}
              >
                <option value="">Elegí el socio</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </>
          )}
          {/* Con categoría fija (ej: retiros de socios) no tiene sentido dejarla editable. */}
          {!fixedCategory && (
            <>
              <label className="form-label">Categoría</label>
              <select
                className="form-input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="">Sin categoría</option>
                {EXPENSE_CATEGORIES.filter((c) => c !== 'retiro_socio').map((c) => (
                  <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </>
          )}
          <label className="form-label">Notas</label>
          <textarea
            className="form-input"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Opcional"
          />
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="admin-btn admin-btn--ghost">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="admin-btn admin-btn--primary">
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : (submitLabel ?? 'Guardar gasto')}
          </button>
        </div>
      </div>
    </div>
  )
}
