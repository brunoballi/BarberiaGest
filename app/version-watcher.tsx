'use client'

import { useEffect, useState } from 'react'

/**
 * Detecta cuando hay una versión nueva desplegada (deploy en master) y ofrece
 * recargar. Compara el buildId horneado en este bundle contra el que devuelve
 * /api/version (el del deploy que sirve ahora). Chequea cada 60s y al re-enfocar
 * la pestaña. Muestra un cartel (no recarga solo, para no perder ediciones en curso).
 */
export default function VersionWatcher() {
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    const current = process.env.NEXT_PUBLIC_BUILD_ID
    if (!current) return
    let active = true

    const check = async () => {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const { buildId } = await r.json()
        if (active && buildId && buildId !== current) setUpdateReady(true)
      } catch {
        /* sin red: reintenta en el próximo tick */
      }
    }

    const interval = setInterval(check, 60_000)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    check()

    return () => {
      active = false
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  if (!updateReady) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: '#2e006c',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        fontSize: '0.9rem',
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <span>Hay una versión nueva disponible.</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: '#a78bfa',
          color: '#2e006c',
          border: 'none',
          borderRadius: '8px',
          padding: '6px 12px',
          fontWeight: 700,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Actualizar
      </button>
    </div>
  )
}
