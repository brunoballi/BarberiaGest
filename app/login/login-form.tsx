'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getCurrentProfile } from '@/lib/supabase/supabase.client'
import { clearStoredBranch } from '@/lib/hooks/usePersistedBranch'
import './login.css'

interface LoginFormProps {
  redirectTo?: string
  authError?: string
}

export default function LoginForm({ redirectTo, authError }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    authError === 'auth' ? 'El enlace de acceso expiró o es inválido.' : null
  )
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) {
      setError('Completá email y contraseña.')
      return
    }

    setError(null)
    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (authError) {
        setError('Credenciales incorrectas. Verificá tu email y contraseña.')
        return
      }

      const profile = await getCurrentProfile()

      if (!profile) {
        setError(
          'Tu cuenta no está configurada en el sistema. Contactá al administrador.'
        )
        await supabase.auth.signOut()
        return
      }

      // Limpiar sucursal previa para forzar al admin a elegir
      if (profile.role === 'admin') clearStoredBranch()

      const destination =
        redirectTo && redirectTo.startsWith('/')
          ? redirectTo
          : profile.role === 'admin'
            ? '/admin/select-branch'
            : '/barber'

      router.push(destination)
      router.refresh()
    } catch {
      setError('Error inesperado. Intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-flowi-badge">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="login-flowi-icon">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5 8.5h3.5M5 6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Flowi Management
          </div>
          <p className="login-logo-text">VALHALLA</p>
          <p className="login-logo-sub">Sistema de gestión</p>
        </div>

        {/* Card */}
        <div className="login-card">
          <p className="login-title">Acceder</p>

          {error && <div className="login-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="login-field">
              <label htmlFor="email" className="login-label">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                className="login-input"
                placeholder="nombre@valhalla.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="login-field">
              <label htmlFor="password" className="login-label">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="login-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="login-btn"
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
