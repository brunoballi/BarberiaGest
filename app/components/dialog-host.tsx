'use client'

import { useEffect, useRef, useState } from 'react'
import { settleDialog, subscribeDialogs, type DialogRequest } from '@/lib/confirm-dialog'

// Dibuja el dialogo del sistema que corresponda (de a uno, en orden de llegada).
export default function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([])
  useEffect(() => subscribeDialogs(setQueue), [])
  const current = queue[0]
  if (!current) return null
  return <DialogView key={current.id} req={current} />
}

function DialogView({ req }: { req: DialogRequest }) {
  const [typed, setTyped] = useState('')
  const okRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { opts } = req
  const danger = !!opts.danger || req.kind === 'typed'
  const canConfirm = req.kind !== 'typed' || typed.trim() === req.opts.phrase

  function close(ok: boolean) {
    if (req.kind === 'alert') req.resolve()
    else req.resolve(ok)
    settleDialog(req.id)
  }

  useEffect(() => {
    ;(req.kind === 'typed' ? inputRef.current : okRef.current)?.focus()
  }, [req.kind])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const confirmLabel = opts.confirmLabel ?? (req.kind === 'alert' ? 'Entendido' : danger ? 'Confirmar' : 'Aceptar')

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false)
      }}
    >
      <div
        role={req.kind === 'alert' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={opts.title ?? 'Aviso'}
        className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md p-6 space-y-4 animate-fadein shadow-2xl"
      >
        {opts.title && (
          <h2 className={`text-lg font-semibold ${danger ? 'text-red-400' : 'text-white'}`}>{opts.title}</h2>
        )}
        <p className="text-sm text-zinc-300 whitespace-pre-line break-words">{opts.message}</p>

        {req.kind === 'typed' && (
          <div className="space-y-1.5">
            <label className="block text-xs text-zinc-400">
              Escribí <span className="font-mono font-bold text-red-400">{req.opts.phrase}</span> para confirmar
            </label>
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canConfirm) close(true)
              }}
              autoComplete="off"
              className="w-full rounded-lg bg-zinc-800 border border-zinc-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          {req.kind !== 'alert' && (
            <button
              type="button"
              onClick={() => close(false)}
              className="px-4 py-2 rounded-lg text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >
              {opts.cancelLabel ?? 'Cancelar'}
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            disabled={!canConfirm}
            onClick={() => close(true)}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
