'use client'

interface Props {
  value: number
  onChange: (v: number) => void
  size?: number
  disabled?: boolean
}

/** Selector de 1 a 5 estrellas, sin dependencias. */
export function StarRating({ value, onChange, size = 32, disabled = false }: Props) {
  return (
    <div style={{ display: 'flex', gap: '0.25rem' }} role="radiogroup" aria-label="Calificación">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
          disabled={disabled}
          onClick={() => onChange(n)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: disabled ? 'default' : 'pointer',
            fontSize: `${size}px`,
            lineHeight: 1,
            color: n <= value ? '#fbbf24' : '#3f3f46',
            transition: 'color 0.15s',
          }}
        >
          ★
        </button>
      ))}
    </div>
  )
}
