// ============================================================
// Acceso al turnero durante la etapa de prueba en produccion.
//
// Hasta que se abra al publico, SOLO los usuarios cuyo id este en
// NEXT_PUBLIC_TURNERO_USER_IDS (lista separada por comas) ven y usan el turnero:
// el desarrollador, no los admins ni los barberos del cliente. Sin la variable
// no entra nadie (cerrado por defecto).
//
// El id de un usuario no es un secreto (no da acceso a nada). Esto es SOLO la
// puerta de la interfaz y de las rutas /api: la proteccion de los datos esta en
// la base (RLS y funciones con chequeo de sucursal, migraciones 065 y 066-094).
//
// Para abrirlo a todos mas adelante: NEXT_PUBLIC_TURNERO_PUBLIC_OPEN=true
// (reserva publica y rutas publicas) y quitar el chequeo de usuario en el menu.
// ============================================================

const ids = (process.env.NEXT_PUBLIC_TURNERO_USER_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const TURNERO_USER_IDS: ReadonlySet<string> = new Set(ids)

/** true = la reserva publica y sus rutas /api estan abiertas a cualquiera. */
export const TURNERO_PUBLIC_OPEN = process.env.NEXT_PUBLIC_TURNERO_PUBLIC_OPEN === 'true'

/** ¿Este usuario puede ver el turnero (menu, pantallas de admin)? */
export function canUseTurnero(userId?: string | null): boolean {
  return !!userId && TURNERO_USER_IDS.has(userId)
}