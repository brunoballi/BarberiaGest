'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Expense, ExpenseForm, Week, Profile } from '@/lib/supabase/database.types'
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORIES } from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getWeeksByBranch,
  getExpensesByBranch,
  createExpense,
  updateExpense,
  deleteExpense,
  supabase,
} from '@/lib/supabase/supabase.client'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import ExpensesModal from './expenses-modal'

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
  })
}

export default function GastosView() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [weeks, setWeeks] = useState<Week[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showModal, setShowModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [filterWeek, setFilterWeek] = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const loadData = useCallback(async (branchId: string) => {
    try {
      const [weeksData, expensesData] = await Promise.all([
        getWeeksByBranch(branchId),
        getExpensesByBranch(branchId),
      ])
      setWeeks(weeksData)
      setExpenses(expensesData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading data')
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const prof = await getCurrentProfile()
        if (!prof) {
          setError('No se pudo cargar el perfil')
          return
        }
        setProfile(prof)
        setSelectedBranch(prof.branch_id)
        await loadData(prof.branch_id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error initializing')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [loadData])

  const handleCreate = () => {
    setEditingExpense(null)
    setShowModal(true)
  }

  const handleEdit = (exp: Expense) => {
    setEditingExpense(exp)
    setShowModal(true)
  }

  const handleDelete = async (expenseId: string) => {
    try {
      await deleteExpense(expenseId)
      setExpenses(expenses.filter(e => e.id !== expenseId))
      setDeleteConfirm(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error deleting expense')
    }
  }

  const handleSave = async (data: ExpenseForm) => {
    try {
      if (editingExpense) {
        await updateExpense(editingExpense.id, data)
        setExpenses(
          expenses.map(e =>
            e.id === editingExpense.id ? { ...e, ...data } : e
          )
        )
      } else {
        const created = await createExpense({
          branch_id: selectedBranch,
          week_id: data.week_id ?? null,
          concept: data.concept,
          expense_date: data.expense_date,
          amount: data.amount,
          category: data.category,
          notes: data.notes ?? null,
          registered_by: profile!.id,
          paid_by: null,
        })
        setExpenses([created, ...expenses])
      }
      setShowModal(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving expense')
    }
  }

  // Filter expenses
  let filtered = expenses
  if (filterWeek) {
    filtered = filtered.filter(e => e.week_id === filterWeek)
  }
  if (filterCategory) {
    filtered = filtered.filter(e => e.category === filterCategory)
  }

  // Calculate totals
  const totalExpenses = filtered
    .filter(e => e.category !== 'retiro_socio')
    .reduce((sum, e) => sum + e.amount, 0)

  const totalPartnerWithdrawals = filtered
    .filter(e => e.category === 'retiro_socio')
    .reduce((sum, e) => sum + e.amount, 0)

  const totalAll = totalExpenses + totalPartnerWithdrawals

  if (loading) {
    return <div className="p-6">Cargando...</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Gastos</h1>
        <button
          onClick={handleCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          + Nuevo Gasto
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Semana</label>
          <select
            value={filterWeek}
            onChange={e => setFilterWeek(e.target.value)}
            className="w-full border rounded px-3 py-2"
          >
            <option value="">Todas las semanas</option>
            {weeks.map(w => (
              <option key={w.id} value={w.id}>
                Semana {w.week_number} ({w.start_date} a {w.end_date})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Categoría</label>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="w-full border rounded px-3 py-2"
          >
            <option value="">Todas las categorías</option>
            {EXPENSE_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>
                {EXPENSE_CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-gray-300">
          <thead className="bg-gray-100">
            <tr>
              <th className="border border-gray-300 px-4 py-2 text-left">Fecha</th>
              <th className="border border-gray-300 px-4 py-2 text-left">Concepto</th>
              <th className="border border-gray-300 px-4 py-2 text-left">Categoría</th>
              <th className="border border-gray-300 px-4 py-2 text-right">Monto</th>
              <th className="border border-gray-300 px-4 py-2 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="border border-gray-300 px-4 py-3 text-center text-gray-500">
                  No hay gastos
                </td>
              </tr>
            ) : (
              filtered.map(exp => (
                <tr key={exp.id} className="hover:bg-gray-50">
                  <td className="border border-gray-300 px-4 py-2">{formatDate(exp.expense_date)}</td>
                  <td className="border border-gray-300 px-4 py-2">{exp.concept}</td>
                  <td className="border border-gray-300 px-4 py-2">
                    {EXPENSE_CATEGORY_LABELS[exp.category as keyof typeof EXPENSE_CATEGORY_LABELS] || exp.category}
                  </td>
                  <td className="border border-gray-300 px-4 py-2 text-right font-medium">
                    {formatARS(exp.amount)}
                  </td>
                  <td className="border border-gray-300 px-4 py-2 space-x-2">
                    <button
                      onClick={() => handleEdit(exp)}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      ✎ Editar
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(exp.id)}
                      className="text-red-600 hover:underline text-sm"
                    >
                      🗑 Eliminar
                    </button>
                    {deleteConfirm === exp.id && (
                      <div className="inline-block ml-2">
                        <button
                          onClick={() => handleDelete(exp.id)}
                          className="text-red-600 font-bold text-xs"
                        >
                          Confirmar
                        </button>
                        {' | '}
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-gray-600 text-xs"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-gray-50 p-4 rounded border border-gray-300 space-y-2">
        <div className="flex justify-between">
          <span>Gastos operacionales:</span>
          <span className="font-semibold">{formatARS(totalExpenses)}</span>
        </div>
        {totalPartnerWithdrawals > 0 && (
          <div className="flex justify-between text-amber-700">
            <span>Ganancia x socios:</span>
            <span className="font-semibold">{formatARS(totalPartnerWithdrawals)}</span>
          </div>
        )}
        <div className="border-t pt-2 flex justify-between font-bold">
          <span>Total descontado:</span>
          <span>{formatARS(totalAll)}</span>
        </div>
      </div>

      {showModal && (
        <ExpensesModal
          expense={editingExpense}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
