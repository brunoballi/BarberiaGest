// ============================================================
// Secciones del menú del admin. UNA sola lista para el cajón de la pantalla
// inicial (admin-side-drawer) y para la barra de íconos que acompaña a todas
// las pantallas (admin-nav-rail), así un cambio de menú se hace en un solo lugar.
//
// La entrada de "Turnero" y "Reseñas Flowi" solo se muestra a quien corresponde
// (lib/turnero-access.ts); la protección real está en las páginas y rutas /api.
// ============================================================

export interface AdminNavItem {
  href: string
  icon: string
  label: string
}

export interface AdminNavGroup {
  /** Identificador estable del grupo (para keys y para decidir si hace falta permiso). */
  id: 'principal' | 'turnero' | 'configuracion'
  /** Título de la sección en el menú expandido; vacío = sin título. */
  title: string
  items: AdminNavItem[]
}

/** Secciones de uso diario. */
export const ADMIN_NAV_PRINCIPAL: AdminNavItem[] = [
  { href: '/admin/gastos', icon: '💸', label: 'Gastos' },
  { href: '/admin/saldo-inicial', icon: '💵', label: 'Saldo inicial' },
  { href: '/admin/retiros-socios', icon: '🏦', label: 'Retiros socios' },
  { href: '/admin/reportes', icon: '📊', label: 'Reportes' },
]

/** Turnero en prueba: solo para el usuario desarrollador (canUseTurnero). */
export const ADMIN_NAV_TURNERO: AdminNavItem[] = [
  { href: '/admin/turnos', icon: '📆', label: 'Turnos' },
  { href: '/admin/bloqueos', icon: '🔒', label: 'Bloqueos' },
  { href: '/admin/clientes', icon: '🧑‍🤝‍🧑', label: 'Clientes' },
  { href: '/admin/marca', icon: '🎨', label: 'Marca y WhatsApp' },
]

/** Submenú de Configuración. */
export const ADMIN_NAV_CONFIGURACION: AdminNavItem[] = [
  { href: '/admin/configuracion', icon: '📅', label: 'Calendario' },
  { href: '/admin/barberos', icon: '👥', label: 'Barberos' },
  { href: '/admin/servicios', icon: '🎯', label: 'Servicios' },
  { href: '/admin/beneficios', icon: '🎁', label: 'Beneficios' },
  { href: '/admin/mantenimiento', icon: '🧹', label: 'Mantenimiento' },
  { href: '/admin/auditoria', icon: '🔍', label: 'Auditoría' },
  { href: '/admin/admins', icon: '🔐', label: 'Administradores' },
]

/** Solo para el usuario desarrollador (isDeveloper). Va al final de Configuración. */
export const ADMIN_NAV_RESENAS: AdminNavItem = { href: '/admin/resenas', icon: '⭐', label: 'Reseñas Flowi' }

/** Panel inicial: primera entrada de la barra de íconos. */
export const ADMIN_NAV_HOME: AdminNavItem = { href: '/admin', icon: '🏠', label: 'Panel' }

/** Grupos que ve cada usuario, en el orden en que se muestran. */
export function adminNavGroups(opts: { showTurnero: boolean; showDev: boolean }): AdminNavGroup[] {
  const groups: AdminNavGroup[] = [{ id: 'principal', title: '', items: ADMIN_NAV_PRINCIPAL }]
  if (opts.showTurnero) groups.push({ id: 'turnero', title: 'Turnero', items: ADMIN_NAV_TURNERO })
  groups.push({
    id: 'configuracion',
    title: 'Configuración',
    items: opts.showDev ? [...ADMIN_NAV_CONFIGURACION, ADMIN_NAV_RESENAS] : ADMIN_NAV_CONFIGURACION,
  })
  return groups
}

/** ¿La ruta actual pertenece a esta sección? El panel inicial solo coincide exacto. */
export function isAdminNavActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}
