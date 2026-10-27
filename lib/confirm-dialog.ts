// Dialogos del sistema (confirmar / avisar / error / escribir para confirmar).
// Mismas firmas que los nativos del navegador pero devuelven promesas: el <DialogHost />
// montado en app/providers.tsx los dibuja dentro de la interfaz. Si el host todavia no esta
// montado (o se corre en el servidor) se cae a los dialogos nativos para no perder el aviso.

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface TypedConfirmOptions extends ConfirmOptions {
  /** Palabra que hay que escribir para habilitar el boton (ej. "BORRAR"). */
  phrase: string
}

export type DialogRequest =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: 'alert'; opts: ConfirmOptions; resolve: () => void }
  | { id: number; kind: 'typed'; opts: TypedConfirmOptions; resolve: (v: boolean) => void }

type Listener = (queue: DialogRequest[]) => void

let queue: DialogRequest[] = []
let nextId = 1
const listeners = new Set<Listener>()

export function subscribeDialogs(fn: Listener): () => void {
  listeners.add(fn)
  fn(queue)
  return () => {
    listeners.delete(fn)
  }
}

function emit() {
  for (const fn of listeners) fn(queue)
}

export function settleDialog(id: number) {
  queue = queue.filter((d) => d.id !== id)
  emit()
}

const norm = (o: ConfirmOptions | string): ConfirmOptions => (typeof o === 'string' ? { message: o } : o)
const nativeText = (o: ConfirmOptions) => (o.title ? `${o.title}\n\n${o.message}` : o.message)

function push<T extends DialogRequest>(req: Omit<T, 'id'>) {
  queue = [...queue, { ...req, id: nextId++ } as DialogRequest]
  emit()
}

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  const o = norm(opts)
  if (listeners.size === 0) return Promise.resolve(window.confirm(nativeText(o)))
  return new Promise((resolve) => push<Extract<DialogRequest, { kind: 'confirm' }>>({ kind: 'confirm', opts: o, resolve }))
}

export function alertDialog(opts: ConfirmOptions | string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const o = norm(opts)
  if (listeners.size === 0) {
    window.alert(nativeText(o))
    return Promise.resolve()
  }
  return new Promise((resolve) => push<Extract<DialogRequest, { kind: 'alert' }>>({ kind: 'alert', opts: o, resolve }))
}

export function errorDialog(opts: ConfirmOptions | string): Promise<void> {
  const o = norm(opts)
  return alertDialog({ title: 'Ocurrió un error', danger: true, ...o })
}

/** Accion destructiva: el boton se habilita recien al escribir la palabra exacta. */
export function typedConfirmDialog(opts: TypedConfirmOptions): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (listeners.size === 0) {
    const input = window.prompt(`${nativeText(opts)}\n\nEscribí ${opts.phrase} para confirmar:`)
    return Promise.resolve(input?.trim() === opts.phrase)
  }
  return new Promise((resolve) => push<Extract<DialogRequest, { kind: 'typed' }>>({ kind: 'typed', opts, resolve }))
}
