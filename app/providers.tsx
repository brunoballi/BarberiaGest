'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import VersionWatcher from './version-watcher'

/**
 * Singleton de QueryClient (solo browser). Lo comparten el provider y los
 * helpers imperativos (getMyBranchesCached) para que usen el MISMO cache.
 * Client-only por construcción: seguro para datos con scope de autenticación
 * (no se comparte entre usuarios/requests como pasaría con un memo server-side).
 */
let browserQueryClient: QueryClient | undefined

export function getQueryClient(): QueryClient {
  if (!browserQueryClient) {
    browserQueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000, // 1 min
          gcTime: 10 * 60_000,
          refetchOnWindowFocus: false,
          retry: 1,
        },
      },
    })
  }
  return browserQueryClient
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
      <VersionWatcher />
    </QueryClientProvider>
  )
}
