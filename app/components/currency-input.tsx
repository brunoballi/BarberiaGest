'use client'

import React, { useCallback } from 'react'

/**
 * Input de montos con formato argentino: miles con punto, decimales con coma.
 *   Display al usuario: 100.000,00
 *   Valor emitido por onChange (parseable con parseFloat): "100000.00"
 *
 * Drop-in de <input>: acepta `className` y demás props nativas para no
 * romper los estilos de cada formulario. Es un componente controlado:
 * `value` es el string numérico crudo (ej "100000.5"), NO el formateado.
 */
export interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  value: string | number | null | undefined
  /** Emite el valor numérico normalizado como string (ej "100000.5"). '' si vacío. */
  onChange: (value: string) => void
  /** Cantidad máxima de decimales permitidos (default 2). */
  decimals?: number
  /** Permite valores negativos (default false). Útil para saldos. */
  allowNegative?: boolean
}

/** "100000.5" → "100.000,5"  ·  "100000." → "100.000,"  ·  "" → "" */
export function formatToDisplay(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const raw = String(value)
  const negative = raw.trim().startsWith('-')
  const unsigned = negative ? raw.trim().slice(1) : raw.trim()

  const dotIdx = unsigned.indexOf('.')
  const intRaw = dotIdx === -1 ? unsigned : unsigned.slice(0, dotIdx)
  const decRaw = dotIdx === -1 ? null : unsigned.slice(dotIdx + 1)

  const intClean = (intRaw.replace(/\D/g, '').replace(/^0+(?=\d)/, '')) || '0'
  const grouped = intClean.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

  let out = grouped
  if (decRaw !== null) out += ',' + decRaw.replace(/\D/g, '')
  return negative ? '-' + out : out
}

/** Texto tipeado (cualquier formato) → string numérico normalizado "100000.5". */
export function parseFromInput(raw: string, decimals = 2, allowNegative = false): string {
  const negative = allowNegative && raw.trim().startsWith('-')
  // Solo dígitos, punto, coma (el punto se trata como separador de miles → se descarta)
  let s = raw.replace(/[^\d.,]/g, '')
  s = s.replace(/\./g, '') // quitar separadores de miles
  s = s.replace(/,/g, '.') // coma decimal → punto decimal

  const firstDot = s.indexOf('.')
  if (firstDot !== -1) {
    const intPart = s.slice(0, firstDot)
    const decPart = s.slice(firstDot + 1).replace(/\./g, '').slice(0, decimals)
    s = intPart + '.' + decPart
  }
  // Normalizar ceros a la izquierda de la parte entera (sin tocar la coma en curso)
  if (s !== '' && s !== '.') {
    const [i, d] = s.split('.')
    const iClean = (i.replace(/^0+(?=\d)/, '')) || '0'
    s = d !== undefined ? `${iClean}.${d}` : iClean
  }
  return negative ? '-' + s : s
}

export function CurrencyInput({ value, onChange, decimals = 2, allowNegative = false, className, ...rest }: CurrencyInputProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(parseFromInput(e.target.value, decimals, allowNegative))
    },
    [onChange, decimals, allowNegative]
  )

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={formatToDisplay(value)}
      onChange={handleChange}
      className={className}
    />
  )
}

export default CurrencyInput
