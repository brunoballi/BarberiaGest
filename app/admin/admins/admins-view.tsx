'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentProfile } from '@/lib/supabase/supabase.client'
import '../admin-dashboard.css'

interface AdminUser {
  id: string
  full_name: string
  is_active: boolean
  branches: { id: string; name: string }[]
}

interface Branch {
  id: string
  name: string
}

interface Credentials {
  email: string
  password: string
}

export default function AdminsView() {
  const router = useRouter()
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', branch_ids: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [resettingId, setResettingId] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)

  // Edit admin
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', email: '', branch_ids: [] as string[] })
  const [editEmail, setEditEmail] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const profile = await getCurrentProfile()
      if (!profile || profile.role !== 'admin') {
        router.replace('/login')
        return
      }
      setCurrentUserId(profile.id)
      const res = await fetch('/api/admin-users')
      if (!res.ok) throw new Error('Error cargando admins')
      const data = await res.json()
      setAdmins(data.admins)
      setBranches(data.branches)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { load() }, [load])

  function toggleBranch(id: string) {
    setForm((f) => ({
      ...f,
      branch_ids: f.branch_ids.includes(id)
        ? f.branch_ids.filter((b) => b !== id)
        : [...f.branch_ids, id],
    }))
  }

  async function handleInvite() {
    if (!form.email || !form.full_name || form.branch_ids.length === 0) {
      setFormError('Completá todos los campos y seleccioná al menos una sucursal.')
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/invite-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error creando admin')
      setCredentials(data.credentials)
      setShowForm(false)
      setForm({ email: '', full_name: '', branch_ids: [] })
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function openEdit(admin: AdminUser) {
    setEditError(null)
    setEditingAdmin(admin)
    setEditForm({
      full_name: admin.full_name,
      email: '',
      branch_ids: admin.branches.map((b) => b.id),
    })
    // Cargar email desde auth
    try {
      const res = await fetch(`/api/get-barber-email?profileId=${admin.id}`)
      const data = await res.json()
      setEditEmail(data.email ?? '')
      setEditForm((f) => ({ ...f, email: data.email ?? '' }))
    } catch {
      setEditEmail('')
    }
  }

  function toggleEditBranch(id: string) {
    setEditForm((f) => ({
      ...f,
      branch_ids: f.branch_ids.includes(id)
        ? f.branch_ids.filter((b) => b !== id)
        : [...f.branch_ids, id],
    }))
  }

  async function handleSaveEdit() {
    if (!editingAdmin) return
    if (!editForm.full_name.trim()) { setEditError('El nombre es obligatorio'); return }
    if (editForm.branch_ids.length === 0) { setEditError('Seleccioná al menos una sucursal'); return }
    setEditSaving(true)
    setEditError(null)
    try {
      const body: Record<string, unknown> = {
        profileId: editingAdmin.id,
        full_name: editForm.full_name.trim(),
        branch_ids: editForm.branch_ids,
      }
      // Solo enviar email si cambió
      if (editForm.email && editForm.email !== editEmail) {
        body.email = editForm.email
      }
      const res = await fetch('/api/admin-users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar')
      setEditingAdmin(null)
      await load()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleResetPassword(adminId: string, adminName: string) {
    if (!confirm(`¿Generar nueva contraseña para "${adminName}"?\n\nLa contraseña anterior dejará de funcionar.`)) return
    setResetError(null)
    setResettingId(adminId)
    try {
      const res = await fetch('/api/reset-admin-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: adminId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error generando contraseña')
      setCredentials(data.credentials)
    } catch (e) {
      setResetError(e instanceof Error ? e.message : 'Error')
    } finally {
      setResettingId(null)
    }
  }

  if (loading) return (
    <div className="admin-app flex-center">
      <div className="admin-loader" />
    </div>
  )

  if (error) return (
    <div className="admin-app flex-center">
      <div className="error-box">
        <p className="error-msg">{error}</p>
        <button onClick={() => { setError(null); load() }} className="admin-btn admin-btn--primary">Reintentar</button>
      </div>
    </div>
  )

  return (
    <div className="admin-app">
      <div className="admin-header-wrapper">
        <div className="admin-brand-bar">
          <span className="admin-logo">VALHALLA</span>
          <span className="admin-badge">Admin</span>
          <span className="admin-brand-separator">·</span>
          <span className="admin-brand-branch">Gestión de administradores</span>
        </div>
        <header className="admin-topbar">
          <div className="admin-topbar-left"></div>
          <div className="admin-topbar-right">
            <button onClick={() => { setShowForm(true); setFormError(null) }} className="admin-btn admin-btn--primary">
              + Nuevo administrador
            </button>
          </div>
        </header>
      </div>

      <main className="admin-content">
        <div className="admin-table-wrap">
          <div className="table-toolbar">
            <span className="toolbar-total">
              {admins.length} administrador{admins.length !== 1 ? 'es' : ''}
            </span>
          </div>
          {resetError && (
            <div style={{ background: '#7f1d1d33', border: '1px solid #b91c1c', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', marginBottom: '0.75rem', fontSize: '0.85rem', color: '#fecaca' }}>
              {resetError}
            </div>
          )}
          {admins.length === 0 ? (
            <div className="empty-state"><p>No hay administradores registrados.</p></div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>Nombre</th>
                  <th>Sucursales asignadas</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="barber-cell" style={{ justifyContent: 'flex-start' }}>
                        <div className="barber-avatar">
                          {a.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                        </div>
                        <p className="barber-name">{a.full_name}</p>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                        {a.branches.length === 0 ? (
                          <span className="td-na">Sin sucursales</span>
                        ) : a.branches.map((b) => (
                          <span key={b.id} className="badge badge--gray">{b.name}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${a.is_active ? 'badge--green' : 'badge--red'}`}>
                        {a.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => openEdit(a)}
                          className="admin-btn admin-btn--ghost"
                          style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => handleResetPassword(a.id, a.full_name)}
                          disabled={resettingId === a.id || a.id === currentUserId}
                          className="admin-btn admin-btn--ghost"
                          style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
                          title={a.id === currentUserId ? 'No podés resetear tu propia contraseña desde aquí' : 'Generar nueva contraseña'}
                        >
                          {resettingId === a.id ? 'Generando...' : '🔑 Credenciales'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {/* Modal: Nuevo admin */}
      {showForm && (
        <div className="modal-overlay">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nuevo administrador</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="modal-body">
              {formError && <p className="form-error">{formError}</p>}
              <label className="form-label">Nombre completo *</label>
              <input
                className="form-input"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Ej: Juan García"
              />
              <label className="form-label">Email *</label>
              <input
                type="email"
                className="form-input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="admin@valhalla.com"
              />
              <p style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                Puede ser un email ficticio, pero debe tener formato válido (ej: barbara@valhalla.com).
              </p>
              <label className="form-label">Sucursales *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {branches.map((b) => (
                  <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#e4e4e7' }}>
                    <input
                      type="checkbox"
                      checked={form.branch_ids.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                      style={{ width: '1rem', height: '1rem', accentColor: '#a78bfa' }}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
              <p style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '0.5rem' }}>
                Se generará una contraseña temporal que podrás compartir con el administrador.
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="admin-btn admin-btn--ghost">Cancelar</button>
              <button onClick={handleInvite} disabled={saving} className="admin-btn admin-btn--primary">
                {saving ? 'Creando...' : 'Crear administrador'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar admin */}
      {editingAdmin && (
        <div className="modal-overlay">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Editar administrador</h3>
              <button className="modal-close" onClick={() => setEditingAdmin(null)}>✕</button>
            </div>
            <div className="modal-body">
              {editError && <p className="form-error">{editError}</p>}
              <label className="form-label">Nombre completo *</label>
              <input
                className="form-input"
                value={editForm.full_name}
                onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                placeholder="Nombre completo"
              />
              <label className="form-label" style={{ marginTop: '0.75rem' }}>Email</label>
              <input
                type="email"
                className="form-input"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                placeholder="email@ejemplo.com"
              />
              {editForm.email && editForm.email !== editEmail && (
                <p style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '0.25rem' }}>
                  ⚠️ El email se actualizará al guardar
                </p>
              )}
              <label className="form-label" style={{ marginTop: '0.75rem' }}>Sucursales *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {branches.map((b) => (
                  <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#e4e4e7' }}>
                    <input
                      type="checkbox"
                      checked={editForm.branch_ids.includes(b.id)}
                      onChange={() => toggleEditBranch(b.id)}
                      style={{ width: '1rem', height: '1rem', accentColor: '#a78bfa' }}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setEditingAdmin(null)} className="admin-btn admin-btn--ghost">Cancelar</button>
              <button onClick={handleSaveEdit} disabled={editSaving} className="admin-btn admin-btn--primary">
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Credenciales generadas */}
      {credentials && (
        <div className="modal-overlay" onClick={() => setCredentials(null)}>
          <div className="modal-box" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Administrador creado</h3>
              <button className="modal-close" onClick={() => setCredentials(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '1rem' }}>
                Compartí estas credenciales con el administrador. La contraseña es temporal y puede cambiarse después.
              </p>
              <div style={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: '0.5rem', padding: '1rem', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                <div style={{ marginBottom: '0.5rem' }}>
                  <span style={{ color: '#71717a' }}>Email: </span>
                  <strong style={{ color: '#e4e4e7' }}>{credentials.email}</strong>
                </div>
                <div>
                  <span style={{ color: '#71717a' }}>Contraseña: </span>
                  <strong style={{ color: '#a78bfa' }}>{credentials.password}</strong>
                </div>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.75rem' }}>
                Copiá esta contraseña ahora — no se mostrará de nuevo.
              </p>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`Email: ${credentials.email}\nContraseña: ${credentials.password}`)
                }}
                className="admin-btn admin-btn--ghost"
              >
                Copiar
              </button>
              <button onClick={() => setCredentials(null)} className="admin-btn admin-btn--primary">
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-watermark" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" className="admin-watermark__icon">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 8.5h3.5M5 6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className="admin-watermark__text">Flowi Management</span>
      </div>
    </div>
  )
}
