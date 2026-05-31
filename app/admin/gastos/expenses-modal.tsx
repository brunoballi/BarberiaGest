'use client'

import { useState } from 'react'
import type { Expense, ExpenseForm } from '@/lib/supabase/database.types'
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORIES } from '@/lib/supabase/database.types'

interface ExpensesModalProps {
  expense: Expense | null
  onSave: (data: ExpenseForm) => Promise<void>
  onClose: () => void
}

export default function ExpensesModal({ expense, onSave, onClose }: ExpensesModalProps) {
  const [form, setForm] = useState<ExpenseForm>(
    expense
      ? {
          concept: expense.concept,
          category: (expense.category ?? 'otros') as ExpenseForm['category'],
          amount: expense.amount,
          expense_date: expense.expense_date,
          week_id: expense.week_id,
          notes: expense.notes,
          branch_id: expense.branch_id,
        }
      : {
          concept: '',
          category: 'otros',
          amount: 0,
          expense_date: new Date().toISOString().split('T')[0],
          week_id: null,
          notes: null,
          branch_id: '',
        }
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.concept.trim()) {
      setError('El concepto es requerido')
      return
    }
    if (form.amount <= 0) {
      setError('El monto debe ser mayor a 0')
      return
    }

    try {
      setLoading(true)
      setError(null)
      await onSave(form)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving expense')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-96 max-h-screen overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">
          {expense ? 'Editar Gasto' : 'Nuevo Gasto'}
        </h2>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Concepto</label>
            <input
              type="text"
              placeholder="ej: Alquiler, Servicios, Retiro"
              value={form.concept}
              onChange={e => setForm({ ...form, concept: e.target.value })}
              className="w-full border rounded px-3 py-2"
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Categoría</label>
            <select
              value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value as any })}
              className="w-full border rounded px-3 py-2"
            >
              {EXPENSE_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {EXPENSE_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Monto ($)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={form.amount}
              onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Fecha</label>
            <input
              type="date"
              value={form.expense_date}
              onChange={e => setForm({ ...form, expense_date: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notas (opcional)</label>
            <textarea
              placeholder="Detalles adicionales..."
              value={form.notes || ''}
              onChange={e => setForm({ ...form, notes: e.target.value || null })}
              className="w-full border rounded px-3 py-2 text-sm"
              rows={3}
              maxLength={500}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-300 text-gray-800 py-2 rounded hover:bg-gray-400"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
