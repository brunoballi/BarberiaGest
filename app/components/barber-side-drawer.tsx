'use client'

import React, { useEffect } from 'react'

interface BarberSideDrawerProps {
  isOpen: boolean
  onClose: () => void
  onLogout: () => void
  onRegisterCut: () => void
  onViewLiquidations: () => void
  onRequestAdvance: () => void
  /** Igual que el botón principal: solo muestra "Pedir adelanto" si está habilitado. */
  advanceEnabled?: boolean
  barberName?: string
  /** Dual role: si el barbero también es admin, ofrecer volver al panel. */
  showAdminPanel?: boolean
  onGoToAdminPanel?: () => void
}

export function BarberSideDrawer({
  isOpen,
  onClose,
  onLogout,
  onRegisterCut,
  onViewLiquidations,
  onRequestAdvance,
  advanceEnabled = false,
  barberName = 'Barbero',
  showAdminPanel = false,
  onGoToAdminPanel,
}: BarberSideDrawerProps) {
  // Marca el body cuando el drawer está abierto, para que el FAB de ayuda
  // se desplace junto con el panel y no quede tapando "Cerrar sesión".
  useEffect(() => {
    if (isOpen) document.body.classList.add('drawer-open')
    else document.body.classList.remove('drawer-open')
    return () => document.body.classList.remove('drawer-open')
  }, [isOpen])

  return (
    <>
      {/* Overlay semitransparente */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={onClose}
        />
      )}

      {/* Drawer lateral */}
      <div
        className={`fixed right-0 top-0 h-full w-64 bg-zinc-900 z-50 flex flex-col shadow-2xl transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="border-b border-zinc-800 p-5 flex items-center justify-between">
          <h2 className="text-white font-bold">Menú</h2>
          <button onClick={onClose} className="icon-btn" aria-label="Cerrar menú">
            <span className="text-lg leading-none">✕</span>
          </button>
        </div>

        {/* Contenido - Opciones principales */}
        <div className="flex-1 flex flex-col p-5 space-y-1 overflow-y-auto">
          <button
            onClick={() => {
              onRegisterCut()
              onClose()
            }}
            className="drawer-item flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-zinc-800 transition-colors text-white"
          >
            <span className="text-xl">✂️</span>
            <span className="font-medium">Registrar corte</span>
          </button>

          <button
            onClick={() => {
              onViewLiquidations()
              onClose()
            }}
            className="drawer-item flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-zinc-800 transition-colors text-white"
          >
            <span className="text-xl">💰</span>
            <span className="font-medium">Mis liquidaciones</span>
          </button>

          {advanceEnabled && (
            <button
              onClick={() => {
                onRequestAdvance()
                onClose()
              }}
              className="drawer-item flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-zinc-800 transition-colors text-white"
            >
              <span className="text-xl">📤</span>
              <span className="font-medium">Pedir adelanto</span>
            </button>
          )}

          {showAdminPanel && onGoToAdminPanel && (
            <button
              onClick={() => { onGoToAdminPanel(); onClose() }}
              className="drawer-item flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-zinc-800 transition-colors text-amber-400 mt-2 border-t border-zinc-800 pt-4"
            >
              <span className="text-xl">🛠️</span>
              <span className="font-medium">Panel de administración</span>
            </button>
          )}
        </div>

        {/* Footer - Cerrar sesión */}
        <div className="border-t border-zinc-800 p-5">
          <button
            onClick={() => {
              onLogout()
              onClose()
            }}
            className="drawer-item-logout flex items-center gap-3 px-4 py-3 rounded-lg w-full hover:bg-red-900/20 transition-colors text-red-400 font-medium"
          >
            <span className="text-xl">🚪</span>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </>
  )
}
