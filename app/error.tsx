'use client'

import { useEffect } from 'react'

// Si una pantalla falla, en vez de dejar la página muerta se ofrece reintentar
// o recargar. Cubre /admin y /barber (todo lo que cuelga del layout raíz).
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '24px',
        textAlign: 'center',
        background: '#0b0b0d',
        color: '#e4e4e7',
      }}
    >
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Algo salió mal</h2>
      <p style={{ fontSize: '0.9rem', color: '#a1a1aa', maxWidth: '20rem' }}>
        No pudimos mostrar esta pantalla. Probá de nuevo; si sigue igual, recargá la página.
      </p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={() => unstable_retry()}
          style={{ background: '#f59e0b', color: '#18181b', fontWeight: 700, border: 'none', borderRadius: '10px', padding: '10px 18px' }}
        >
          Reintentar
        </button>
        <button
          onClick={() => window.location.reload()}
          style={{ background: 'transparent', color: '#e4e4e7', fontWeight: 600, border: '1px solid #52525b', borderRadius: '10px', padding: '10px 18px' }}
        >
          Recargar
        </button>
      </div>
    </div>
  )
}
