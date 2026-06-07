'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import type { Branch, Profile, ServiceCatalog, ServiceCatalogInsert } from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getServicesByBranch,
  createService,
  updateService,
} from '@/lib/supabase/supabase.client'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import { CurrencyInput } from '@/app/components/currency-input'

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

export default function ServicesView() {
  const router = useRouter()
  const [profile, setProfile]               = useState<Profile | null>(null)
  const [branches, setBranches]             = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [services, setServices]             = useState<ServiceCatalog[]>([])
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState<string | null>(null)

  // Create form
  const [showForm, setShowForm]     = useState(false)
  const [formName, setFormName]     = useState('')
  const [formPrice, setFormPrice]   = useState('')
  const [creating, setCreating]     = useState(false)
  const [formError, setFormError]   = useState<string | null>(null)

  // Edit inline
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editName, setEditName]     = useState('')
  const [editPrice, setEditPrice]   = useState('')
  const [saving, setSaving]         = useState(false)
  const [editError, setEditError]   = useState<string | null>(null)

  // Toggle active confirm
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadServices = useCallback(async (branchId: string) => {
    const data = await getServicesByBranch(branchId)
    setServices(data)
  }, [])

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranchesCached()])
      if (!p) { setError('No autenticado'); return }
      if (bs.length === 0) { setError('No tenés sucursales asignadas.'); return }
      setProfile(p)
      setBranches(bs)

      const stored = getStoredBranch()
      const branch = stored && bs.some((b) => b.id === stored) ? stored : null
      if (!branch) { router.replace('/admin/select-branch'); return }

      setSelectedBranch(branch)
      await loadServices(branch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [loadServices, router, setSelectedBranch])

  useEffect(() => { loadInitial() }, [loadInitial])

  // ── Create ─────────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const price = parseFloat(formPrice)
    if (!formName.trim() || isNaN(price) || price < 0) {
      setFormError('Ingresá nombre y precio válidos')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      const payload: ServiceCatalogInsert = {
        branch_id:  selectedBranch,
        name:       formName.trim(),
        base_price: price,
        is_active:  true,
      }
      const created = await createService(payload)
      setServices((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setShowForm(false)
      setFormName('')
      setFormPrice('')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Error al crear')
    } finally {
      setCreating(false)
    }
  }

  // ── Edit ───────────────────────────────────────────────────────────────
  function openEdit(svc: ServiceCatalog) {
    setEditingId(svc.id)
    setEditName(svc.name)
    setEditPrice(String(svc.base_price))
    setEditError(null)
  }

  async function handleSaveEdit(id: string) {
    const price = parseFloat(editPrice)
    if (!editName.trim() || isNaN(price) || price < 0) {
      setEditError('Nombre y precio son requeridos')
      return
    }
    setSaving(true)
    setEditError(null)
    try {
      await updateService(id, { name: editName.trim(), base_price: price })
      setServices((prev) =>
        prev
          .map((s) => s.id === id ? { ...s, name: editName.trim(), base_price: price } : s)
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
  async function handleToggle(svc: ServiceCatalog) {
    if (togglingId !== svc.id) { setTogglingId(svc.id); return }
    try {
      await updateService(svc.id, { is_active: !svc.is_active })
      setServices((prev) =>
        prev.map((s) => s.id === svc.id ? { ...s, is_active: !s.is_active } : s)
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cambiar estado')
    } finally {
      setTogglingId(null)
    }
  }

  const active   = services.filter((s) => s.is_active)
  const inactive = services.filter((s) => !s.is_active)

  if (loading) return <div className="flex items-center justify-center h-64 text-zinc-400">Cargando servicios...</div>
  if (error)   return <div className="p-6 text-red-400">{error}</div>

  return (
    <div className="max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Catálogo de servicios</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Estos servicios aparecen en la app del barbero al registrar un corte
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setFormError(null) }}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            Nuevo servicio
          </button>
        )}
      </div>

      {/* Branch selector eliminado — la sucursal viene del contexto post-login */}

      {/* Create form */}
      {showForm && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-white">Nuevo servicio</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Nombre</label>
                <input
                  required
                  type="text"
                  placeholder="Ej: Corte + barba"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Precio base ($)</label>
                <CurrencyInput
                  required
                  placeholder="0,00"
                  value={formPrice}
                  onChange={setFormPrice}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={creating}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors">
                {creating ? 'Guardando...' : 'Crear servicio'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setFormError(null) }}
                className="text-zinc-400 hover:text-white px-5 py-2.5 rounded-lg text-sm border border-zinc-700 hover:border-zinc-500 transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Active services */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Activos · {active.length}
        </h2>
        {active.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-10 text-center">
            <p className="text-zinc-500 text-sm">No hay servicios activos. Creá el primero.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {active.map((svc) => (
              <ServiceRow
                key={svc.id}
                svc={svc}
                editingId={editingId}
                editName={editName}
                editPrice={editPrice}
                editError={editError}
                saving={saving}
                togglingId={togglingId}
                onEdit={openEdit}
                onEditName={setEditName}
                onEditPrice={setEditPrice}
                onSave={handleSaveEdit}
                onCancelEdit={() => { setEditingId(null); setEditError(null) }}
                onToggle={handleToggle}
                onCancelToggle={() => setTogglingId(null)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Inactive services */}
      {inactive.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Inactivos · {inactive.length}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {inactive.map((svc) => (
              <ServiceRow
                key={svc.id}
                svc={svc}
                editingId={editingId}
                editName={editName}
                editPrice={editPrice}
                editError={editError}
                saving={saving}
                togglingId={togglingId}
                onEdit={openEdit}
                onEditName={setEditName}
                onEditPrice={setEditPrice}
                onSave={handleSaveEdit}
                onCancelEdit={() => { setEditingId(null); setEditError(null) }}
                onToggle={handleToggle}
                onCancelToggle={() => setTogglingId(null)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── ServiceRow ────────────────────────────────────────────────────────────
function ServiceRow({
  svc, editingId, editName, editPrice, editError, saving, togglingId,
  onEdit, onEditName, onEditPrice, onSave, onCancelEdit, onToggle, onCancelToggle,
}: {
  svc: ServiceCatalog
  editingId: string | null
  editName: string
  editPrice: string
  editError: string | null
  saving: boolean
  togglingId: string | null
  onEdit: (s: ServiceCatalog) => void
  onEditName: (v: string) => void
  onEditPrice: (v: string) => void
  onSave: (id: string) => void
  onCancelEdit: () => void
  onToggle: (s: ServiceCatalog) => void
  onCancelToggle: () => void
}) {
  const isEditing  = editingId === svc.id
  const isToggling = togglingId === svc.id

  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 space-y-3 ${!svc.is_active ? 'opacity-60' : ''}`}>
      {isEditing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={editName}
              onChange={(e) => onEditName(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            />
            <CurrencyInput
              value={editPrice}
              onChange={onEditPrice}
              placeholder="0,00"
              className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
          {editError && <p className="text-red-400 text-xs">{editError}</p>}
          <div className="flex gap-2">
            <button onClick={() => onSave(svc.id)} disabled={saving}
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
            <p className="text-white font-semibold text-sm">{svc.name}</p>
            <p className="text-amber-400 text-sm font-medium mt-0.5">
              {svc.base_price > 0 ? formatARS(svc.base_price) : 'Sin precio base'}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button onClick={() => onEdit(svc)}
              className="text-xs text-zinc-400 hover:text-amber-400 transition-colors">
              Editar
            </button>
            {isToggling ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">¿Confirmar?</span>
                <button onClick={() => onToggle(svc)}
                  className="text-xs text-red-400 hover:text-red-300 font-semibold">Sí</button>
                <button onClick={onCancelToggle}
                  className="text-xs text-zinc-500 hover:text-zinc-300">No</button>
              </div>
            ) : (
              <button onClick={() => onToggle(svc)}
                className={`text-xs transition-colors ${svc.is_active ? 'text-zinc-500 hover:text-red-400' : 'text-zinc-500 hover:text-emerald-400'}`}>
                {svc.is_active ? 'Desactivar' : 'Activar'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
