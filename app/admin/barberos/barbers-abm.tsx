'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePersistedBranch, resolveInitialBranch } from '@/lib/hooks/usePersistedBranch'
import type {
  Branch,
  Profile,
  CompensationType,
  ProfileUpdate,
} from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getBranches,
  getAllBarbersByBranch,
  updateBarberProfile,
} from '@/lib/supabase/supabase.client'

// ─── Helpers ──────────────────────────────────────────────────────────────
const COMP_LABELS: Record<CompensationType, string> = {
  percentage: 'Comisión %',
  salary: 'Sueldo fijo',
  box_rental: 'Alquiler box',
}

function formatARS(n: number | null): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
}

// ─── Invite form state ─────────────────────────────────────────────────────
interface InviteForm {
  email: string
  full_name: string
  branch_id: string
  compensation_type: CompensationType
  commission_rate: string
  base_salary_rate: string
  presentismo_rate: string
  objetivo_rate: string
  objetivo_min_cuts: string
  box_rental_amount: string
}

const EMPTY_INVITE: InviteForm = {
  email: '',
  full_name: '',
  branch_id: '',
  compensation_type: 'percentage',
  commission_rate: '50',
  base_salary_rate: '',
  presentismo_rate: '',
  objetivo_rate: '',
  objetivo_min_cuts: '',
  box_rental_amount: '',
}

// ─── Edit form state ───────────────────────────────────────────────────────
interface EditForm {
  full_name: string
  compensation_type: CompensationType
  commission_rate: string
  base_salary_rate: string
  presentismo_rate: string
  objetivo_rate: string
  objetivo_min_cuts: string
  box_rental_amount: string
}

function profileToEditForm(p: Profile): EditForm {
  return {
    full_name: p.full_name,
    compensation_type: p.compensation_type,
    commission_rate: p.commission_rate != null ? String(p.commission_rate * 100) : '',
    base_salary_rate: p.base_salary_rate != null ? String(p.base_salary_rate) : '',
    presentismo_rate: p.presentismo_rate != null ? String(p.presentismo_rate) : '',
    objetivo_rate: p.objetivo_rate != null ? String(p.objetivo_rate) : '',
    objetivo_min_cuts: p.objetivo_min_cuts != null ? String(p.objetivo_min_cuts) : '',
    box_rental_amount: p.box_rental_amount != null ? String(p.box_rental_amount) : '',
  }
}

// ─── Compensation fields sub-form ─────────────────────────────────────────
function CompensationFields({
  type,
  form,
  onChange,
}: {
  type: CompensationType
  form: Pick<
    EditForm,
    | 'commission_rate'
    | 'base_salary_rate'
    | 'presentismo_rate'
    | 'objetivo_rate'
    | 'objetivo_min_cuts'
    | 'box_rental_amount'
  >
  onChange: (field: string, value: string) => void
}) {
  const input = (label: string, field: string, value: string, placeholder?: string) => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
        {label}
      </label>
      <input
        type="number"
        inputMode="numeric"
        placeholder={placeholder ?? '0'}
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  )

  if (type === 'percentage') {
    return input('Comisión (%)', 'commission_rate', form.commission_rate, '50')
  }

  if (type === 'salary') {
    return (
      <div className="grid grid-cols-2 gap-3">
        {input('Sueldo base ($)', 'base_salary_rate', form.base_salary_rate)}
        {input('Presentismo ($)', 'presentismo_rate', form.presentismo_rate)}
        {input('Objetivo ($)', 'objetivo_rate', form.objetivo_rate)}
        {input('Cortes p/objetivo', 'objetivo_min_cuts', form.objetivo_min_cuts)}
      </div>
    )
  }

  return input('Alquiler mensual ($)', 'box_rental_amount', form.box_rental_amount)
}

// ─── Main component ────────────────────────────────────────────────────────
export default function BarbersAbm() {
  const [adminProfile, setAdminProfile] = useState<Profile | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [barbers, setBarbers] = useState<Profile[]>([])
  const [selectedBranch, setSelectedBranch] = usePersistedBranch()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState<InviteForm>(EMPTY_INVITE)
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [newCredentials, setNewCredentials] = useState<{ email: string; password: string } | null>(null)

  // Edit
  const [editingBarber, setEditingBarber] = useState<Profile | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Invite existing barber
  const [invitingExisting, setInvitingExisting] = useState<Profile | null>(null)
  const [inviteExistingEmail, setInviteExistingEmail] = useState('')
  const [inviteExistingError, setInviteExistingError] = useState<string | null>(null)
  const [sendingExistingInvite, setSendingExistingInvite] = useState(false)

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Toggle active confirmation
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadBarbers = useCallback(async (branchId: string) => {
    const data = await getAllBarbersByBranch(branchId)
    setBarbers(data)
  }, [])

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [p, bs] = await Promise.all([getCurrentProfile(), getBranches()])
      if (!p) { setError('No autenticado'); return }
      setAdminProfile(p)
      setBranches(bs)
      const branch = resolveInitialBranch(bs)
      setSelectedBranch(branch)
      setInviteForm((f) => ({ ...f, branch_id: branch }))
      await loadBarbers(branch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [loadBarbers])

  useEffect(() => { loadInitial() }, [loadInitial])

  async function handleBranchChange(branchId: string) {
    setSelectedBranch(branchId)
    setInviteForm((f) => ({ ...f, branch_id: branchId }))
    try {
      await loadBarbers(branchId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cambiar sucursal')
    }
  }

  // ── Invite ──────────────────────────────────────────────────────────────
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteError(null)

    try {
      const payload = {
        email: inviteForm.email.trim(),
        full_name: inviteForm.full_name.trim(),
        branch_id: inviteForm.branch_id,
        compensation_type: inviteForm.compensation_type,
        commission_rate:
          inviteForm.compensation_type === 'percentage' && inviteForm.commission_rate
            ? parseFloat(inviteForm.commission_rate) / 100
            : null,
        base_salary_rate:
          inviteForm.base_salary_rate ? parseFloat(inviteForm.base_salary_rate) : null,
        presentismo_rate:
          inviteForm.presentismo_rate ? parseFloat(inviteForm.presentismo_rate) : null,
        objetivo_rate:
          inviteForm.objetivo_rate ? parseFloat(inviteForm.objetivo_rate) : null,
        objetivo_min_cuts:
          inviteForm.objetivo_min_cuts ? parseInt(inviteForm.objetivo_min_cuts, 10) : null,
        box_rental_amount:
          inviteForm.box_rental_amount ? parseFloat(inviteForm.box_rental_amount) : null,
      }

      const res = await fetch('/api/invite-barber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al crear barbero')

      setNewCredentials(json.credentials)
      setShowInvite(false)
      setInviteForm({ ...EMPTY_INVITE, branch_id: selectedBranch })
      await loadBarbers(selectedBranch)
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Error al invitar')
    } finally {
      setInviting(false)
    }
  }

  // ── Edit ────────────────────────────────────────────────────────────────
  function openEdit(barber: Profile) {
    setEditingBarber(barber)
    setEditForm(profileToEditForm(barber))
    setEditError(null)
  }

  function patchEditForm(field: string, value: string) {
    setEditForm((f) => f ? { ...f, [field]: value } : f)
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingBarber || !editForm) return
    setSaving(true)
    setEditError(null)

    try {
      const updates: ProfileUpdate = {
        full_name: editForm.full_name.trim(),
        compensation_type: editForm.compensation_type,
        commission_rate:
          editForm.compensation_type === 'percentage' && editForm.commission_rate
            ? parseFloat(editForm.commission_rate) / 100
            : null,
        base_salary_rate: editForm.base_salary_rate ? parseFloat(editForm.base_salary_rate) : null,
        presentismo_rate: editForm.presentismo_rate ? parseFloat(editForm.presentismo_rate) : null,
        objetivo_rate: editForm.objetivo_rate ? parseFloat(editForm.objetivo_rate) : null,
        objetivo_min_cuts: editForm.objetivo_min_cuts ? parseInt(editForm.objetivo_min_cuts, 10) : null,
        box_rental_amount: editForm.box_rental_amount ? parseFloat(editForm.box_rental_amount) : null,
      }

      await updateBarberProfile(editingBarber.id, updates)
      setBarbers((prev) =>
        prev.map((b) => (b.id === editingBarber.id ? { ...b, ...updates } : b))
      )
      setEditingBarber(null)
      setEditForm(null)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // ── Toggle active ────────────────────────────────────────────────────────
  async function handleToggleActive(barber: Profile) {
    if (togglingId !== barber.id) {
      setTogglingId(barber.id)
      return
    }
    try {
      const next = !barber.is_active
      await updateBarberProfile(barber.id, { is_active: next })
      setBarbers((prev) =>
        prev.map((b) => (b.id === barber.id ? { ...b, is_active: next } : b))
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cambiar estado')
    } finally {
      setTogglingId(null)
    }
  }

  // ── Invite existing barber ───────────────────────────────────────────────
  async function handleInviteExisting(e: React.FormEvent) {
    e.preventDefault()
    if (!invitingExisting) return
    setSendingExistingInvite(true)
    setInviteExistingError(null)
    try {
      const res = await fetch('/api/invite-existing-barber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: invitingExisting.id, email: inviteExistingEmail.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al invitar')
      setNewCredentials(json.credentials)
      setInvitingExisting(null)
      setInviteExistingEmail('')
      await loadBarbers(selectedBranch)
    } catch (e) {
      setInviteExistingError(e instanceof Error ? e.message : 'Error al invitar')
    } finally {
      setSendingExistingInvite(false)
    }
  }

  // ── Delete (soft) ─────────────────────────────────────────────────────────
  async function handleDelete(barber: Profile) {
    if (deletingId !== barber.id) { setDeletingId(barber.id); return }
    try {
      await updateBarberProfile(barber.id, { is_active: false })
      setBarbers((prev) => prev.map((b) => b.id === barber.id ? { ...b, is_active: false } : b))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-400">
        Cargando barberos...
      </div>
    )
  }

  if (error) {
    return <div className="p-6 text-red-400">{error}</div>
  }

  const active = barbers.filter((b) => b.is_active)
  const inactive = barbers.filter((b) => !b.is_active)

  return (
    <div className="max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Barberos</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Invitá, editá comisiones y gestioná el equipo
          </p>
        </div>
        <button
          onClick={() => { setShowInvite(true); setInviteError(null) }}
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          Invitar barbero
        </button>
      </div>

      {/* Branch selector */}
      {branches.length > 1 && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
            Sucursal
          </label>
          <select
            value={selectedBranch}
            onChange={(e) => handleBranchChange(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Invite form */}
      {showInvite && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-white">Invitar nuevo barbero</h2>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Nombre completo
                </label>
                <input
                  required
                  type="text"
                  value={inviteForm.full_name}
                  onChange={(e) => setInviteForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Email
                </label>
                <input
                  required
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              {branches.length > 1 && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                    Sucursal
                  </label>
                  <select
                    value={inviteForm.branch_id}
                    onChange={(e) => setInviteForm((f) => ({ ...f, branch_id: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Modelo de compensación
                </label>
                <select
                  value={inviteForm.compensation_type}
                  onChange={(e) =>
                    setInviteForm((f) => ({
                      ...f,
                      compensation_type: e.target.value as CompensationType,
                    }))
                  }
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                >
                  {(Object.entries(COMP_LABELS) as [CompensationType, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <CompensationFields
              type={inviteForm.compensation_type}
              form={inviteForm}
              onChange={(field, value) =>
                setInviteForm((f) => ({ ...f, [field]: value }))
              }
            />

            {inviteError && <p className="text-red-400 text-sm">{inviteError}</p>}

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={inviting}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                {inviting ? 'Enviando...' : 'Enviar invitación'}
              </button>
              <button
                type="button"
                onClick={() => setShowInvite(false)}
                className="text-zinc-400 hover:text-white px-5 py-2.5 rounded-lg text-sm border border-zinc-700 hover:border-zinc-500 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit modal */}
      {editingBarber && editForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-lg space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Editar barbero</h2>
              <button
                onClick={() => { setEditingBarber(null); setEditForm(null) }}
                className="text-zinc-500 hover:text-white text-xl leading-none"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Nombre completo
                </label>
                <input
                  required
                  type="text"
                  value={editForm.full_name}
                  onChange={(e) => patchEditForm('full_name', e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Modelo de compensación
                </label>
                <select
                  value={editForm.compensation_type}
                  onChange={(e) =>
                    patchEditForm('compensation_type', e.target.value)
                  }
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                >
                  {(Object.entries(COMP_LABELS) as [CompensationType, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <CompensationFields
                type={editForm.compensation_type}
                form={editForm}
                onChange={patchEditForm}
              />

              {editError && <p className="text-red-400 text-sm">{editError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors"
                >
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingBarber(null); setEditForm(null) }}
                  className="text-zinc-400 hover:text-white px-5 py-2.5 rounded-lg text-sm border border-zinc-700 hover:border-zinc-500 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Active barbers */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Activos · {active.length}
        </h2>
        {active.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-10 text-center">
            <p className="text-zinc-500 text-sm">No hay barberos activos</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {active.map((barber) => (
              <BarberRow
                key={barber.id}
                barber={barber}
                deletingId={deletingId}
                onEdit={openEdit}
                onInvite={(b) => { setInvitingExisting(b); setInviteExistingEmail(''); setInviteExistingError(null) }}
                onDelete={handleDelete}
                onCancelDelete={() => setDeletingId(null)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Inactive barbers */}
      {inactive.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Inactivos · {inactive.length}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {inactive.map((barber) => (
              <BarberRow
                key={barber.id}
                barber={barber}
                deletingId={deletingId}
                onEdit={openEdit}
                onInvite={(b) => { setInvitingExisting(b); setInviteExistingEmail(''); setInviteExistingError(null) }}
                onDelete={handleDelete}
                onCancelDelete={() => setDeletingId(null)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Modal: invitar barbero existente */}
      {invitingExisting && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Invitar a {invitingExisting.full_name}</h2>
                <p className="text-zinc-500 text-xs mt-0.5">Se creará su acceso a la app</p>
              </div>
              <button onClick={() => { setInvitingExisting(null); setInviteExistingEmail(''); setInviteExistingError(null) }} className="text-zinc-500 hover:text-white text-xl">✕</button>
            </div>
            <form onSubmit={handleInviteExisting} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Email del barbero</label>
                <input
                  required
                  type="email"
                  autoFocus
                  value={inviteExistingEmail}
                  onChange={(e) => setInviteExistingEmail(e.target.value)}
                  placeholder="nombre@email.com"
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              {inviteExistingError && <p className="text-red-400 text-sm">{inviteExistingError}</p>}
              <div className="flex gap-3">
                <button type="submit" disabled={sendingExistingInvite}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors">
                  {sendingExistingInvite ? 'Creando acceso...' : 'Generar acceso'}
                </button>
                <button type="button" onClick={() => { setInvitingExisting(null); setInviteExistingEmail(''); setInviteExistingError(null) }}
                  className="px-4 py-2.5 rounded-lg text-sm border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: credenciales del barbero */}
      {newCredentials && (
        <CredentialsModal
          credentials={newCredentials}
          onClose={() => setNewCredentials(null)}
        />
      )}
    </div>
  )
}

// ─── CredentialsModal ─────────────────────────────────────────────────────
function CredentialsModal({
  credentials,
  onClose,
}: {
  credentials: { email: string; password: string }
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [editablePassword, setEditablePassword] = useState(credentials.password)
  const appLink = typeof window !== 'undefined' ? `${window.location.origin}/barber` : '/barber'

  function copyAll() {
    const text = `🪒 Acceso a Valhalla Barbershop\n\nUsuario: ${credentials.email}\nContraseña: ${editablePassword}\nLink directo: ${appLink}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xl">✓</div>
          <div>
            <p className="text-white font-bold">Acceso creado</p>
            <p className="text-zinc-400 text-xs">Compartí estos datos con el barbero</p>
          </div>
        </div>

        <div className="bg-zinc-800 rounded-xl p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Email</p>
            <p className="text-white font-mono text-sm select-all">{credentials.email}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Contraseña</p>
            <input
              type="text"
              value={editablePassword}
              onChange={(e) => setEditablePassword(e.target.value)}
              className="w-full bg-zinc-700 border border-zinc-600 text-amber-400 font-mono text-base font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500"
            />
            <p className="text-zinc-600 text-xs mt-1">Podés editarla antes de copiar</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Link directo</p>
            <p className="text-emerald-400 font-mono text-xs select-all break-all">{appLink}</p>
          </div>
        </div>

        <button
          onClick={copyAll}
          className={`w-full font-bold py-2.5 rounded-lg text-sm transition-colors ${
            copied
              ? 'bg-emerald-500 text-white'
              : 'bg-zinc-700 hover:bg-zinc-600 text-white border border-zinc-600'
          }`}
        >
          {copied ? '✓ Copiado — listo para enviar' : '📋 Copiar todo para compartir'}
        </button>

        <button
          onClick={onClose}
          className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold py-2.5 rounded-lg text-sm transition-colors"
        >
          Listo
        </button>
      </div>
    </div>
  )
}

// ─── BarberRow sub-component ──────────────────────────────────────────────
function BarberRow({
  barber,
  deletingId,
  onEdit,
  onInvite,
  onDelete,
  onCancelDelete,
}: {
  barber: Profile
  deletingId: string | null
  onEdit: (b: Profile) => void
  onInvite: (b: Profile) => void
  onDelete: (b: Profile) => void
  onCancelDelete: () => void
}) {
  function rateLabel(b: Profile): string {
    if (b.compensation_type === 'percentage')
      return b.commission_rate != null ? `${Math.round(b.commission_rate * 100)}%` : '—'
    if (b.compensation_type === 'salary')
      return b.base_salary_rate != null
        ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(b.base_salary_rate)
        : '—'
    return b.box_rental_amount != null
      ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(b.box_rental_amount)
      : '—'
  }

  const isDeleting = deletingId === barber.id

  return (
    <div className={`bg-zinc-900 border rounded-xl px-5 py-4 flex items-center justify-between gap-4 ${barber.is_active ? 'border-zinc-800' : 'border-zinc-800/50 opacity-60'}`}>
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold text-sm truncate">{barber.full_name}</p>
        <p className="text-zinc-500 text-xs mt-0.5">
          {COMP_LABELS[barber.compensation_type]} · {rateLabel(barber)}
          {!barber.is_active && <span className="ml-2 text-zinc-600">· Inactivo</span>}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Editar */}
        <button
          onClick={() => onEdit(barber)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-amber-400 border border-zinc-700 hover:border-amber-500/50 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Editar
        </button>

        {/* Invitar */}
        {barber.is_active && (
          <button
            onClick={() => onInvite(barber)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-emerald-400 border border-zinc-700 hover:border-emerald-500/50 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            Invitar
          </button>
        )}

        {/* Eliminar / Activar */}
        {isDeleting ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">¿{barber.is_active ? 'Eliminar' : 'Ya eliminado'}?</span>
            <button onClick={() => onDelete(barber)} className="text-xs text-red-400 hover:text-red-300 font-bold">Sí</button>
            <button onClick={onCancelDelete} className="text-xs text-zinc-500 hover:text-zinc-300">No</button>
          </div>
        ) : (
          <button
            onClick={() => onDelete(barber)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-red-400 border border-zinc-700 hover:border-red-500/40 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
            {barber.is_active ? 'Eliminar' : 'Activar'}
          </button>
        )}
      </div>
    </div>
  )
}
