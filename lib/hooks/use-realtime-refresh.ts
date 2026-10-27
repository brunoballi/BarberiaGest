'use client'

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/supabase.client'

export interface RealtimeTable {
  table: string
  /** Filtro de Realtime (una sola columna), ej. `branch_id=eq.<uuid>`. Sin filtro = toda la tabla (RLS decide que llega). */
  filter?: string
}

/**
 * Vuelve a leer cuando otra persona (admin, barbero, reserva publica) crea, edita o borra algo.
 * Junta las rafagas de eventos (una edicion toca varias filas) en una sola lectura. Si el canal se cae
 * o la pestaña estuvo en segundo plano, el onChange tambien corre al reconectar para no quedarse viejo.
 * Necesita que la tabla este en la publicacion supabase_realtime (ver migraciones 009 y 102).
 */
export function useRealtimeRefresh(
  name: string | null,
  tables: RealtimeTable[],
  onChange: () => void,
  debounceMs = 400,
) {
  const cb = useRef(onChange)
  useEffect(() => {
    cb.current = onChange
  })
  const key = JSON.stringify(tables)

  useEffect(() => {
    if (!name) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const fire = () => {
      clearTimeout(timer)
      timer = setTimeout(() => cb.current(), debounceMs)
    }
    let channel = supabase.channel(name)
    for (const t of JSON.parse(key) as RealtimeTable[]) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: t.table, ...(t.filter ? { filter: t.filter } : {}) },
        fire,
      )
    }
    let first = true
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      // La primera vez ya cargo la pantalla; las siguientes son reconexiones: se relee.
      if (first) first = false
      else fire()
    })
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [name, key, debounceMs])
}
