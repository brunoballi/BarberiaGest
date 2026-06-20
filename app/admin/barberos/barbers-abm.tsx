'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePersistedBranch, getStoredBranch } from '@/lib/hooks/usePersistedBranch'
import type {
  Branch,
  Profile,
  CompensationType,
  ProfileUpdate,
} from '@/lib/supabase/database.types'
import {
  getCurrentProfile,
  getAllBarbersByBranch,
  supabase,
  updateBarberProfile,
} from '@/lib/supabase/supabase.client'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import { CurrencyInput } from '@/app/components/currency-input'
import { TextInput } from '@/app/components/text-input'

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
  dni: string
  birth_date: string
  branch_id: string
  compensation_type: CompensationType
  commission_rate: string
  base_salary_rate: string
  presentismo_rate: string
  objetivo_rate: string
  objetivo_min_cuts: string
  box_rental_amount: string
  receives_transfers: boolean
  advance_enabled: boolean
  advance_limit: string
}

const EMPTY_INVITE: InviteForm = {
  email: '',
  full_name: '',
  dni: '',
  birth_date: '',
  branch_id: '',
  compensation_type: 'percentage',
  commission_rate: '50',
  base_salary_rate: '',
  presentismo_rate: '',
  objetivo_rate: '',
  objetivo_min_cuts: '',
  box_rental_amount: '',
  receives_transfers: true,
  advance_enabled: false,
  advance_limit: '',
}

// ─── Edit form state ───────────────────────────────────────────────────────
interface EditForm {
  full_name: string
  dni: string
  birth_date: string
  compensation_type: CompensationType
  commission_rate: string
  base_salary_rate: string
  presentismo_rate: string
  objetivo_rate: string
  objetivo_min_cuts: string
  box_rental_amount: string
  receives_transfers: boolean
  advance_enabled: boolean
  advance_limit: string
}

function profileToEditForm(p: Profile): EditForm {
  return {
    full_name: p.full_name,
    dni: p.dni ?? '',
    birth_date: p.birth_date ?? '',
    compensation_type: p.compensation_type,
    commission_rate: p.commission_rate != null ? String(p.commission_rate * 100) : '',
    base_salary_rate: p.base_salary_rate != null ? String(p.base_salary_rate) : '',
    presentismo_rate: p.presentismo_rate != null ? String(p.presentismo_rate * 100) : '',
    objetivo_rate: p.objetivo_rate != null ? String(p.objetivo_rate * 100) : '',
    objetivo_min_cuts: p.objetivo_min_cuts != null ? String(p.objetivo_min_cuts) : '',
    box_rental_amount: p.box_rental_amount != null ? String(p.box_rental_amount) : '',
    receives_transfers: p.receives_transfers,
    advance_enabled: p.advance_enabled,
    advance_limit: p.advance_limit != null && p.advance_limit > 0 ? String(p.advance_limit) : '',
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
      <CurrencyInput
        placeholder={placeholder ?? '0'}
        value={value}
        onChange={(v) => onChange(field, v)}
        className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
      />
    </div>
  )

  const moneyInput = (label: string, field: string, value: string, placeholder?: string) => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
        {label}
      </label>
      <CurrencyInput
        value={value}
        onChange={(v) => onChange(field, v)}
        placeholder={placeholder ?? '0,00'}
        className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
      />
    </div>
  )

  const salaryFields = (
    <div className="grid grid-cols-2 gap-3">
      {moneyInput('Sueldo base ($)', 'base_salary_rate', form.base_salary_rate)}
      {input('Presentismo (% del total)', 'presentismo_rate', form.presentismo_rate, '5')}
      {input('Objetivo (% del total)', 'objetivo_rate', form.objetivo_rate, '5')}
      {input('Cortes p/objetivo', 'objetivo_min_cuts', form.objetivo_min_cuts)}
    </div>
  )

  if (type === 'percentage') {
    // Comisión % + (opcional) sueldo base, presentismo, objetivo y cortes p/objetivo
    return (
      <div className="space-y-3">
        {input('Comisión (%)', 'commission_rate', form.commission_rate, '50')}
        {salaryFields}
      </div>
    )
  }

  if (type === 'salary') {
    return salaryFields
  }

  return moneyInput('Alquiler mensual ($)', 'box_rental_amount', form.box_rental_amount)
}

// ─── Main component ────────────────────────────────────────────────────────
export default function BarbersAbm() {
  const router = useRouter()
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
  const [editEmail, setEditEmail] = useState('')
  const [editEmailOriginal, setEditEmailOriginal] = useState('')
  const [editEmailLoading, setEditEmailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Invite existing barber (sin cuenta auth)
  const [invitingExisting, setInvitingExisting] = useState<Profile | null>(null)
  const [inviteExistingEmail, setInviteExistingEmail] = useState('')
  const [inviteExistingError, setInviteExistingError] = useState<string | null>(null)
  const [sendingExistingInvite, setSendingExistingInvite] = useState(false)

  // Credenciales (reset password para barbero con cuenta)
  const [credentialsLoadingId, setCredentialsLoadingId] = useState<string | null>(null)

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Toggle active confirmation
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Hard delete (eliminar definitivamente) confirmation
  const [hardDeletingId, setHardDeletingId] = useState<string | null>(null)

  const loadBarbers = useCallback(async (branchId: string) => {
    const data = await getAllBarbersByBranch(branchId)
    setBarbers(data)
  }, [])

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [p, bs] = await Promise.all([getCurrentProfile(), getMyBranchesCached()])
      if (!p) { setError('No autenticado'); return }
      if (bs.length === 0) { setError('No tenés sucursales asignadas.'); return }
      setAdminProfile(p)
      setBranches(bs)

      const stored = getStoredBranch()
      const branch = stored && bs.some((b) => b.id === stored) ? stored : null
      if (!branch) { router.replace('/admin/select-branch'); return }

      setSelectedBranch(branch)
      setInviteForm((f) => ({ ...f, branch_id: branch }))
      await loadBarbers(branch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [loadBarbers, router, setSelectedBranch])

  useEffect(() => { loadInitial() }, [loadInitial])

  // Realtime: cambios en barberos de la sucursal (otro admin edita) → recargar
  useEffect(() => {
    if (!selectedBranch) return
    const channel = supabase
      .channel(`barbers-branch-${selectedBranch}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `branch_id=eq.${selectedBranch}` }, () => { loadBarbers(selectedBranch) })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selectedBranch, loadBarbers])

  // ── Invite ──────────────────────────────────────────────────────────────
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteError(null)

    try {
      const payload = {
        email: inviteForm.email.trim(),
        full_name: inviteForm.full_name.trim(),
        dni: inviteForm.dni.trim() || null,
        birth_date: inviteForm.birth_date || null,
        branch_id: inviteForm.branch_id,
        compensation_type: inviteForm.compensation_type,
        commission_rate:
          inviteForm.compensation_type === 'percentage' && inviteForm.commission_rate
            ? parseFloat(inviteForm.commission_rate) / 100
            : null,
        base_salary_rate:
          inviteForm.base_salary_rate ? parseFloat(inviteForm.base_salary_rate) : null,
        presentismo_rate:
          inviteForm.presentismo_rate ? parseFloat(inviteForm.presentismo_rate) / 100 : null,
        objetivo_rate:
          inviteForm.objetivo_rate ? parseFloat(inviteForm.objetivo_rate) / 100 : null,
        objetivo_min_cuts:
          inviteForm.objetivo_min_cuts ? parseInt(inviteForm.objetivo_min_cuts, 10) : null,
        box_rental_amount:
          inviteForm.box_rental_amount ? parseFloat(inviteForm.box_rental_amount) : null,
        receives_transfers: inviteForm.receives_transfers,
        advance_enabled: inviteForm.advance_enabled,
        advance_limit:
          inviteForm.advance_enabled && inviteForm.advance_limit
            ? parseFloat(inviteForm.advance_limit)
            : 0,
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
  async function openEdit(barber: Profile) {
    setEditingBarber(barber)
    setEditForm(profileToEditForm(barber))
    setEditError(null)
    setEditEmail('')
    setEditEmailOriginal('')
    setEditEmailLoading(true)
    try {
      const res = await fetch(`/api/get-barber-email?profileId=${barber.id}`)
      const json = await res.json()
      const email = json.email ?? ''
      setEditEmail(email)
      setEditEmailOriginal(email)
    } catch { /* sin cuenta auth — email vacío */ } finally {
      setEditEmailLoading(false)
    }
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
        dni: editForm.dni.trim() || null,
        birth_date: editForm.birth_date || null,
        compensation_type: editForm.compensation_type,
        commission_rate:
          editForm.compensation_type === 'percentage' && editForm.commission_rate
            ? parseFloat(editForm.commission_rate) / 100
            : null,
        base_salary_rate: editForm.base_salary_rate ? parseFloat(editForm.base_salary_rate) : null,
        presentismo_rate: editForm.presentismo_rate ? parseFloat(editForm.presentismo_rate) / 100 : null,
        objetivo_rate: editForm.objetivo_rate ? parseFloat(editForm.objetivo_rate) / 100 : null,
        objetivo_min_cuts: editForm.objetivo_min_cuts ? parseInt(editForm.objetivo_min_cuts, 10) : null,
        box_rental_amount: editForm.box_rental_amount ? parseFloat(editForm.box_rental_amount) : null,
        receives_transfers: editForm.receives_transfers,
        advance_enabled: editForm.advance_enabled,
        advance_limit: editForm.advance_enabled && editForm.advance_limit
          ? parseFloat(editForm.advance_limit)
          : 0,
      }

      await updateBarberProfile(editingBarber.id, updates)

      // Actualizar email en auth si cambió
      const newEmail = editEmail.trim()
      if (newEmail && newEmail !== editEmailOriginal) {
        const res = await fetch('/api/update-barber-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: editingBarber.id, email: newEmail }),
        })
        if (!res.ok) {
          const json = await res.json()
          throw new Error(json.error ?? 'Error al actualizar email')
        }
      }

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

  // ── Credenciales (reset password o primer acceso) ───────────────────────
  async function handleCredentials(barber: Profile) {
    setCredentialsLoadingId(barber.id)
    try {
      const res = await fetch('/api/reset-barber-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: barber.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'no-auth') {
          // No tiene cuenta → abrir flujo de invitación por email
          setInvitingExisting(barber)
          setInviteExistingEmail('')
          setInviteExistingError(null)
        } else {
          setError(json.error ?? 'Error al obtener credenciales')
        }
        return
      }
      setNewCredentials(json.credentials)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setCredentialsLoadingId(null)
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

  // ── Hard delete (eliminar definitivamente, solo inactivos sin datos) ───────
  async function handleHardDelete(barber: Profile) {
    if (hardDeletingId !== barber.id) { setHardDeletingId(barber.id); return }
    try {
      const res = await fetch(`/api/barbers/${barber.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Error al eliminar')
      setBarbers((prev) => prev.filter((b) => b.id !== barber.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setHardDeletingId(null)
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
    <div className="w-full px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flowi-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
          Alta Barbero
        </button>
      </div>

      {/* Branch selector eliminado — la sucursal viene del contexto post-login */}

      {/* Invite form */}
      {showInvite && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-white">Alta Barbero</h2>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Nombre completo
                </label>
                <TextInput
                  required
                  value={inviteForm.full_name}
                  onChange={(v) => setInviteForm((f) => ({ ...f, full_name: v }))}
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
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  DNI
                </label>
                <input
                  type="text"
                  value={inviteForm.dni}
                  onChange={(e) => setInviteForm((f) => ({ ...f, dni: e.target.value }))}
                  placeholder="Ej: 30123456"
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Fecha de nacimiento
                </label>
                <input
                  type="date"
                  value={inviteForm.birth_date}
                  onChange={(e) => setInviteForm((f) => ({ ...f, birth_date: e.target.value }))}
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

            {/* Transferencias */}
            <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg px-4 py-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inviteForm.receives_transfers}
                  onChange={(e) => setInviteForm((f) => ({ ...f, receives_transfers: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-amber-500"
                />
                <span>
                  <span className="block text-sm font-semibold text-white">Recibe transferencias en su cuenta</span>
                  <span className="block text-xs text-zinc-400 mt-0.5">
                    {inviteForm.receives_transfers
                      ? 'Las transferencias las cobra el barbero directamente (ya cobrado).'
                      : 'Las transferencias van a la cuenta de Valhalla; se le pagan en la liquidación.'}
                  </span>
                </span>
              </label>
            </div>

            {/* Adelantos */}
            <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg px-4 py-3 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inviteForm.advance_enabled}
                  onChange={(e) => setInviteForm((f) => ({ ...f, advance_enabled: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-amber-500"
                />
                <span>
                  <span className="block text-sm font-semibold text-white">Habilitar adelantos</span>
                  <span className="block text-xs text-zinc-400 mt-0.5">
                    {inviteForm.advance_enabled
                      ? 'El barbero verá el botón "Pedir adelanto" en su vista.'
                      : 'El botón "Pedir adelanto" queda oculto para el barbero.'}
                  </span>
                </span>
              </label>

              {inviteForm.advance_enabled && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                    Límite por adelanto ($)
                  </label>
                  <CurrencyInput
                    placeholder="0 = sin tope"
                    value={inviteForm.advance_limit}
                    onChange={(v) => setInviteForm((f) => ({ ...f, advance_limit: v }))}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                  <p className="text-xs text-zinc-500 mt-1">
                    Monto máximo que puede solicitar por adelanto. Dejalo vacío o en 0 para no imponer tope.
                  </p>
                </div>
              )}
            </div>

            {inviteError && <p className="text-red-400 text-sm">{inviteError}</p>}

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={inviting}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                {inviting ? 'Guardando...' : 'Guardar'}
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
                <TextInput
                  required
                  value={editForm.full_name}
                  onChange={(v) => patchEditForm('full_name', v)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                  Email (acceso a la app)
                </label>
                {editEmailLoading ? (
                  <div className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-500">
                    Cargando...
                  </div>
                ) : (
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="Sin cuenta de acceso"
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                )}
                {editEmail && editEmail !== editEmailOriginal && (
                  <p className="text-amber-400 text-xs mt-1">⚠ Se actualizará el email de acceso a la app</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                    DNI
                  </label>
                  <input
                    type="text"
                    value={editForm.dni}
                    onChange={(e) => patchEditForm('dni', e.target.value)}
                    placeholder="Ej: 30123456"
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                    Fecha de nacimiento
                  </label>
                  <input
                    type="date"
                    value={editForm.birth_date}
                    onChange={(e) => patchEditForm('birth_date', e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Mejora 3: configuración de transferencias */}
              <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg px-4 py-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.receives_transfers}
                    onChange={(e) => setEditForm((f) => f ? { ...f, receives_transfers: e.target.checked } : f)}
                    className="mt-0.5 w-4 h-4 accent-amber-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-white">Recibe transferencias en su cuenta</span>
                    <span className="block text-xs text-zinc-400 mt-0.5">
                      {editForm.receives_transfers
                        ? 'Las transferencias las cobra el barbero directamente (ya cobrado).'
                        : 'Las transferencias van a la cuenta de Valhalla; se le pagan en la liquidación.'}
                    </span>
                  </span>
                </label>
              </div>

              {/* Adelantos: habilitación + tope por solicitud */}
              <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg px-4 py-3 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.advance_enabled}
                    onChange={(e) => setEditForm((f) => f ? { ...f, advance_enabled: e.target.checked } : f)}
                    className="mt-0.5 w-4 h-4 accent-amber-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-white">Habilitar adelantos</span>
                    <span className="block text-xs text-zinc-400 mt-0.5">
                      {editForm.advance_enabled
                        ? 'El barbero verá el botón "Pedir adelanto" en su vista.'
                        : 'El botón "Pedir adelanto" queda oculto para el barbero.'}
                    </span>
                  </span>
                </label>

                {editForm.advance_enabled && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                      Límite por adelanto ($)
                    </label>
                    <CurrencyInput
                      placeholder="0 = sin tope"
                      value={editForm.advance_limit}
                      onChange={(v) => patchEditForm('advance_limit', v)}
                      className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                    />
                    <p className="text-xs text-zinc-500 mt-1">
                      Monto máximo que puede solicitar por adelanto. Dejalo vacío o en 0 para no imponer tope.
                    </p>
                  </div>
                )}
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
                togglingId={togglingId}
                credentialsLoadingId={credentialsLoadingId}
                onEdit={openEdit}
                onCredentials={handleCredentials}
                onDelete={handleDelete}
                onCancelDelete={() => setDeletingId(null)}
                onToggleActive={handleToggleActive}
                onCancelToggle={() => setTogglingId(null)}
                hardDeletingId={hardDeletingId}
                onHardDelete={handleHardDelete}
                onCancelHardDelete={() => setHardDeletingId(null)}
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
                togglingId={togglingId}
                credentialsLoadingId={credentialsLoadingId}
                onEdit={openEdit}
                onCredentials={handleCredentials}
                onDelete={handleDelete}
                onCancelDelete={() => setDeletingId(null)}
                onToggleActive={handleToggleActive}
                onCancelToggle={() => setTogglingId(null)}
                hardDeletingId={hardDeletingId}
                onHardDelete={handleHardDelete}
                onCancelHardDelete={() => setHardDeletingId(null)}
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
    const text = `🪒 Acceso a Valhalla Gestor\n\nUsuario: ${credentials.email}\nContraseña: ${editablePassword}\nLink directo: ${appLink}`
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
  togglingId,
  credentialsLoadingId,
  onEdit,
  onCredentials,
  onDelete,
  onCancelDelete,
  onToggleActive,
  onCancelToggle,
  hardDeletingId,
  onHardDelete,
  onCancelHardDelete,
}: {
  barber: Profile
  deletingId: string | null
  togglingId: string | null
  credentialsLoadingId: string | null
  onEdit: (b: Profile) => void
  onCredentials: (b: Profile) => void
  onDelete: (b: Profile) => void
  onCancelDelete: () => void
  onToggleActive: (b: Profile) => void
  onCancelToggle: () => void
  hardDeletingId: string | null
  onHardDelete: (b: Profile) => void
  onCancelHardDelete: () => void
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

  const isDeleting     = deletingId     === barber.id
  const isToggling     = togglingId     === barber.id
  const isHardDeleting = hardDeletingId === barber.id

  return (
    <div className={`bg-zinc-900 border rounded-xl px-5 py-4 flex items-center justify-between gap-4 ${barber.is_active ? 'border-zinc-800' : 'border-zinc-800/50 opacity-60'}`}>
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold text-sm truncate">{barber.full_name}</p>
        <p className="text-zinc-500 text-xs mt-0.5">
          {COMP_LABELS[barber.compensation_type]} · {rateLabel(barber)}
          {!barber.receives_transfers && <span className="ml-2 text-indigo-400">· Transf → Valhalla</span>}
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

        {/* Credenciales — solo activos */}
        {barber.is_active && (
          <button
            onClick={() => onCredentials(barber)}
            disabled={credentialsLoadingId === barber.id}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-emerald-400 border border-zinc-700 hover:border-emerald-500/50 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            {credentialsLoadingId === barber.id ? (
              <span className="w-3.5 h-3.5 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            )}
            Credenciales
          </button>
        )}

        {/* Activar — solo inactivos */}
        {!barber.is_active && (
          isToggling ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">¿Activar?</span>
              <button onClick={() => onToggleActive(barber)} className="text-xs text-emerald-400 hover:text-emerald-300 font-bold">Sí</button>
              <button onClick={onCancelToggle} className="text-xs text-zinc-500 hover:text-zinc-300">No</button>
            </div>
          ) : (
            <button
              onClick={() => onToggleActive(barber)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-emerald-400 border border-zinc-700 hover:border-emerald-500/40 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <path d="M12 5v14M5 12l7-7 7 7"/>
              </svg>
              Activar
            </button>
          )
        )}

        {/* Eliminar definitivamente — solo inactivos */}
        {!barber.is_active && (
          isHardDeleting ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">¿Eliminar definitivo?</span>
              <button onClick={() => onHardDelete(barber)} className="text-xs text-red-400 hover:text-red-300 font-bold">Sí</button>
              <button onClick={onCancelHardDelete} className="text-xs text-zinc-500 hover:text-zinc-300">No</button>
            </div>
          ) : (
            <button
              onClick={() => onHardDelete(barber)}
              title="Eliminar definitivamente (solo inactivos sin datos)"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-red-400 border border-zinc-700 hover:border-red-500/40 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4h6v2"/>
              </svg>
              Eliminar definitivo
            </button>
          )
        )}

        {/* Eliminar — solo activos */}
        {barber.is_active && (
          isDeleting ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">¿Eliminar?</span>
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
              Eliminar
            </button>
          )
        )}
      </div>
    </div>
  )
}
