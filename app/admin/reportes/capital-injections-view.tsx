'use client'

import { useState, useEffect, useCallback } from 'react'
import { getCapitalInjections, deleteCapitalInjection, type CapitalInjection } from '@/lib/supabase/supabase.client'
import CapitalInjectionModal from './capital-injection-modal'

interface CapitalInjectionsViewProps {
  branchId: string
  monthId: string
  onInjectionChange?: () => void
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

export default function CapitalInjectionsView({
  branchId,
  monthId,
  onInjectionChange,
}: CapitalInjectionsViewProps) {
  const [injections, setInjections] = useState<CapitalInjection[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)

  const loadInjections = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getCapitalInjections(branchId, monthId)
      setInjections(data)
    } catch (err) {
      console.error('[loadInjections]', err)
    } finally {
      setLoading(false)
    }
  }, [branchId, monthId])

  useEffect(() => {
    loadInjections()
  }, [loadInjections])

  const handleDeleteInjection = async (id: string) => {
    if (!confirm('¿Eliminar esta inyección de capital?')) return
    try {
      setDeleteLoading(id)
      await deleteCapitalInjection(id)
      setInjections((prev) => prev.filter((inj) => inj.id !== id))
      onInjectionChange?.()
    } catch (err) {
      console.error('[handleDeleteInjection]', err)
      alert(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setDeleteLoading(null)
    }
  }

  const handleSuccess = () => {
    loadInjections()
    onInjectionChange?.()
  }

  const totalInjections = injections.reduce((sum, inj) => sum + inj.amount, 0)

  if (loading) {
    return <div className="text-zinc-400 text-sm">Cargando...</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Historial de inyecciones</h3>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          + Registrar
        </button>
      </div>

      {injections.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">Sin inyecciones registradas para este período</p>
      ) : (
        <div className="space-y-2">
          {injections.map((inj) => (
            <div
              key={inj.id}
              className="flex items-center justify-between gap-2 p-2 bg-zinc-800 rounded border border-zinc-700 text-xs"
            >
              <div className="flex-1">
                <p className="font-medium text-zinc-200">{formatARS(inj.amount)}</p>
                {inj.description && <p className="text-zinc-400 text-xs">{inj.description}</p>}
                <p className="text-zinc-500 text-xs mt-1">{formatDate(inj.created_at)}</p>
              </div>
              <button
                onClick={() => handleDeleteInjection(inj.id)}
                disabled={deleteLoading === inj.id}
                className="px-2 py-1 text-zinc-400 hover:text-red-400 hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
              >
                {deleteLoading === inj.id ? '...' : '✕'}
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 p-2 bg-zinc-900 rounded border border-zinc-800 text-xs font-semibold">
            <span className="text-zinc-400">Total inyecciones</span>
            <span className="text-blue-400">{formatARS(totalInjections)}</span>
          </div>
        </div>
      )}

      <CapitalInjectionModal
        branchId={branchId}
        monthId={monthId}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
