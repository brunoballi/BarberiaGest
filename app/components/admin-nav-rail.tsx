'use client'

// ============================================================
// Menú del admin que acompaña a TODAS las pantallas de /admin.
//
//  - Computadora (≥1024px): columna fija a la izquierda, SOLO íconos. Un botón la
//    expande (por encima del contenido, sin moverlo) y muestra los nombres.
//  - Celular (<1024px): franja de íconos con scroll horizontal dentro de la barra
//    "Volver al panel", para no quitarle ancho a las pantallas.
//
// Las secciones salen de lib/admin-nav.ts, la misma lista que usa el cajón de la
// pantalla inicial. "Registrar corte" y "Cerrar sesión" siguen solo en ese cajón:
// dependen del estado del panel inicial.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase/supabase.client'
import { canUseTurnero, isDeveloper } from '@/lib/turnero-access'
import {
  ADMIN_NAV_HOME,
  adminNavGroups,
  isAdminNavActive,
  type AdminNavGroup,
  type AdminNavItem,
} from '@/lib/admin-nav'

/** Grupos de menú que le corresponden al usuario (Turnero y Reseñas son solo del desarrollador). */
function useAdminNavGroups(): AdminNavGroup[] {
  const [access, setAccess] = useState({ showTurnero: false, showDev: false })
  useEffect(() => {
    let activo = true
    supabase.auth.getUser().then(({ data }) => {
      if (!activo) return
      setAccess({ showTurnero: canUseTurnero(data.user?.id), showDev: isDeveloper(data.user?.id) })
    })
    return () => { activo = false }
  }, [])
  return adminNavGroups(access)
}

function NavLink({
  item, active, className, onNavigate,
}: { item: AdminNavItem; active: boolean; className: string; onNavigate?: () => void }) {
  return (
    <Link
      href={item.href}
      className={`${className}${active ? ' is-active' : ''}`}
      title={item.label}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
    >
      <span className="admin-rail__icon" aria-hidden="true">{item.icon}</span>
      <span className="admin-rail__label">{item.label}</span>
    </Link>
  )
}

/** Columna fija de la izquierda (solo computadora). */
export function AdminNavRail() {
  const pathname = usePathname()
  const groups = useAdminNavGroups()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const close = () => setExpanded(false)

  return (
    <>
      {expanded && <div className="admin-rail__scrim" onClick={close} aria-hidden="true" />}
      <nav className={`admin-rail${expanded ? ' admin-rail--open' : ''}`} aria-label="Menú de administración">
        <button
          type="button"
          className="admin-rail__item admin-rail__toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Contraer menú' : 'Expandir menú'}
          title={expanded ? 'Contraer menú' : 'Expandir menú'}
        >
          <span className="admin-rail__icon" aria-hidden="true">{expanded ? '✕' : '☰'}</span>
          <span className="admin-rail__label">Menú</span>
        </button>

        <div className="admin-rail__group">
          <NavLink
            item={ADMIN_NAV_HOME}
            active={isAdminNavActive(pathname, ADMIN_NAV_HOME.href)}
            className="admin-rail__item"
            onNavigate={close}
          />
        </div>

        {groups.map((g) => (
          <div key={g.id} className="admin-rail__group">
            {g.title && <p className="admin-rail__title">{g.title}</p>}
            {g.items.map((it) => (
              <NavLink
                key={it.href}
                item={it}
                active={isAdminNavActive(pathname, it.href)}
                className="admin-rail__item"
                onNavigate={close}
              />
            ))}
          </div>
        ))}
      </nav>
    </>
  )
}

/** Franja de íconos para celular, dentro de la barra "Volver al panel". */
export function AdminNavStrip() {
  const pathname = usePathname()
  const groups = useAdminNavGroups()
  const ref = useRef<HTMLElement>(null)

  // Deja a la vista el ícono de la pantalla actual (la franja scrollea de costado).
  useEffect(() => {
    ref.current?.querySelector('.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [pathname, groups.length])

  return (
    <nav ref={ref} className="admin-strip" aria-label="Secciones de administración">
      {groups.flatMap((g) => g.items).map((it) => (
        <NavLink
          key={it.href}
          item={it}
          active={isAdminNavActive(pathname, it.href)}
          className="admin-strip__item"
        />
      ))}
    </nav>
  )
}
