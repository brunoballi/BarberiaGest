'use client'

import { useState } from 'react'
import { createCapitalInjection } from '@/lib/supabase/supabase.client'

interface CapitalInjectionModalProps {
  branchId: string
  monthId: string
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function CapitalInjectionModal({
  branchId,
  monthId,
  isOpen,
  onClose,
  onSuccess,
}: CapitalInjectionModalProps) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) {
      setError('Ingresa un monto válido')
      return
    }

    try {
      setLoading(true)
      setError(null)
      await createCapitalInjection(branchId, monthId, Number(amount), description || undefined)
      setAmount('')
      setDescription('')
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar inyección')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-md shadow-lg">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">Registrar inyección de capital</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Monto *</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Descripción (opcional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Inversión adicional para equipamiento"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>

          {error && <div className="text-sm text-red-400">{error}</div>}

          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-300 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Registrando...' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
