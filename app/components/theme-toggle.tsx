'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import './theme-toggle.css'

type Theme = 'light' | 'dark'

export const THEME_KEY = 'flowi:theme'

/**
 * Interruptor de tema claro/oscuro.
 *
 * Guarda la elección en localStorage y la escribe como `data-theme` en <html>.
 * Los colores salen de las variables de app/globals.css, así que cambiar ese
 * atributo repinta el sistema entero sin tocar un solo componente.
 *
 * Si el usuario nunca eligió, no se escribe nada y manda
 * `prefers-color-scheme` — el sistema operativo decide. Elegir a mano pisa esa
 * preferencia (y queda pisada, que es lo que la gente espera de un
 * interruptor).
 *
 * El estado inicial lo deja puesto el script inline de app/layout.tsx, que
 * corre ANTES del primer pintado; acá solo se lee lo que ya está aplicado.
 */
export default function ThemeToggle({ className = '', variant = 'switch' }: {
  className?: string
  /** 'icon': botón cuadrado con luna/sol (pie del menú del admin). */
  variant?: 'switch' | 'icon'
}) {
  const [theme, setTheme] = useState<Theme>('dark')
  const [listo, setListo] = useState(false)

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'light' || attr === 'dark') {
      setTheme(attr)
    } else {
      // Sin elección previa: reflejar lo que está mostrando el sistema, para
      // que el interruptor no arranque contradiciendo lo que se ve.
      setTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    }
    setListo(true)
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    // Transición de color de TODO el sistema durante el cambio (y solo
    // durante: dejarla fija haría lentos los hover de todos los botones).
    const raiz = document.documentElement
    raiz.classList.add('theme-anim')
    window.setTimeout(() => raiz.classList.remove('theme-anim'), 450)
    raiz.setAttribute('data-theme', next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Modo incógnito con storage bloqueado: el tema igual cambia en esta
      // pantalla, solo no se recuerda. No es motivo para romper nada.
    }
  }

  const esClaro = theme === 'light'

  if (variant === 'icon') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={esClaro}
        aria-label={esClaro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
        title={esClaro ? 'Modo oscuro' : 'Modo claro'}
        onClick={toggle}
        className={`theme-icon${esClaro ? ' theme-icon--light' : ''} ${className}`}
      >
        <Moon className="theme-icon__moon" size={18} strokeWidth={2} aria-hidden="true" />
        <Sun className="theme-icon__sun" size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={esClaro}
      aria-label={esClaro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      title={esClaro ? 'Modo oscuro' : 'Modo claro'}
      onClick={toggle}
      // Hasta que el efecto lea el estado real, el interruptor se muestra
      // apagado para no dar un salto visual si el tema era claro.
      className={`theme-toggle${esClaro ? ' theme-toggle--on' : ''}${listo ? '' : ' theme-toggle--init'} ${className}`}
    >
      <span className="theme-toggle__track">
        <span className="theme-toggle__icon theme-toggle__icon--moon" aria-hidden="true">🌙</span>
        <span className="theme-toggle__icon theme-toggle__icon--sun" aria-hidden="true">☀️</span>
        <span className="theme-toggle__knob" />
      </span>
    </button>
  )
}
