'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/supabase.client'
import { confirmDialog, errorDialog } from '@/lib/confirm-dialog'

interface Verificado { numero: string; nombre: string | null }

const inputClass =
  'w-full bg-[var(--bg3)] border border-[var(--border-mid)] text-[var(--text)] placeholder-[var(--text-muted)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500'

/**
 * Número de WhatsApp (API de Meta) desde el que esta sucursal manda los avisos
 * automáticos. Es distinto del "WhatsApp de la barbería" de arriba, que es el
 * que ve el cliente en el botón de la reserva. Guarda por su cuenta (migración
 * 112) para no mezclarse con el guardado de la marca.
 */
export default function WhatsAppSenderCard({ branchId }: { branchId: string }) {
  const [guardado, setGuardado] = useState('')
  const [valor, setValor] = useState('')
  const [verificado, setVerificado] = useState<Verificado | null>(null)
  const [busy, setBusy] = useState(false)

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('branches')
      .select('whatsapp_phone_number_id')
      .eq('id', branchId)
      .maybeSingle()
    const id = (data?.whatsapp_phone_number_id as string | null) ?? ''
    setGuardado(id)
    setValor(id)
    setVerificado(null)
  }, [branchId])

  useEffect(() => { if (branchId) void cargar() }, [branchId, cargar])

  async function verificar(): Promise<Verificado | null> {
    const res = await fetch(`/api/whatsapp/numero?id=${encodeURIComponent(valor)}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { void errorDialog(body.error ?? 'No se pudo verificar el número.'); return null }
    const v = { numero: body.numero as string, nombre: (body.nombre as string | null) ?? null }
    setVerificado(v)
    return v
  }

  async function onVerificar() {
    if (!valor) return
    setBusy(true)
    try { await verificar() } finally { setBusy(false) }
  }

  async function onGuardar() {
    setBusy(true)
    try {
      if (valor) {
        const v = await verificar()
        if (!v) return
        const ok = await confirmDialog(
          `Los avisos de esta sucursal van a salir desde ${v.numero}${v.nombre ? ` (${v.nombre})` : ''}. ¿Guardar?`,
        )
        if (!ok) return
      }
      const { error } = await supabase.rpc('set_branch_whatsapp_sender', {
        p_branch_id: branchId,
        p_phone_number_id: valor || null,
      })
      if (error) { void errorDialog(error.message); return }
      setGuardado(valor)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
        Número emisor de los avisos automáticos (Meta)
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={valor}
          onChange={(e) => { setValor(e.target.value.replace(/[^0-9]/g, '')); setVerificado(null) }}
          maxLength={25}
          inputMode="numeric"
          placeholder="Phone Number ID"
          className={inputClass}
        />
        <button
          type="button" onClick={onVerificar} disabled={busy || !valor}
          className="px-3 rounded-lg text-sm border border-[var(--border-mid)] text-[var(--text)] disabled:opacity-40"
        >
          Verificar
        </button>
        <button
          type="button" onClick={onGuardar} disabled={busy || valor === guardado}
          className="px-3 rounded-lg text-sm bg-amber-500 text-black font-semibold disabled:opacity-40"
        >
          Guardar
        </button>
      </div>
      {verificado && (
        <p className="text-xs text-green-500 mt-1.5">
          ✓ {verificado.numero}{verificado.nombre ? ` · ${verificado.nombre}` : ''}
        </p>
      )}
      <p className="text-xs text-[var(--text-muted)] mt-1.5">
        Es el <strong>Phone Number ID</strong> que figura en WhatsApp Manager → Números de
        teléfono (no el número, ni el id de la cuenta). Cada sucursal usa el suyo. Si lo dejás
        vacío, esta sucursal manda desde el número general de la instalación, si hay uno.
      </p>
    </div>
  )
}
