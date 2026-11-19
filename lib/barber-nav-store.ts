// ============================================================
// Puente entre la pantalla del barbero (barber-mobile-view) y su menú lateral
// (components/barber-nav), que vive en el layout de /barber.
//
// El barbero es UNA sola ruta con vistas internas (inicio, registrar, liquidaciones...),
// no páginas separadas como el admin. Entonces:
//  - la pantalla PUBLICA acá qué vista está abierta y qué secciones tiene habilitadas
//    (setBarberNavState), y el menú lo lee para resaltar y mostrar lo que corresponde;
//  - el menú PIDE ir a una sección con un evento (BARBER_NAV_GO_EVENT) y la pantalla lo atiende.
// ============================================================

export type BarberNavTarget = 'home' | 'register' | 'settlements' | 'maintenance' | 'agenda' | 'advance'

export const BARBER_NAV_GO_EVENT = 'barber-nav:go'

export interface BarberNavState {
  /** Vista abierta en la pantalla del barbero (para resaltar la sección actual). */
  view: string
  name: string
  /** Turnero en prueba: muestra "Turnos". */
  turnero: boolean
  /** "Pedir adelanto" habilitado para este barbero. */
  advances: boolean
  /** Admin que también atiende: ofrece volver al panel de administración. */
  isAdmin: boolean
}

const INITIAL: BarberNavState = { view: 'home', name: '', turnero: false, advances: false, isAdmin: false }

let state: BarberNavState = INITIAL
const listeners = new Set<() => void>()

export function getBarberNavState(): BarberNavState {
  return state
}

export function getBarberNavServerState(): BarberNavState {
  return INITIAL
}

export function subscribeBarberNav(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Actualiza el estado; avisa al menú solo si algo cambió. */
export function setBarberNavState(patch: Partial<BarberNavState>): void {
  const next = { ...state, ...patch }
  const changed = (Object.keys(next) as (keyof BarberNavState)[]).some((k) => next[k] !== state[k])
  if (!changed) return
  state = next
  listeners.forEach((l) => l())
}

export function resetBarberNavState(): void {
  setBarberNavState(INITIAL)
}

export function goBarberNav(target: BarberNavTarget): void {
  window.dispatchEvent(new CustomEvent(BARBER_NAV_GO_EVENT, { detail: { target } }))
}
