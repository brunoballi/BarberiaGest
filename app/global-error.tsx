'use client'

// Último recurso: si falla el layout raíz. Reemplaza al layout, por eso define
// su propio <html> y <body>.
export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <html lang="es" translate="no">
      <body
        style={{
          margin: 0,
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
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Algo salió mal</h2>
        <p style={{ fontSize: '0.9rem', color: '#a1a1aa', maxWidth: '20rem' }}>
          No pudimos cargar la aplicación. Probá de nuevo; si sigue igual, recargá la página.
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
      </body>
    </html>
  )
}
