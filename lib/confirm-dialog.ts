// Reemplazo minimo del confirmDialog/alertDialog/errorDialog de Flowi.estudio.
// Flowi tiene un modal propio montado en el layout; en Valhalla no se toca el layout del admin
// durante la prueba del turnero, asi que se usan los dialogos nativos del navegador. Mismas firmas,
// asi que se puede cambiar por el modal despues sin tocar las pantallas.

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

const text = (o: ConfirmOptions | string) =>
  typeof o === 'string' ? o : o.title ? `${o.title}\n\n${o.message}` : o.message

export async function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  if (typeof window === 'undefined') return false
  return window.confirm(text(opts))
}

export async function alertDialog(opts: ConfirmOptions | string): Promise<void> {
  if (typeof window !== 'undefined') window.alert(text(opts))
}

export async function errorDialog(opts: ConfirmOptions | string): Promise<void> {
  if (typeof window !== 'undefined') window.alert(text(opts))
}