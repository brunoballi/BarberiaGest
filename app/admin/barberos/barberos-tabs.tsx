'use client'

import { useState } from 'react'
import BarbersAbm from './barbers-abm'
import HorariosView from '../horarios/horarios-view'

type Tab = 'datos' | 'horarios'

/**
 * Módulo Barberos: el título, y debajo sus dos solapas: "Datos personales" (alta, comisiones,
 * foto) y "Horarios" (franjas semanales y días bloqueados de cada uno). Los horarios son del
 * turnero: sin turnero habilitado se muestra solo la primera, sin barra de solapas.
 */
export default function BarberosTabs({ turnero, initialTab }: { turnero: boolean; initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(turnero ? initialTab : 'datos')

  function elegir(t: Tab) {
    setTab(t)
    // Deja la solapa en la URL para poder compartir o recargar el mismo lugar.
    window.history.replaceState(null, '', t === 'horarios' ? '?tab=horarios' : window.location.pathname)
  }

  return (
    <div>
      <div className="w-full px-4 pt-8">
        <div className="flowi-page-header">
          <h1 className="text-2xl font-bold text-white">Barberos</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Invitá, editá comisiones y gestioná el equipo
          </p>
        </div>
      </div>

      {turnero && (
        <div className="px-4 pt-4">
          <div role="tablist" className="inline-flex rounded-lg border border-[var(--border-mid)] bg-[var(--bg2)] p-1 gap-1">
            {([['datos', 'Datos personales'], ['horarios', 'Horarios']] as const).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => elegir(k)}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                  tab === k ? 'bg-amber-500 text-zinc-950' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === 'datos' ? <BarbersAbm /> : <HorariosView />}
    </div>
  )
}
