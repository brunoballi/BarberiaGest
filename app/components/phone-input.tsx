'use client'

import React, { useCallback, useState, useEffect } from 'react'

/**
 * Input de teléfono con formato argentino.
 *
 * Por qué existe (y por qué normaliza):
 * el teléfono NO es un dato de contacto más — es el IDENTIFICADOR del cliente
 * en la base (`unique (branch_id, phone)` en appointment_clients). Si la misma
 * persona reserva una vez como "3413487910" y otra como "+54 341 348-7910",
 * queda como dos clientes distintos: se parte el historial y el límite de 3
 * turnos activos por teléfono deja de aplicar. Guardar siempre la misma forma
 * canónica es lo que evita eso.
 *
 * Forma canónica: +54 seguido de código de área + número, sin separadores.
 *   +543413487910
 *
 * Qué acepta al escribir (todo esto termina en el mismo valor guardado):
 *   341 348 7910      0341 15 348-7910      +54 341 348-7910      3413487910
 *
 * El formateo NO se aplica mientras se tipea, a propósito: reescribir el valor
 * en cada tecla mueve el cursor al final y hace imposible corregir un dígito
 * del medio. Se normaliza al salir del campo (onBlur), y mientras tanto se
 * muestra abajo cómo va a quedar guardado.
 */

/**
 * Filtra lo que NO puede formar parte de un teléfono, pero deja los separadores
 * que la gente usa al escribir (espacio, guion, paréntesis) y el '+' inicial.
 *
 * Se conservan a propósito: si se borraran en cada tecla, un número ya
 * formateado se colapsaría apenas entrás a corregir un dígito. Los separadores
 * son solo visuales — normalizePhone los ignora.
 */
function soloCaracteresDeTelefono(raw: string): string {
  const masInicial = raw.trimStart().startsWith('+')
  const resto = raw.replace(/[^\d\s()-]/g, '')
  return (masInicial ? '+' : '') + resto
}

/**
 * Lleva cualquier variante a la forma canónica +54XXXXXXXXXX.
 * Devuelve '' si todavía no hay suficientes dígitos para decidir.
 */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (!d) return ''

  // 00 54 ... (prefijo internacional marcado a la vieja usanza)
  if (d.startsWith('0054')) d = d.slice(2)
  // Ya viene con país
  if (d.startsWith('54')) d = d.slice(2)
  // Prefijo nacional de larga distancia: 0341 -> 341
  if (d.startsWith('0')) d = d.replace(/^0+/, '')
  // Celular viejo estilo: 341 15 3487910 -> 341 3487910.
  // El '15' solo se saca si está pegado al código de área (2 a 4 dígitos) y
  // lo que queda tiene largo de número real.
  const conQuince = d.match(/^(\d{2,4})15(\d{6,8})$/)
  if (conQuince) d = conQuince[1] + conQuince[2]
  // El 9 de celular que usa la numeración internacional argentina se descarta:
  // lo importante acá es que el MISMO teléfono produzca SIEMPRE la misma
  // cadena, no reconstruir el formato de discado.
  if (d.length === 11 && d.startsWith('9')) d = d.slice(1)

  if (d.length < 8) return ''
  return '+54' + d
}

/**
 * Muestra +543413487910 como "+54 341 348-7910".
 *
 * Los códigos de área argentinos son de 2, 3 o 4 dígitos y el total (área +
 * número) siempre suma 10, así que NO se puede deducir el corte por el largo:
 * hay que mirar el prefijo. Solo el 11 (AMBA) es de 2 dígitos; los de 4 son de
 * localidades chicas y, si alguno cae acá, se muestra agrupado como si fuera de
 * 3 — se ve un poco raro pero el valor guardado es igual de correcto, que es lo
 * que importa para no duplicar clientes.
 */
export function formatPhoneDisplay(canonico: string): string {
  const d = canonico.replace(/\D/g, '').replace(/^54/, '')
  if (d.length < 8) return canonico
  const largoArea = d.startsWith('11') ? 2 : 3
  const area = d.slice(0, largoArea)
  const resto = d.slice(largoArea)
  const mitad = resto.length > 6 ? 4 : 3
  return `+54 ${area} ${resto.slice(0, resto.length - mitad)}-${resto.slice(resto.length - mitad)}`
}

export interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Valor canónico (+54...). */
  value: string
  /** Recibe el valor canónico, no lo que se ve en pantalla. */
  onChange: (canonico: string) => void
  /** Muestra debajo cómo va a quedar guardado. Default true. */
  mostrarPreview?: boolean
  className?: string
  hintClassName?: string
}

export function PhoneInput({
  value,
  onChange,
  mostrarPreview = true,
  className,
  hintClassName,
  placeholder = '+54 341 348-7910',
  ...rest
}: PhoneInputProps) {
  // Borrador local: lo que se ve mientras se escribe, sin reformatear.
  const [borrador, setBorrador] = useState(() => (value ? formatPhoneDisplay(value) : ''))

  // Si el valor cambia desde AFUERA (reset del formulario, carga de datos), el
  // input tiene que reflejarlo. Pero ojo: este efecto también se dispara por
  // nuestro propio onChange, y reformatear ahí reescribiría el texto en cada
  // tecla y mandaría el cursor al final — imposible corregir un dígito del
  // medio. Por eso solo se sincroniza cuando el valor de afuera NO es el que
  // produce el borrador actual.
  useEffect(() => {
    setBorrador((actual) =>
      normalizePhone(actual) === value ? actual : value ? formatPhoneDisplay(value) : ''
    )
  }, [value])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const limpio = soloCaracteresDeTelefono(e.target.value)
      setBorrador(limpio)
      onChange(normalizePhone(limpio))
    },
    [onChange]
  )

  const handleBlur = useCallback(() => {
    const canonico = normalizePhone(borrador)
    if (canonico) setBorrador(formatPhoneDisplay(canonico))
  }, [borrador])

  const canonico = normalizePhone(borrador)

  return (
    <>
      <input
        {...rest}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={borrador}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={className}
      />
      {mostrarPreview && borrador.replace(/\D/g, '').length > 0 && (
        <p className={hintClassName}>
          {canonico
            ? `Se guarda como ${formatPhoneDisplay(canonico)}`
            : 'Faltan dígitos para que sea un teléfono válido'}
        </p>
      )}
    </>
  )
}

export default PhoneInput
