'use client'

import React from 'react'
import { PAGE_SIZE_OPTIONS } from '@/lib/hooks/usePagination'

export interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  pageSize: number
  totalItems: number
  startIdx: number
  endIdx: number
  canGoPrevious: boolean
  canGoNext: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  /** Etiqueta del tipo de item (ej "adelantos", "gastos"). Default "registros". */
  itemLabel?: string
}

/**
 * Controles de paginación reutilizables (Tailwind, tema oscuro). Muestra
 * "Mostrando X–Y de N", navegación anterior/siguiente y selector 20/30/50/100.
 * No renderiza nada si hay 0 items.
 */
export function PaginationControls({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  startIdx,
  endIdx,
  canGoPrevious,
  canGoNext,
  onPageChange,
  onPageSizeChange,
  itemLabel = 'registros',
}: PaginationControlsProps) {
  if (totalItems === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 border-t border-zinc-800 text-sm text-zinc-400">
      <span>
        Mostrando <strong className="text-zinc-200">{startIdx}</strong>–
        <strong className="text-zinc-200">{endIdx}</strong> de{' '}
        <strong className="text-zinc-200">{totalItems}</strong> {itemLabel}
      </span>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!canGoPrevious}
          className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Anterior
        </button>
        <span className="px-2 whitespace-nowrap">
          Página <strong className="text-zinc-200">{currentPage}</strong> / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!canGoNext}
          className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Siguiente →
        </button>
      </div>

      <label className="flex items-center gap-2">
        <span className="text-zinc-500">Filas:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-500"
        >
          {PAGE_SIZE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export default PaginationControls
