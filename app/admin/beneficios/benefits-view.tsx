'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import type { Branch, Profile, Benefit, BenefitInsert, LifetimeMember, MemberList } from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  handleMissingProfile,
  getBenefitsByBranch,
  createBenefit,
  updateBenefit,
  getLifetimeMembers,
  createLifetimeMember,
  createLifetimeMembersBulk,
  setLifetimeMemberActive,
  updateLifetimeMember,
  getMemberLists,
  createMemberList,
  updateMemberList,
  deleteMemberList,
  deleteOrArchive,
  unarchive,
  mensajeDeArchivado,
  mensajeDeEliminado,
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

function describeBenefit(b: Benefit): string {
  return b.discount_type === 'percentage' ? `${b.discount_value}% de descuento` : `${formatARS(b.discount_value)} de descuento`
}

export default function BenefitsView() {
  const router = useRouter()
  const [, setProfile]                       = useState<Profile | null>(null)
  const [branches, setBranches]             = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [benefits, setBenefits]             = useState<Benefit[]>([])
  // Listas de personas habilitadas (migración 104). Si la migración todavía no
  // está aplicada, queda vacía y el resto de la pantalla sigue funcionando.
  const [lists, setLists]                   = useState<MemberList[]>([])
  const [listsError, setListsError]         = useState<string | null>(null)
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState<string | null>(null)

  // Create form
  const [showForm, setShowForm]   = useState(false)
  const [formName, setFormName]   = useState('')
  const [formDesc, setFormDesc]   = useState('')
  const [formType, setFormType]   = useState<'fixed' | 'percentage'>('percentage')
  const [formValue, setFormValue] = useState('')
  // Beneficio de socio vitalicio: exige DNI y lo valida contra la lista.
  const [formRequiresDoc, setFormRequiresDoc] = useState(false)
  const [formListId, setFormListId] = useState('')
  // Beneficio VIP: el monto cobrado va 100% al barbero (comisión %).
  const [formFullToBarber, setFormFullToBarber] = useState(false)
  const [creating, setCreating]   = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Edit inline
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName]   = useState('')
  const [editDesc, setEditDesc]   = useState('')
  const [editType, setEditType]   = useState<'fixed' | 'percentage'>('percentage')
  const [editValue, setEditValue] = useState('')
  const [editRequiresDoc, setEditRequiresDoc]   = useState(false)
  const [editListId, setEditListId]             = useState('')
  const [editFullToBarber, setEditFullToBarber] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Toggle active confirm
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Eliminar / archivar
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [notice, setNotice]         = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const loadBenefits = useCallback(async (branchId: string) => {
    const data = await getBenefitsByBranch(branchId)
    setBenefits(data)
  }, [])

  const loadLists = useCallback(async () => {
    try {
      setLists(await getMemberLists())
      setListsError(null)
    } catch (e) {
      setListsError(e instanceof Error ? e.message : 'No se pudieron cargar las listas')
    }
  }, [])

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranchesCached()])
      if (!p) { setError(await handleMissingProfile()); return }
      if (bs.length === 0) { setError('No tenés sucursales asignadas.'); return }
      setProfile(p)
      setBranches(bs)

      const stored = getStoredBranch()
      const branch = stored && bs.some((b) => b.id === stored) ? stored : null
      if (!branch) { router.replace('/admin/select-branch'); return }

      setSelectedBranch(branch)
      await Promise.all([loadBenefits(branch), loadLists()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [loadBenefits, loadLists, router, setSelectedBranch])

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
    if (formRequiresDoc && !formListId) {
      setFormError('Elegí la lista de personas habilitadas para este beneficio')
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
        requires_member_document: formRequiresDoc,
        member_list_id:           formRequiresDoc ? formListId : null,
        full_amount_to_barber:    formFullToBarber,
      }
      const created = await createBenefit(payload)
      setBenefits((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setShowForm(false)
      setFormName(''); setFormDesc(''); setFormValue(''); setFormType('percentage'); setFormRequiresDoc(false); setFormListId(''); setFormFullToBarber(false)
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
    setEditRequiresDoc(b.requires_member_document)
    setEditListId(b.member_list_id ?? '')
    setEditFullToBarber(b.full_amount_to_barber)
    setEditError(null)
  }

  async function handleSaveEdit(id: string) {
    const value = validValue(editType, editValue)
    if (!editName.trim() || value === null) {
      setEditError('Nombre y valor válido son requeridos')
      return
    }
    if (editRequiresDoc && !editListId) {
      setEditError('Elegí la lista de personas habilitadas')
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
        requires_member_document: editRequiresDoc,
        member_list_id:           editRequiresDoc ? editListId : null,
        full_amount_to_barber:    editFullToBarber,
      })
      setBenefits((prev) =>
        prev
          .map((b) => b.id === id ? {
            ...b,
            name: editName.trim(),
            description: editDesc.trim() || null,
            discount_type: editType,
            discount_value: value,
            requires_member_document: editRequiresDoc,
            member_list_id: editRequiresDoc ? editListId : null,
            full_amount_to_barber: editFullToBarber,
          } : b)
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

  // ── Eliminar (o archivar si tiene historial) ───────────────────────────
  async function handleDelete(b: Benefit) {
    if (deletingId !== b.id) { setDeletingId(b.id); return }
    try {
      const r = await deleteOrArchive('beneficio', b.id)
      if (r.eliminado) {
        setBenefits((prev) => prev.filter((x) => x.id !== b.id))
        setNotice(mensajeDeEliminado(r))
      } else {
        setBenefits((prev) => prev.map((x) =>
          x.id === b.id ? { ...x, is_active: false, archived_at: new Date().toISOString() } : x))
        setNotice(mensajeDeArchivado(r))
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleUnarchive(b: Benefit) {
    try {
      await unarchive('beneficio', b.id)
      setBenefits((prev) => prev.map((x) => x.id === b.id ? { ...x, archived_at: null } : x))
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Error al desarchivar')
    }
  }

  // Listas que puede usar un beneficio de esta sucursal: las de todas las
  // sucursales o las de esta, y activas (más la que ya tiene asignada).
  const listsForBranch = (currentId: string) =>
    lists.filter((l) => l.id === currentId || (l.is_active && (l.branch_id == null || l.branch_id === selectedBranch)))

  const archived = benefits.filter((b) => b.archived_at != null)
  const active   = benefits.filter((b) => b.is_active && b.archived_at == null)
  const inactive = benefits.filter((b) => !b.is_active && b.archived_at == null)

  if (loading) return <div className="flex items-center justify-center h-64 text-zinc-400">Cargando beneficios...</div>
  if (error)   return <div className="p-6 text-red-400">{error}</div>

  return (
    <div className="w-full px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flowi-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                <CurrencyInput
                  required
                  placeholder="0"
                  value={formValue}
                  onChange={setFormValue}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={formRequiresDoc}
                onChange={(e) => setFormRequiresDoc(e.target.checked)}
                className="mt-0.5 accent-amber-500"
              />
              <span className="text-sm text-zinc-300">
                Solo para personas habilitadas (pide DNI)
                <span className="block text-xs text-zinc-500 mt-0.5">
                  Al elegir este beneficio se pide el DNI y se valida contra la lista que elijas.
                  Si el DNI no está en esa lista, el corte no se guarda.
                </span>
              </span>
            </label>
            {formRequiresDoc && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Lista de personas habilitadas</label>
                <select
                  value={formListId}
                  onChange={(e) => setFormListId(e.target.value)}
                  className="w-full sm:w-80 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                >
                  <option value="">Elegí una lista…</option>
                  {listsForBranch('').map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                {listsForBranch('').length === 0 && (
                  <p className="text-xs text-amber-400 mt-1">
                    {listsError ? 'No se pudieron cargar las listas.' : 'Todavía no hay listas para esta sucursal. Creá una abajo, en “Listas de personas habilitadas”.'}
                  </p>
                )}
              </div>
            )}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={formFullToBarber}
                onChange={(e) => setFormFullToBarber(e.target.checked)}
                className="mt-0.5 accent-amber-500"
              />
              <span className="text-sm text-zinc-300">
                Beneficio VIP (100% para el barbero)
                <span className="block text-xs text-zinc-500 mt-0.5">
                  En barberos de comisión %, lo que paga el cliente va entero al barbero y la barbería no gana nada de ese corte.
                </span>
              </span>
            </label>
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

      {notice && (
        <div className="bg-zinc-900 border border-amber-500/40 rounded-xl px-5 py-3 flex items-start gap-3">
          <p className="flex-1 text-sm text-zinc-200">{notice}</p>
          <button onClick={() => setNotice(null)} className="text-xs text-zinc-500 hover:text-white">Cerrar</button>
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
                editRequiresDoc={editRequiresDoc} editFullToBarber={editFullToBarber}
                editListId={editListId} onEditListId={setEditListId} lists={lists} listOptions={listsForBranch(b.member_list_id ?? '')}
                onEditRequiresDoc={setEditRequiresDoc} onEditFullToBarber={setEditFullToBarber}
                onEdit={openEdit} onEditName={setEditName} onEditDesc={setEditDesc} onEditType={setEditType} onEditValue={setEditValue}
                onSave={handleSaveEdit} onCancelEdit={() => { setEditingId(null); setEditError(null) }}
                onToggle={handleToggle} onCancelToggle={() => setTogglingId(null)}
                deletingId={deletingId} onDelete={handleDelete} onCancelDelete={() => setDeletingId(null)}
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
                editRequiresDoc={editRequiresDoc} editFullToBarber={editFullToBarber}
                editListId={editListId} onEditListId={setEditListId} lists={lists} listOptions={listsForBranch(b.member_list_id ?? '')}
                onEditRequiresDoc={setEditRequiresDoc} onEditFullToBarber={setEditFullToBarber}
                onEdit={openEdit} onEditName={setEditName} onEditDesc={setEditDesc} onEditType={setEditType} onEditValue={setEditValue}
                onSave={handleSaveEdit} onCancelEdit={() => { setEditingId(null); setEditError(null) }}
                onToggle={handleToggle} onCancelToggle={() => setTogglingId(null)}
                deletingId={deletingId} onDelete={handleDelete} onCancelDelete={() => setDeletingId(null)}
              />
            ))}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section className="space-y-3">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showArchived ? '▾' : '▸'} Archivados · {archived.length}
          </button>
          {showArchived && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {archived.map((b) => (
                <div key={b.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4 opacity-60">
                  <div>
                    <p className="text-white font-semibold text-sm">{b.name}</p>
                    <p className="text-zinc-500 text-xs mt-0.5">Archivado · tiene historial</p>
                  </div>
                  <button onClick={() => handleUnarchive(b)}
                    className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors flex-shrink-0">
                    Restaurar
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <MemberListsSection
        lists={lists}
        listsError={listsError}
        benefits={benefits}
        branches={branches}
        onChanged={loadLists}
      />
    </div>
  )
}

// ─── Listas de personas habilitadas ────────────────────────────────────────
// Cada beneficio que pide DNI apunta a UNA lista y valida contra ella. Una lista
// puede valer en todas las sucursales o solo en una. "Socio Vitalicio" es una más.
function MemberListsSection({
  lists, listsError, benefits, branches, onChanged,
}: {
  lists: MemberList[]
  listsError: string | null
  benefits: Benefit[]
  branches: Branch[]
  onChanged: () => Promise<void> | void
}) {
  const [name, setName]         = useState('')
  const [scope, setScope]       = useState('') // '' = todas las sucursales
  const [creating, setCreating] = useState(false)
  const [err, setErr]           = useState<string | null>(null)
  const [notice, setNotice]     = useState<string | null>(null)
  const [openId, setOpenId]     = useState<string | null>(null)

  // Edición de nombre / alcance
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editName, setEditName]     = useState('')
  const [editScope, setEditScope]   = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const branchName = (id: string | null) =>
    id == null ? 'Todas las sucursales' : (branches.find((b) => b.id === id)?.name ?? 'Una sucursal')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setErr('Ponele un nombre a la lista.'); return }
    setCreating(true); setErr(null)
    try {
      const created = await createMemberList(name, scope || null)
      setName(''); setScope('')
      await onChanged()
      setOpenId(created.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al crear la lista')
    } finally {
      setCreating(false)
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editName.trim()) { setErr('El nombre no puede quedar vacío.'); return }
    setErr(null)
    try {
      await updateMemberList(id, { name: editName.trim(), branch_id: editScope || null })
      setEditingId(null)
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  async function handleToggle(l: MemberList) {
    try {
      await updateMemberList(l.id, { is_active: !l.is_active })
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al cambiar el estado')
    }
  }

  async function handleDelete(l: MemberList) {
    if (deletingId !== l.id) { setDeletingId(l.id); return }
    try {
      const n = await deleteMemberList(l.id)
      setNotice(`Se eliminó la lista "${n}".`)
      await onChanged()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
        Listas de personas habilitadas · {lists.length}
      </h2>
      <p className="text-zinc-500 text-sm mb-4">
        Cada beneficio “solo para personas habilitadas” valida el DNI contra su propia lista.
        Una lista puede valer en todas las sucursales o en una sola.
      </p>

      {listsError && (
        <p className="text-red-400 text-sm mb-3">
          No se pudieron cargar las listas: {listsError}
        </p>
      )}

      <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la lista (ej: Jubilados)"
          className="flex-1 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="sm:w-56 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
        >
          <option value="">Todas las sucursales</option>
          {branches.map((b) => <option key={b.id} value={b.id}>Solo {b.name}</option>)}
        </select>
        <button
          type="submit"
          disabled={creating}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors"
        >
          {creating ? 'Creando...' : 'Crear lista'}
        </button>
      </form>
      {err && <p className="text-red-400 text-sm mb-3">{err}</p>}
      {notice && (
        <div className="bg-zinc-900 border border-amber-500/40 rounded-xl px-5 py-3 mb-3 flex items-start gap-3">
          <p className="flex-1 text-sm text-zinc-200">{notice}</p>
          <button onClick={() => setNotice(null)} className="text-xs text-zinc-500 hover:text-white">Cerrar</button>
        </div>
      )}

      {lists.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-8 text-center">
          <p className="text-zinc-500 text-sm">Todavía no hay listas. Creá la primera.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.map((l) => {
            const using = benefits.filter((b) => b.member_list_id === l.id && b.archived_at == null)
            const open = openId === l.id
            return (
              <div key={l.id} className={`bg-zinc-900 border border-zinc-800 rounded-xl ${!l.is_active ? 'opacity-60' : ''}`}>
                <div className="px-4 py-3">
                  {editingId === l.id ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                      />
                      <select
                        value={editScope}
                        onChange={(e) => setEditScope(e.target.value)}
                        className="sm:w-56 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                      >
                        <option value="">Todas las sucursales</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>Solo {b.name}</option>)}
                      </select>
                      <div className="flex gap-2">
                        <button onClick={() => handleSaveEdit(l.id)}
                          className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-4 py-2 rounded-lg text-xs transition-colors">
                          Guardar
                        </button>
                        <button onClick={() => { setEditingId(null); setErr(null) }}
                          className="text-zinc-400 hover:text-white px-4 py-2 rounded-lg text-xs border border-zinc-700 transition-colors">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button onClick={() => setOpenId(open ? null : l.id)}
                        className="flex items-center gap-2 text-left">
                        <span className="text-zinc-500 text-xs">{open ? '▾' : '▸'}</span>
                        <span className="text-white font-semibold text-sm">{l.name}</span>
                      </button>
                      <span className="text-[0.65rem] font-bold uppercase tracking-wide text-violet-300 border border-violet-500/40 rounded px-1.5 py-0.5">
                        {branchName(l.branch_id)}
                      </span>
                      {!l.is_active && <span className="text-xs text-zinc-500">Desactivada</span>}
                      <span className="flex-1" />
                      <button onClick={() => { setEditingId(l.id); setEditName(l.name); setEditScope(l.branch_id ?? ''); setErr(null) }}
                        className="text-xs text-zinc-400 hover:text-amber-400 transition-colors">
                        Editar
                      </button>
                      <button onClick={() => handleToggle(l)}
                        className={`text-xs transition-colors ${l.is_active ? 'text-zinc-500 hover:text-red-400' : 'text-zinc-500 hover:text-emerald-400'}`}>
                        {l.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                      {deletingId === l.id ? (
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-zinc-400">¿Eliminar la lista y sus personas?</span>
                          <button onClick={() => handleDelete(l)} className="text-xs text-red-400 hover:text-red-300 font-semibold">Sí</button>
                          <button onClick={() => setDeletingId(null)} className="text-xs text-zinc-500 hover:text-zinc-300">No</button>
                        </span>
                      ) : (
                        <button onClick={() => handleDelete(l)}
                          className="text-xs text-zinc-500 hover:text-red-400 transition-colors">
                          Eliminar
                        </button>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-zinc-500 mt-1.5">
                    {using.length === 0
                      ? 'Ningún beneficio de esta sucursal la usa.'
                      : `La usa: ${using.map((b) => b.name).join(', ')}`}
                  </p>
                </div>
                {open && <MemberListPeople list={l} />}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/**
 * Convierte texto pegado (una persona por línea: "Nombre y apellido, DNI",
 * separado por coma, punto y coma, tabulación o espacio) en filas para cargar.
 * Acepta también "DNI, Nombre". Las líneas que no se entienden se devuelven aparte.
 */
function parseBulkPeople(text: string): { rows: { fullName: string; documentNumber: string }[]; invalid: string[] } {
  const rows: { fullName: string; documentNumber: string }[] = []
  const invalid: string[] = []
  const isDoc = (s: string) => /^[\d.\-\s]{6,}$/.test(s.trim()) || /^\d{6,}$/.test(s.replace(/[.\s-]/g, ''))
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split(/[\t;,]/).map((p) => p.trim()).filter(Boolean)
    let fullName = ''
    let doc = ''
    if (parts.length >= 2) {
      if (isDoc(parts[1]) && !isDoc(parts[0])) { fullName = parts[0]; doc = parts[1] }
      else if (isDoc(parts[0]) && !isDoc(parts[1])) { fullName = parts[1]; doc = parts[0] }
    } else {
      const m = line.match(/^(.*\D)\s+(\d[\d.]{5,})$/) ?? line.match(/^(\d[\d.]{5,})\s+(.*\D)$/)
      if (m) {
        if (/^\d/.test(m[1])) { doc = m[1]; fullName = m[2] } else { fullName = m[1]; doc = m[2] }
      }
    }
    if (fullName && doc) rows.push({ fullName, documentNumber: doc })
    else invalid.push(line)
  }
  return { rows, invalid }
}

// Personas de una lista: buscador, alta individual, carga masiva y edición.
function MemberListPeople({ list }: { list: MemberList }) {
  const [members, setMembers] = useState<LifetimeMember[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [name, setName]       = useState('')
  const [doc, setDoc]         = useState('')
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [notice, setNotice]   = useState<string | null>(null)

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')

  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editName, setEditName]     = useState('')
  const [editDoc, setEditDoc]       = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setMembers(await getLifetimeMembers(list.id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error cargando las personas')
    } finally {
      setLoading(false)
    }
  }, [list.id])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !doc.trim()) { setErr('Completá nombre y documento.'); return }
    setSaving(true); setErr(null)
    try {
      await createLifetimeMember(name, doc, list.id)
      setName(''); setDoc('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al agregar')
    } finally {
      setSaving(false)
    }
  }

  async function handleBulk() {
    const { rows, invalid } = parseBulkPeople(bulkText)
    if (rows.length === 0) { setErr('No encontré ninguna persona. Pegá una por línea: nombre y DNI.'); return }
    setSaving(true); setErr(null)
    try {
      const r = await createLifetimeMembersBulk(list.id, rows)
      const partes = [`Se agregaron ${r.added} ${r.added === 1 ? 'persona' : 'personas'}.`]
      if (r.skipped.length > 0) partes.push(`Ya estaban o venían incompletas (${r.skipped.length}): ${r.skipped.slice(0, 5).join(', ')}${r.skipped.length > 5 ? '…' : ''}.`)
      if (invalid.length > 0) partes.push(`No se entendieron ${invalid.length} línea(s): ${invalid.slice(0, 3).join(' | ')}${invalid.length > 3 ? '…' : ''}.`)
      setNotice(partes.join(' '))
      setBulkText(''); setBulkOpen(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error en la carga masiva')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editName.trim() || !editDoc.trim()) { setErr('Completá nombre y documento.'); return }
    setSaving(true); setErr(null)
    try {
      await updateLifetimeMember(id, editName, editDoc)
      setEditingId(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(m: LifetimeMember) {
    if (deletingId !== m.id) { setDeletingId(m.id); return }
    try {
      const r = await deleteOrArchive('socio', m.id)
      setNotice(r.eliminado ? mensajeDeEliminado(r) : mensajeDeArchivado(r))
      await load()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setDeletingId(null)
    }
  }

  const visibles = members.filter((m) => m.archived_at == null)
  const q = search.trim().toLowerCase()
  const filtrados = q
    ? visibles.filter((m) => m.full_name.toLowerCase().includes(q) || m.document_number.includes(q.replace(/[.\s-]/g, '')))
    : visibles

  return (
    <div className="border-t border-zinc-800 px-4 py-4 space-y-3">
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre y apellido"
          className="flex-1 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
        />
        <input
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
          placeholder="DNI sin puntos"
          inputMode="numeric"
          className="sm:w-48 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          type="submit"
          disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors"
        >
          {saving ? 'Agregando...' : 'Agregar'}
        </button>
      </form>

      <button onClick={() => setBulkOpen((v) => !v)}
        className="text-xs text-zinc-400 hover:text-amber-400 transition-colors">
        {bulkOpen ? '▾' : '▸'} Cargar varias personas de una vez
      </button>
      {bulkOpen && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            Pegá una persona por línea, con el nombre y el DNI separados por coma, punto y coma o tabulación
            (también sirve pegar dos columnas desde Excel). Las que ya están en la lista se saltean.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={6}
            placeholder={'Juan Pérez, 30123456\nMaría Gómez, 28999111'}
            className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500"
          />
          <button onClick={handleBulk} disabled={saving || !bulkText.trim()}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2 rounded-lg text-sm transition-colors">
            {saving ? 'Cargando...' : 'Cargar personas'}
          </button>
        </div>
      )}

      {err && <p className="text-red-400 text-sm">{err}</p>}
      {notice && (
        <div className="bg-zinc-950 border border-amber-500/40 rounded-xl px-4 py-3 flex items-start gap-3">
          <p className="flex-1 text-sm text-zinc-200">{notice}</p>
          <button onClick={() => setNotice(null)} className="text-xs text-zinc-500 hover:text-white">Cerrar</button>
        </div>
      )}

      {visibles.length > 6 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o DNI"
          className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">Cargando...</p>
      ) : visibles.length === 0 ? (
        <p className="text-zinc-500 text-sm">Todavía no hay personas en esta lista.</p>
      ) : filtrados.length === 0 ? (
        <p className="text-zinc-500 text-sm">Ninguna persona coincide con la búsqueda.</p>
      ) : (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl divide-y divide-zinc-800">
          <p className="px-4 py-2 text-xs text-zinc-500">{filtrados.length} {filtrados.length === 1 ? 'persona' : 'personas'}</p>
          {filtrados.map((m) => (
            <div key={m.id} className="px-4 py-3">
              {editingId === m.id ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Nombre y apellido"
                    className="flex-1 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                  />
                  <input
                    value={editDoc}
                    onChange={(e) => setEditDoc(e.target.value)}
                    placeholder="DNI sin puntos"
                    inputMode="numeric"
                    className="sm:w-40 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => handleSaveEdit(m.id)} disabled={saving}
                      className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-4 py-2 rounded-lg text-xs transition-colors">
                      {saving ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button onClick={() => { setEditingId(null); setErr(null) }}
                      className="text-zinc-400 hover:text-white px-4 py-2 rounded-lg text-xs border border-zinc-700 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className={`flex-1 text-sm ${m.is_active ? 'text-zinc-200' : 'text-zinc-600 line-through'}`}>
                    {m.full_name}
                  </span>
                  <span className="text-zinc-500 text-xs font-mono">{m.document_number}</span>
                  <button onClick={() => { setEditingId(m.id); setEditName(m.full_name); setEditDoc(m.document_number); setErr(null) }}
                    className="text-xs text-zinc-400 hover:text-amber-400 transition-colors">
                    Editar
                  </button>
                  <button
                    onClick={async () => { await setLifetimeMemberActive(m.id, !m.is_active); load() }}
                    className={`text-xs transition-colors ${m.is_active ? 'text-zinc-500 hover:text-red-400' : 'text-zinc-500 hover:text-emerald-400'}`}
                  >
                    {m.is_active ? 'Desactivar' : 'Activar'}
                  </button>
                  {deletingId === m.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400">¿Eliminar?</span>
                      <button onClick={() => handleDelete(m)} className="text-xs text-red-400 hover:text-red-300 font-semibold">Sí</button>
                      <button onClick={() => setDeletingId(null)} className="text-xs text-zinc-500 hover:text-zinc-300">No</button>
                    </span>
                  ) : (
                    <button onClick={() => handleDelete(m)}
                      className="text-xs text-zinc-500 hover:text-red-400 transition-colors">
                      Eliminar
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── BenefitRow ──────────────────────────────────────────────────────────────
function BenefitRow({
  benefit, editingId, editName, editDesc, editType, editValue, editError, saving, togglingId,
  editRequiresDoc, editFullToBarber, onEditRequiresDoc, onEditFullToBarber,
  editListId, onEditListId, lists, listOptions,
  onEdit, onEditName, onEditDesc, onEditType, onEditValue, onSave, onCancelEdit, onToggle, onCancelToggle,
  deletingId, onDelete, onCancelDelete,
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
  editRequiresDoc: boolean
  editFullToBarber: boolean
  editListId: string
  onEditListId: (v: string) => void
  lists: MemberList[]
  listOptions: MemberList[]
  onEditRequiresDoc: (v: boolean) => void
  onEditFullToBarber: (v: boolean) => void
  onEdit: (b: Benefit) => void
  onEditName: (v: string) => void
  onEditDesc: (v: string) => void
  onEditType: (v: 'fixed' | 'percentage') => void
  onEditValue: (v: string) => void
  onSave: (id: string) => void
  onCancelEdit: () => void
  onToggle: (b: Benefit) => void
  onCancelToggle: () => void
  deletingId: string | null
  onDelete: (b: Benefit) => void
  onCancelDelete: () => void
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
            <CurrencyInput
              value={editValue} onChange={onEditValue}
              className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={editRequiresDoc}
              onChange={(e) => onEditRequiresDoc(e.target.checked)}
              className="mt-0.5 accent-amber-500" />
            <span className="text-xs text-zinc-300">Solo para personas habilitadas (pide DNI)</span>
          </label>
          {editRequiresDoc && (
            <select value={editListId} onChange={(e) => onEditListId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
              <option value="">Elegí una lista…</option>
              {listOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={editFullToBarber}
              onChange={(e) => onEditFullToBarber(e.target.checked)}
              className="mt-0.5 accent-amber-500" />
            <span className="text-xs text-zinc-300">Beneficio VIP (100% para el barbero)</span>
          </label>
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
            <div className="flex items-center gap-1.5">
              <p className="text-white font-semibold text-sm">{benefit.name}</p>
              {benefit.full_amount_to_barber && (
                <span className="text-[0.65rem] font-bold uppercase tracking-wide text-amber-400 border border-amber-500/40 rounded px-1.5 py-0.5">
                  VIP
                </span>
              )}
              {benefit.requires_member_document && (
                <span className="text-[0.65rem] font-bold uppercase tracking-wide text-violet-300 border border-violet-500/40 rounded px-1.5 py-0.5">
                  {lists.find((l) => l.id === benefit.member_list_id)?.name ?? 'Con DNI'} · DNI
                </span>
              )}
            </div>
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
            {deletingId === benefit.id ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">¿Eliminar?</span>
                <button onClick={() => onDelete(benefit)}
                  className="text-xs text-red-400 hover:text-red-300 font-semibold">Sí</button>
                <button onClick={onCancelDelete}
                  className="text-xs text-zinc-500 hover:text-zinc-300">No</button>
              </div>
            ) : (
              <button onClick={() => onDelete(benefit)}
                className="text-xs text-zinc-500 hover:text-red-400 transition-colors">
                Eliminar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
