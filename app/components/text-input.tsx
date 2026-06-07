'use client'

import React, { useCallback } from 'react'

/**
 * Input de texto que (por defecto) rechaza dígitos numéricos, para evitar que
 * el usuario cargue números por error en campos como nombre, apellido o motivo.
 *
 * Drop-in de <input>: acepta `className` y props nativas. Componente controlado.
 * - allowNumbers={true} para campos que SÍ aceptan dígitos (DNI, teléfono).
 */
export interface TextInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (value: string) => void
  /** Si es true, no filtra dígitos (default false → rechaza 0-9). */
  allowNumbers?: boolean
}

export function sanitizeText(raw: string, allowNumbers: boolean): string {
  return allowNumbers ? raw : raw.replace(/[0-9]/g, '')
}

export function TextInput({ value, onChange, allowNumbers = false, className, ...rest }: TextInputProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(sanitizeText(e.target.value, allowNumbers))
    },
    [onChange, allowNumbers]
  )

  return (
    <input
      {...rest}
      type="text"
      value={value}
      onChange={handleChange}
      className={className}
    />
  )
}

export default TextInput
