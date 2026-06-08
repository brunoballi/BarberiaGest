'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'

interface AdminSideDrawerProps {
  isOpen: boolean
  onClose: () => void
  onLogout: () => void
  onRegisterCut: () => void
  adminName?: string
}

export function AdminSideDrawer({
  isOpen,
  onClose,
  onLogout,
  onRegisterCut,
  adminName = 'Admin',
}: AdminSideDrawerProps) {
  const [showConfigSubmenu, setShowConfigSubmenu] = useState(false)

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
        {/* Header con nombre del admin */}
        <div className="border-b border-zinc-800 p-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-white font-bold text-base mb-1 truncate">Hola, {adminName}</h3>
            <p className="text-xs text-zinc-500">Administrador</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors text-lg leading-none"
            aria-label="Cerrar menú"
          >
            ✕
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

          <Link
            href="/admin/reportes"
            onClick={onClose}
            className="drawer-item flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-zinc-800 transition-colors text-white"
          >
            <span className="text-xl">📊</span>
            <span className="font-medium">Reportes</span>
          </Link>

          {/* Configuración con submenu */}
          <div>
            <button
              onClick={() => setShowConfigSubmenu(!showConfigSubmenu)}
              className="drawer-item flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-zinc-800 transition-colors text-white w-full"
            >
              <span className="text-xl">⚙️</span>
              <span className="font-medium flex-1 text-left">Configuración</span>
              <span className={`text-xs transition-transform ${showConfigSubmenu ? 'rotate-180' : ''}`}>▾</span>
            </button>

            {/* Submenu de configuración */}
            {showConfigSubmenu && (
              <div className="space-y-1 mt-1 ml-4 border-l-2 border-zinc-700 pl-3">
                <Link
                  href="/admin/configuracion"
                  onClick={onClose}
                  className="drawer-submenu-item flex items-center gap-2 px-3 py-2 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors text-sm"
                >
                  📅 Calendario
                </Link>
                <Link
                  href="/admin/barberos"
                  onClick={onClose}
                  className="drawer-submenu-item flex items-center gap-2 px-3 py-2 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors text-sm"
                >
                  👥 Barberos
                </Link>
                <Link
                  href="/admin/servicios"
                  onClick={onClose}
                  className="drawer-submenu-item flex items-center gap-2 px-3 py-2 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors text-sm"
                >
                  🎯 Servicios
                </Link>
                <Link
                  href="/admin/beneficios"
                  onClick={onClose}
                  className="drawer-submenu-item flex items-center gap-2 px-3 py-2 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors text-sm"
                >
                  🎁 Beneficios
                </Link>
                <Link
                  href="/admin/auditoria"
                  onClick={onClose}
                  className="drawer-submenu-item flex items-center gap-2 px-3 py-2 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors text-sm"
                >
                  🔍 Auditoría
                </Link>
                <Link
                  href="/admin/admins"
                  onClick={onClose}
                  className="drawer-submenu-item flex items-center gap-2 px-3 py-2 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors text-sm"
                >
                  🔐 Administradores
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Footer - Cerrar sesión */}
        <div className="border-t border-zinc-800 p-5">
          <button
            onClick={() => {
              onLogout()
              onClose()
            }}
            className="drawer-logout-btn flex items-center gap-3 px-4 py-3 rounded-lg w-full transition-colors font-semibold"
          >
            <span className="text-xl">🔴</span>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </>
  )
}
