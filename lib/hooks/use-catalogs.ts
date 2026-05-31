'use client'

import { useQuery } from '@tanstack/react-query'
import { getQueryClient } from '@/app/providers'
import {
  getServicesByBranch,
  getActiveBenefitsByBranch,
  getBarbersByBranch,
  getMonthsWithWeeks,
  getMyBranches,
} from '@/lib/supabase/supabase.client'

// Helper imperativo: devuelve las sucursales del usuario desde el cache de
// React Query (fetch solo si están stale). Sirve para los flujos de carga
// imperativos del admin (que validan sucursal y redirigen) sin refactor.
export function getMyBranchesCached() {
  return getQueryClient().ensureQueryData({
    queryKey: ['my-branches'],
    queryFn: getMyBranches,
    staleTime: 10 * 60_000,
  })
}

// Invalidar tras crear/editar/borrar sucursales.
export function invalidateBranches() {
  return getQueryClient().invalidateQueries({ queryKey: ['my-branches'] })
}

// Catálogos: cambian poco → staleTime largo (10 min). Se comparten por
// branchId entre componentes/rutas, así no se re-consultan al navegar.
const CATALOG_STALE = 10 * 60_000

export function useServices(branchId: string | undefined) {
  return useQuery({
    queryKey: ['services', branchId],
    queryFn: () => getServicesByBranch(branchId!),
    enabled: !!branchId,
    staleTime: CATALOG_STALE,
  })
}

export function useActiveBenefits(branchId: string | undefined) {
  return useQuery({
    queryKey: ['benefits', 'active', branchId],
    queryFn: () => getActiveBenefitsByBranch(branchId!),
    enabled: !!branchId,
    staleTime: CATALOG_STALE,
  })
}

export function useBarbers(branchId: string | undefined) {
  return useQuery({
    queryKey: ['barbers', branchId],
    queryFn: () => getBarbersByBranch(branchId!),
    enabled: !!branchId,
    staleTime: CATALOG_STALE,
  })
}

export function useMyBranches() {
  return useQuery({
    queryKey: ['my-branches'],
    queryFn: () => getMyBranches(),
    staleTime: CATALOG_STALE,
  })
}

// Meses/semanas: cambian más seguido (cierre de semanas) → staleTime medio (2 min).
export function useMonthsWithWeeks(branchId: string | undefined) {
  return useQuery({
    queryKey: ['months', branchId],
    queryFn: () => getMonthsWithWeeks(branchId!),
    enabled: !!branchId,
    staleTime: 2 * 60_000,
  })
}
