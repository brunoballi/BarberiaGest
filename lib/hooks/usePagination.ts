'use client'

import { useMemo, useState } from 'react'

export const PAGE_SIZE_OPTIONS = [20, 30, 50, 100] as const

/**
 * Paginación en memoria para grillas. Default 20 filas; el usuario puede
 * cambiar a 20/30/50/100. Se resetea a la página 1 cuando cambia la cantidad
 * de items (ej: al aplicar un filtro) o el tamaño de página.
 */
export function usePagination<T>(items: T[], defaultPageSize = 20) {
  const [pageSize, setPageSizeState] = useState<number>(defaultPageSize)
  const [currentPage, setCurrentPage] = useState(1)

  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Si los datos cambian y la página actual queda fuera de rango, corregir.
  const page = Math.min(currentPage, totalPages)
  if (page !== currentPage) setCurrentPage(page)

  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, page, pageSize])

  const startIdx = total === 0 ? 0 : (page - 1) * pageSize + 1
  const endIdx = Math.min(page * pageSize, total)

  return {
    paginatedData,
    currentPage: page,
    pageSize,
    totalPages,
    totalItems: total,
    startIdx,
    endIdx,
    canGoPrevious: page > 1,
    canGoNext: page < totalPages,
    goToPage: (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages)),
    setPageSize: (size: number) => {
      setPageSizeState(size)
      setCurrentPage(1)
    },
  }
}

export type UsePaginationReturn<T> = ReturnType<typeof usePagination<T>>
