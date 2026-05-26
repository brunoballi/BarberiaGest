'use client'

import { useState, useMemo, useEffect } from 'react'
import { ADMIN_HELP, BARBER_HELP, type HelpSection } from './help-content'
import './help-panel.css'

interface Props {
  role: 'admin' | 'barber'
}

export default function HelpPanel({ role }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const sections: HelpSection[] = role === 'admin' ? ADMIN_HELP : BARBER_HELP

  // Cuando se abre por primera vez, expandir la primera sección
  useEffect(() => {
    if (open && expanded.size === 0 && sections.length > 0) {
      setExpanded(new Set([sections[0].title]))
    }
  }, [open, sections, expanded.size])

  // Cerrar con ESC
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Si hay query, filtrar y expandir todo
  const filtered: HelpSection[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sections
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (it) => it.q.toLowerCase().includes(q) || it.a.toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.items.length > 0)
  }, [sections, query])

  function toggleSection(title: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  const isFiltering = query.trim().length > 0

  return (
    <>
      {/* Botón flotante */}
      <button
        type="button"
        className="help-fab"
        onClick={() => setOpen(true)}
        aria-label="Abrir ayuda"
        title="Ayuda"
      >
        <span className="help-fab__icon">?</span>
      </button>

      {/* Overlay + panel */}
      {open && (
        <div className="help-overlay" onClick={() => setOpen(false)}>
          <aside className="help-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ayuda">
            <header className="help-panel__header">
              <h2 className="help-panel__title">
                <span className="help-panel__title-icon">💡</span>
                Centro de ayuda
              </h2>
              <button className="help-panel__close" onClick={() => setOpen(false)} aria-label="Cerrar">
                ✕
              </button>
            </header>

            <div className="help-panel__search">
              <input
                type="text"
                placeholder="Buscar…  (ej: liquidación, adelanto, cerrar semana)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="help-panel__search-input"
              />
            </div>

            <div className="help-panel__body">
              {filtered.length === 0 ? (
                <p className="help-panel__empty">No encontramos nada que coincida con "{query}".</p>
              ) : (
                filtered.map((section) => {
                  const isExpanded = isFiltering || expanded.has(section.title)
                  return (
                    <section key={section.title} className="help-section">
                      <button
                        type="button"
                        className="help-section__head"
                        onClick={() => !isFiltering && toggleSection(section.title)}
                      >
                        <span>{section.title}</span>
                        <span className="help-section__count">{section.items.length}</span>
                        {!isFiltering && (
                          <span className="help-section__caret">{isExpanded ? '▾' : '▸'}</span>
                        )}
                      </button>
                      {isExpanded && (
                        <ul className="help-section__list">
                          {section.items.map((item, i) => (
                            <li key={i} className="help-item">
                              <p className="help-item__q">{item.q}</p>
                              <p className="help-item__a">{item.a}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )
                })
              )}
            </div>

            <footer className="help-panel__footer">
              <p>¿No encontraste lo que buscabas? Contactá al administrador del sistema.</p>
            </footer>
          </aside>
        </div>
      )}
    </>
  )
}
