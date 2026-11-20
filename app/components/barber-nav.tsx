'use client'

// ============================================================
// Menú lateral del barbero: el mismo que el del admin (components/admin-nav-rail).
//
//  - Columna fija a la izquierda, SOLO íconos, en celular y en computadora; ☰ la despliega con
//    los nombres (encima del contenido, sin moverlo) y ✕ la vuelve a dejar en íconos.
//
// Las secciones del barbero no son páginas sino vistas dentro de /barber: el menú pide la
// vista con un evento (lib/barber-nav-store) y barber-mobile-view la abre.
// ============================================================

import { useEffect, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/supabase.client'
import {
  getBarberNavServerState,
  getBarberNavState,
  goBarberNav,
  subscribeBarberNav,
  type BarberNavState,
  type BarberNavTarget,
} from '@/lib/barber-nav-store'
import './side-nav.css'

interface Item { target: BarberNavTarget; icon: string; label: string; active: boolean }

function barberNavItems(s: BarberNavState): Item[] {
  const items: Item[] = [
    { target: 'home', icon: '🏠', label: 'Inicio', active: s.view === 'home' },
    { target: 'register', icon: '✂️', label: 'Registrar corte', active: s.view === 'register' || s.view === 'success' },
    { target: 'settlements', icon: '💰', label: 'Mis liquidaciones', active: s.view === 'settlements' },
    { target: 'maintenance', icon: '🧹', label: 'Mantenimiento', active: s.view === 'maintenance' },
  ]
  if (s.turnero) items.push({ target: 'agenda', icon: '📆', label: 'Turnos', active: s.view === 'agenda' })
  if (s.advances) items.push({ target: 'advance', icon: '📤', label: 'Pedir adelanto', active: false })
  return items
}

async function logout() {
  await supabase.auth.signOut()
  window.location.href = '/login'
}

export function BarberNav({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const s = useSyncExternalStore(subscribeBarberNav, getBarberNavState, getBarberNavServerState)
  const items = barberNavItems(s)
  const firstName = s.name.split(' ')[0]

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const close = () => onOpenChange(false)
  const go = (target: BarberNavTarget) => { close(); goBarberNav(target) }

  return (
    <>
      {open && <div className="admin-rail__scrim" onClick={close} aria-hidden="true" />}

      {/* Columna lateral de íconos (celular y computadora); desplegada, panel con nombres */}
      <nav className={`admin-rail${open ? ' admin-rail--open' : ''}`} aria-label="Menú del barbero">
        <div className="admin-rail__head">
          <button
            type="button"
            className="admin-rail__item admin-rail__toggle"
            onClick={() => onOpenChange(!open)}
            aria-expanded={open}
            aria-label={open ? 'Ocultar menú' : 'Desplegar menú'}
            title={open ? 'Ocultar menú' : 'Desplegar menú'}
          >
            <span className="admin-rail__icon" aria-hidden="true">{open ? '✕' : '☰'}</span>
          </button>
          <div className="admin-rail__who">
            <strong>Hola, {firstName || 'Barbero'}</strong>
            <span>Barbero</span>
          </div>
        </div>

        <div className="admin-rail__body">
          <div className="admin-rail__group">
            {items.map((it) => (
              <button
                key={it.target}
                type="button"
                className={`admin-rail__item${it.active ? ' is-active' : ''}`}
                onClick={() => go(it.target)}
                title={it.label}
                aria-label={it.label}
                aria-current={it.active ? 'page' : undefined}
              >
                <span className="admin-rail__icon" aria-hidden="true">{it.icon}</span>
                <span className="admin-rail__label">{it.label}</span>
              </button>
            ))}
          </div>
          {s.isAdmin && (
            <div className="admin-rail__group">
              <Link
                href="/admin"
                className="admin-rail__item admin-rail__item--accent"
                title="Panel de administración"
                aria-label="Panel de administración"
                onClick={close}
              >
                <span className="admin-rail__icon" aria-hidden="true">🛠️</span>
                <span className="admin-rail__label">Panel de administración</span>
              </Link>
            </div>
          )}
        </div>

        <div className="admin-rail__foot">
          <button
            type="button"
            className="admin-rail__item admin-rail__item--logout"
            onClick={logout}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <span className="admin-rail__icon" aria-hidden="true">🔴</span>
            <span className="admin-rail__label">Cerrar sesión</span>
          </button>
        </div>
      </nav>
    </>
  )
}
