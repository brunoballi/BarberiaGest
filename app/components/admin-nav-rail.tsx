'use client'

// ============================================================
// EL menú del admin (reemplaza al cajón del panel inicial). Está en TODAS las
// pantallas de /admin.
//
//  - Columna fija a la izquierda, SOLO íconos, en celular y en computadora. El botón ☰ la
//    despliega mostrando los nombres (encima del contenido, sin moverlo); la ✕ la
//    vuelve a dejar en íconos.
//  - Configuración es UNA sola ruedita: en modo íconos despliega el menú con Configuración
//    abierta; en el panel desplegado es un acordeón. Así la lista no se hace larguísima.
//
// Las secciones salen de lib/admin-nav.ts. "Registrar corte" vive en el panel inicial
// (su modal depende de la semana elegida): acá solo avisa por un evento, o lleva al panel
// con ?registrar-corte=1 si se pide desde otra pantalla.
// ============================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase, getCurrentProfile } from '@/lib/supabase/supabase.client'
import { canUseTurnero, isDeveloper } from '@/lib/turnero-access'
import {
  ADMIN_NAV_HOME,
  adminNavGroups,
  isAdminNavActive,
  type AdminNavGroup,
  type AdminNavItem,
} from '@/lib/admin-nav'
import './side-nav.css'

/** Evento que se manda del menú al panel inicial. */
export const ADMIN_REGISTER_CUT_EVENT = 'admin:register-cut'

interface NavUser { name: string; isBarber: boolean; showTurnero: boolean; showDev: boolean }

/** Quién es el admin: el nombre del saludo, si también atiende, y qué grupos del menú le tocan. */
function useNavUser(): NavUser {
  const [user, setUser] = useState<NavUser>({ name: '', isBarber: false, showTurnero: false, showDev: false })
  useEffect(() => {
    let activo = true
    getCurrentProfile()
      .then((p) => {
        if (!activo || !p) return
        setUser({
          name: p.full_name ?? '',
          isBarber: p.is_barber ?? false,
          showTurnero: canUseTurnero(p.id),
          showDev: isDeveloper(p.id),
        })
      })
      .catch(() => { /* sin perfil el menú igual funciona, solo sin saludo ni turnero */ })
    return () => { activo = false }
  }, [])
  return user
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

function groupActive(group: AdminNavGroup, pathname: string): boolean {
  return group.items.some((it) => isAdminNavActive(pathname, it.href))
}

// ── Menú principal ───────────────────────────────────────────────────────

export function AdminNav({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useNavUser()
  const groups = adminNavGroups(user)
  const [configOpen, setConfigOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const close = () => onOpenChange(false)

  function registerCut() {
    close()
    if (pathname === '/admin') window.dispatchEvent(new Event(ADMIN_REGISTER_CUT_EVENT))
    else router.push('/admin?registrar-corte=1')
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const firstName = user.name.split(' ')[0]

  return (
    <>
      {open && <div className="admin-rail__scrim" onClick={close} aria-hidden="true" />}
      <nav className={`admin-rail${open ? ' admin-rail--open' : ''}`} aria-label="Menú de administración">
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
            <strong>Hola, {firstName || 'Admin'}</strong>
            <span>Administrador</span>
          </div>
        </div>

        <div className="admin-rail__body">
          <div className="admin-rail__group">
            <NavLink
              item={ADMIN_NAV_HOME}
              active={isAdminNavActive(pathname, ADMIN_NAV_HOME.href)}
              className="admin-rail__item"
              onNavigate={close}
            />
            <button
              type="button"
              className="admin-rail__item"
              onClick={registerCut}
              title="Registrar corte"
              aria-label="Registrar corte"
            >
              <span className="admin-rail__icon" aria-hidden="true">✂️</span>
              <span className="admin-rail__label">Registrar corte</span>
            </button>
            {user.isBarber && (
              <NavLink
                item={{ href: '/barber', icon: '💈', label: 'Mi vista de barbero' }}
                active={false}
                className="admin-rail__item admin-rail__item--accent"
                onNavigate={close}
              />
            )}
          </div>

          {groups.map((g) =>
            g.id === 'configuracion' ? (
              <div key={g.id} className="admin-rail__group">
                <button
                  type="button"
                  className={`admin-rail__item${groupActive(g, pathname) ? ' is-active' : ''}`}
                  onClick={() => {
                    // En modo íconos despliega el menú con Configuración abierta; ya desplegado, la pliega o abre.
                    if (!open) { setConfigOpen(true); onOpenChange(true) } else setConfigOpen((v) => !v)
                  }}
                  aria-expanded={open && configOpen}
                  aria-label="Configuración"
                  title="Configuración"
                >
                  <span className="admin-rail__icon" aria-hidden="true">⚙️</span>
                  <span className="admin-rail__label">Configuración</span>
                  <span className={`admin-rail__chev${configOpen ? ' is-up' : ''}`} aria-hidden="true">▾</span>
                </button>
                {open && configOpen && (
                  <div className="admin-rail__sub">
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
                )}
              </div>
            ) : (
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
            ),
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
