'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import type { Branch, Profile, Benefit, BenefitInsert } from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getMyBranches,
  getBenefitsByBranch,
  createBenefit,
  updateBenefit,
} from '@/lib/supabase/supabase.client'

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

function describeBenefit(b: Benefit): string {
  return b.discount_type === 'percentage' ? `${b.discount_value}% de descuento` : `${formatARS(b.discount_value)} de descuento`
}

export default function BenefitsView() {
  const router = useRouter()
  const [, setProfile]                       = useState<Profile | null>(null)
  const [, setBranches]                      = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [benefits, setBenefits]             = useState<Benefit[]>([])
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState<string | null>(null)

  // Create form
  const [showForm, setShowForm]   = useState(false)
  const [formName, setFormName]   = useState('')
  const [formDesc, setFormDesc]   = useState('')
  const [formType, setFormType]   = useState<'fixed' | 'percentage'>('percentage')
  const [formValue, setFormValue] = useState('')
  const [creating, setCreating]   = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Edit inline
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName]   = useState('')
  const [editDesc, setEditDesc]   = useState('')
  const [editType, setEditType]   = useState<'fixed' | 'percentage'>('percentage')
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving]       = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Toggle active confirm
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadBenefits = useCallback(async (branchId: string) => {
    const data = await getBenefitsByBranch(branchId)
    setBenefits(data)
  }, [])

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranches()])
      if (!p) { setError('No autenticado'); return }
      if (bs.length === 0) { setError('No tenés sucursales asignadas.'); return }
      setProfile(p)
      setBranches(bs)

      const stored = getStoredBranch()
      const branch = stored && bs.some((b) => b.id === stored) ? stored : null
      if (!branch) { router.replace('/admin/select-branch'); return }

      setSelectedBranch(branch)
      await loadBenefits(branch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [loadBenefits, router, setSelectedBranch])

  useEffect(() => { loadInitial() }, [loadInitial])

  function validValue(type: 'fixed' | 'percentage', raw: string): number | null {
    const v = parseFloat(raw)
    if (isNaN(v) || v <= 0) return null
    if (type === 'percentage' && v > 100) return null
    return v
  }

  // ── Create ─────────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const value = validValue(formType, formValue)
    if (!formName.trim() || value === null) {
      setFormError('Ingresá nombre y un valor válido (porcentaje 1-100 o monto > 0)')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      const payload: BenefitInsert = {
        branch_id:      selectedBranch,
        name:           formName.trim(),
        description:    formDesc.trim() || null,
        discount_type:  formType,
        discount_value: value,
        is_active:      true,
      }
      const created = await createBenefit(payload)
      setBenefits((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setShowForm(false)
      setFormName(''); setFormDesc(''); setFormValue(''); setFormType('percentage')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Error al crear')
    } finally {
      setCreating(false)
    }
  }

  // ── Edit ───────────────────────────────────────────────────────────────
  function openEdit(b: Benefit) {
    setEditingId(b.id)
    setEditName(b.name)
    setEditDesc(b.description ?? '')
    setEditType(b.discount_type)
    setEditValue(String(b.discount_value))
    setEditError(null)
  }

  async function handleSaveEdit(id: string) {
    const value = validValue(editType, editValue)
    if (!editName.trim() || value === null) {
      setEditError('Nombre y valor válido son requeridos')
      return
    }
    setSaving(true)
    setEditError(null)
    try {
      await updateBenefit(id, {
        name:           editName.trim(),
        description:    editDesc.trim() || null,
        discount_type:  editType,
        discount_value: value,
      })
      setBenefits((prev) =>
        prev
          .map((b) => b.id === id ? { ...b, name: editName.trim(), description: editDesc.trim() || null, discount_type: editType, discount_value: value } : b)
          .sort((a, b) => a.name.localeCompare(b.name))
      )
      setEditingId(null)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // ── Toggle active ──────────────────────────────────────────────────────
  async function handleToggle(b: Benefit) {
    if (togglingId !== b.id) { setTogglingId(b.id); return }
    try {
      await updateBenefit(b.id, { is_active: !b.is_active })
      setBenefits((prev) =>
        prev.map((x) => x.id === b.id ? { ...x, is_active: !x.is_active } : x)
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cambiar estado')
    } finally {
      setTogglingId(null)
    }
  }

  const active   = benefits.filter((b) => b.is_active)
  const inactive = benefits.filter((b) => !b.is_active)

  if (loading) return <div className="flex items-center justify-center h-64 text-zinc-400">Cargando beneficios...</div>
  if (error)   return <div className="p-6 text-red-400">{error}</div>

  return (
    <div className="max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Beneficios</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Descuentos predefinidos que aparecen al registrar un corte (ej: jubilados, happy hour)
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setFormError(null) }}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            Nuevo beneficio
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-white">Nuevo beneficio</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Nombre</label>
                <input
                  required
                  type="text"
                  placeholder="Ej: Jubilados"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Descripción (opcional)</label>
                <input
                  type="text"
                  placeholder="Ej: Martes y miércoles"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Tipo</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as 'fixed' | 'percentage')}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                >
                  <option value="percentage">Porcentaje (%)</option>
                  <option value="fixed">Monto fijo ($)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  {formType === 'percentage' ? 'Porcentaje (1-100)' : 'Monto ($)'}
                </label>
                <input
                  required
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={creating}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors">
                {creating ? 'Guardando...' : 'Crear beneficio'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setFormError(null) }}
                className="text-zinc-400 hover:text-white px-5 py-2.5 rounded-lg text-sm border border-zinc-700 hover:border-zinc-500 transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Active benefits */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Activos · {active.length}
        </h2>
        {active.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-10 text-center">
            <p className="text-zinc-500 text-sm">No hay beneficios activos. Creá el primero.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {active.map((b) => (
              <BenefitRow
                key={b.id} benefit={b}
                editingId={editingId} editName={editName} editDesc={editDesc} editType={editType} editValue={editValue}
                editError={editError} saving={saving} togglingId={togglingId}
                onEdit={openEdit} onEditName={setEditName} onEditDesc={setEditDesc} onEditType={setEditType} onEditValue={setEditValue}
                onSave={handleSaveEdit} onCancelEdit={() => { setEditingId(null); setEditError(null) }}
                onToggle={handleToggle} onCancelToggle={() => setTogglingId(null)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Inactive benefits */}
      {inactive.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Inactivos · {inactive.length}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {inactive.map((b) => (
              <BenefitRow
                key={b.id} benefit={b}
                editingId={editingId} editName={editName} editDesc={editDesc} editType={editType} editValue={editValue}
                editError={editError} saving={saving} togglingId={togglingId}
                onEdit={openEdit} onEditName={setEditName} onEditDesc={setEditDesc} onEditType={setEditType} onEditValue={setEditValue}
                onSave={handleSaveEdit} onCancelEdit={() => { setEditingId(null); setEditError(null) }}
                onToggle={handleToggle} onCancelToggle={() => setTogglingId(null)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── BenefitRow ──────────────────────────────────────────────────────────────
function BenefitRow({
  benefit, editingId, editName, editDesc, editType, editValue, editError, saving, togglingId,
  onEdit, onEditName, onEditDesc, onEditType, onEditValue, onSave, onCancelEdit, onToggle, onCancelToggle,
}: {
  benefit: Benefit
  editingId: string | null
  editName: string
  editDesc: string
  editType: 'fixed' | 'percentage'
  editValue: string
  editError: string | null
  saving: boolean
  togglingId: string | null
  onEdit: (b: Benefit) => void
  onEditName: (v: string) => void
  onEditDesc: (v: string) => void
  onEditType: (v: 'fixed' | 'percentage') => void
  onEditValue: (v: string) => void
  onSave: (id: string) => void
  onCancelEdit: () => void
  onToggle: (b: Benefit) => void
  onCancelToggle: () => void
}) {
  const isEditing  = editingId === benefit.id
  const isToggling = togglingId === benefit.id

  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 space-y-3 ${!benefit.is_active ? 'opacity-60' : ''}`}>
      {isEditing ? (
        <div className="space-y-3">
          <input
            type="text" value={editName} onChange={(e) => onEditName(e.target.value)}
            placeholder="Nombre"
            className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
          <input
            type="text" value={editDesc} onChange={(e) => onEditDesc(e.target.value)}
            placeholder="Descripción (opcional)"
            className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              value={editType} onChange={(e) => onEditType(e.target.value as 'fixed' | 'percentage')}
              className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            >
              <option value="percentage">%</option>
              <option value="fixed">$</option>
            </select>
            <input
              type="number" inputMode="numeric" min="0" value={editValue} onChange={(e) => onEditValue(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          {editError && <p className="text-red-400 text-xs">{editError}</p>}
          <div className="flex gap-2">
            <button onClick={() => onSave(benefit.id)} disabled={saving}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-4 py-1.5 rounded-lg text-xs transition-colors">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={onCancelEdit}
              className="text-zinc-400 hover:text-white px-4 py-1.5 rounded-lg text-xs border border-zinc-700 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-white font-semibold text-sm">{benefit.name}</p>
            <p className="text-amber-400 text-sm font-medium mt-0.5">{describeBenefit(benefit)}</p>
            {benefit.description && <p className="text-zinc-500 text-xs mt-0.5">{benefit.description}</p>}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button onClick={() => onEdit(benefit)}
              className="text-xs text-zinc-400 hover:text-amber-400 transition-colors">
              Editar
            </button>
            {isToggling ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">¿Confirmar?</span>
                <button onClick={() => onToggle(benefit)}
                  className="text-xs text-red-400 hover:text-red-300 font-semibold">Sí</button>
                <button onClick={onCancelToggle}
                  className="text-xs text-zinc-500 hover:text-zinc-300">No</button>
              </div>
            ) : (
              <button onClick={() => onToggle(benefit)}
                className={`text-xs transition-colors ${benefit.is_active ? 'text-zinc-500 hover:text-red-400' : 'text-zinc-500 hover:text-emerald-400'}`}>
                {benefit.is_active ? 'Desactivar' : 'Activar'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
