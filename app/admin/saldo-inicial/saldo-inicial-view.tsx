'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import type { RevenueBalance, MonthWithWeeks } from '@/lib/supabase/database.types'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import {
  getCurrentProfile,
  getMonthsWithWeeks,
  getInitialBalance,
  setInitialBalance,
  MONTH_NAMES,
} from '@/lib/supabase/supabase.client'
import { CurrencyInput } from '@/app/components/currency-input'
import '../admin-dashboard.css'

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────
export default function SaldoInicialView() {
  const router = useRouter()
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [months, setMonths] = useState<MonthWithWeeks[]>([])
  const [balance, setBalance] = useState<RevenueBalance | null>(null)

  // Período: se elige un mes del calendario que ya armó el admin.
  const [monthId, setMonthId] = useState<string>('')

  const [loading, setLoading] = useState(true)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  const loadBalance = useCallback(async (branchId: string, mId: string) => {
    if (!branchId || !mId) { setBalance(null); return }
    setBalanceLoading(true)
    try {
      setBalance(await getInitialBalance(branchId, mId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando el saldo')
    } finally {
      setBalanceLoading(false)
    }
  }, [])

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranchesCached()])
      if (!p) { setError('No autenticado'); return }
      if (bs.length === 0) { setError('No tenés sucursales asignadas.'); return }

      const stored = getStoredBranch()
      const branch = stored && bs.some((b) => b.id === stored) ? stored : null
      if (!branch) { router.replace('/admin/select-branch'); return }
      setSelectedBranch(branch)

      const ms = await getMonthsWithWeeks(branch)
      setMonths(ms)
      // Arranca en el mes ACTUAL. El calendario suele tener meses creados hasta
      // años adelante, así que tomar "el más reciente" abriría en 2028.
      // Se calcula acá (post-montaje) y no en el render, para no depender de la
      // fecha del server durante la hidratación.
      const now = new Date()
      const currentMonth = ms.find((m) => m.year === now.getFullYear() && m.month === now.getMonth() + 1)
      const fallback = [...ms].sort((a, b) => (b.year - a.year) || (b.month - a.month))[0]
      const chosen = currentMonth ?? fallback
      if (chosen) setMonthId(chosen.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [router, setSelectedBranch])

  useEffect(() => { loadInitial() }, [loadInitial])

  useEffect(() => {
    if (!selectedBranch || !monthId) return
    setEditing(false)
    loadBalance(selectedBranch, monthId)
  }, [selectedBranch, monthId, loadBalance])

  async function handleSave() {
    if (!selectedBranch || !monthId) return
    const amount = parseFloat(input.replace(/\./g, '').replace(',', '.'))
    if (isNaN(amount)) { setError('Ingresá un monto válido'); return }
    setSaving(true)
    setError(null)
    try {
      const saved = await setInitialBalance(selectedBranch, monthId, amount)
      setBalance(saved)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-zinc-400">Cargando saldo inicial...</div>
  if (error && !months.length) return <div className="p-6 text-red-400">{error}</div>

  // Ordenados del más reciente al más viejo, igual que el resto de los selectores.
  const monthOptions = [...months].sort((a, b) => (b.year - a.year) || (b.month - a.month))
  const current = months.find((m) => m.id === monthId)
  const amount = balance?.initial_balance ?? 0

  return (
    <div className="w-full px-4 py-8 space-y-6">
      <div className="flowi-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Saldo inicial</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Capital con el que arranca cada mes la sucursal.
          </p>
        </div>
        <select
          value={monthId}
          onChange={(e) => setMonthId(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
        >
          {monthOptions.length === 0 && <option value="">Sin meses en el calendario</option>}
          {monthOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {MONTH_NAMES[m.month - 1]} {m.year}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {monthOptions.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-10 text-center">
          <p className="text-zinc-400 text-sm">
            Esta sucursal todavía no tiene meses en el calendario.
          </p>
          <p className="text-zinc-600 text-xs mt-2">
            Creá las semanas desde Configuración → Calendario para poder cargar el saldo.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Saldo inicial de {current ? `${MONTH_NAMES[current.month - 1]} ${current.year}` : '—'}
            </p>

            {balanceLoading ? (
              <p className="text-zinc-500 text-sm">Cargando...</p>
            ) : editing ? (
              <div className="flex flex-wrap items-center gap-3">
                <CurrencyInput
                  value={input}
                  onChange={setInput}
                  allowNegative
                  className="filter-input"
                  placeholder="0 (puede ser negativo)"
                  autoFocus
                  style={{ width: 200 }}
                />
                <button onClick={handleSave} disabled={saving} className="admin-btn admin-btn--primary">
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button onClick={() => setEditing(false)} className="admin-btn admin-btn--ghost">
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <strong className={`text-3xl font-bold ${amount < 0 ? 'text-red-400' : 'text-white'}`}>
                  {formatARS(amount)}
                </strong>
                <button
                  onClick={() => { setInput(String(balance?.initial_balance ?? '')); setEditing(true) }}
                  className="admin-btn admin-btn--ghost"
                >
                  {balance ? 'Editar' : 'Cargar'}
                </button>
                {!balance && (
                  <span className="text-zinc-600 text-xs">Todavía no se cargó el saldo de este mes.</span>
                )}
              </div>
            )}
          </div>

          <p className="text-sm text-zinc-500">
            El detalle de ganancia neta (saldo + ingresos − gastos) se ve en el módulo <strong>Reportes</strong>.
          </p>
        </>
      )}
    </div>
  )
}
