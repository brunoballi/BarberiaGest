'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Provider de React Query para toda la app.
 * staleTime por defecto de 60s: evita refetchs en cada montaje/navegación.
 * Los hooks de catálogos (servicios, beneficios, sucursales, barberos, meses)
 * usan staleTime más largo porque cambian poco.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000, // 1 min
            gcTime: 10 * 60_000, // 10 min en cache tras quedar sin uso
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
