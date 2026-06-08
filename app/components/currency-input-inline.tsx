'use client'

import React, { useState, useCallback } from 'react'
import { formatToDisplay, parseFromInput } from './currency-input'

/**
 * Variante "no controlada" de CurrencyInput para celdas/inputs que editan a mano
 * y confirman el valor en `onBlur` (patrón defaultValue + commit).
 *
 * - Bloquea letras (solo dígitos, miles con punto y decimales con coma).
 * - Muestra separador de miles formato AR mientras se tipea.
 * - Emite el valor numérico (number) en onCommit al perder foco. 0 si queda vacío.
 *
 * Para resetear al cambiar el dato externo, pasar `key` desde el padre (como el
 * patrón uncontrolled previo con defaultValue).
 */
export interface CurrencyInputInlineProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type' | 'inputMode' | 'defaultValue'
  > {
  /** Valor inicial (number o string numérico). '' / null → vacío. */
  defaultValue: string | number | null | undefined
  /** Se llama al perder foco con el número parseado (0 si vacío/ inválido). */
  onCommit: (value: number) => void
  /** Decimales permitidos (default 2). */
  decimals?: number
}

export function CurrencyInputInline({
  defaultValue,
  onCommit,
  decimals = 2,
  className,
  onBlur,
  ...rest
}: CurrencyInputInlineProps) {
  const [raw, setRaw] = useState<string>(() =>
    defaultValue === '' || defaultValue === null || defaultValue === undefined
      ? ''
      : String(defaultValue)
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setRaw(parseFromInput(e.target.value, decimals))
    },
    [decimals]
  )

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const v = parseFloat(raw)
      onCommit(isNaN(v) ? 0 : v)
      onBlur?.(e)
    },
    [raw, onCommit, onBlur]
  )

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={formatToDisplay(raw)}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
    />
  )
}

export default CurrencyInputInline
