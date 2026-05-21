'use client'

// ============================================================
// usePersistedBranch
// Hook compartido para todas las páginas admin.
// Lee/escribe la sucursal seleccionada en localStorage
// para que persista entre navegaciones y recargas.
// ============================================================

import { useState, useEffect, useCallback } from 'react'
import type { Branch } from '@/lib/supabase/database.types'

const STORAGE_KEY = 'valhalla_branch'

export function getStoredBranch(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(STORAGE_KEY)
}

export function storeBranch(branchId: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, branchId)
}

/** Alias semántico, mismo comportamiento que storeBranch */
export function setStoredBranch(branchId: string) {
  storeBranch(branchId)
}

/** Borra la sucursal almacenada (usar al hacer logout o forzar re-elección) */
export function clearStoredBranch() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Dado un array de sucursales disponibles, devuelve la última
 * sucursal usada (si sigue siendo válida) o la primera de la lista.
 */
export function resolveInitialBranch(branches: Branch[]): string {
  if (branches.length === 0) return ''
  const saved = getStoredBranch()
  if (saved && branches.some((b) => b.id === saved)) return saved
  return branches[0].id
}

/**
 * Hook que mantiene el selectedBranch sincronizado con localStorage.
 * Uso:
 *   const [selectedBranch, setSelectedBranch] = usePersistedBranch()
 *   // Luego, una vez que tenés las branches disponibles:
 *   setSelectedBranch(resolveInitialBranch(branchList))
 */
export function usePersistedBranch(): [string, (id: string) => void] {
  const [selectedBranch, _setSelectedBranch] = useState<string>('')

  // useCallback para que la referencia sea estable entre renders
  // (si no, romper useEffect deps en componentes que la consumen)
  const setSelectedBranch = useCallback((id: string) => {
    if (id) storeBranch(id)
    _setSelectedBranch(id)
  }, [])

  return [selectedBranch, setSelectedBranch]
}
