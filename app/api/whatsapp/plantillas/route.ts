// ============================================================
// Lista y crea las plantillas de WhatsApp del turnero en la cuenta de Meta.
//
// Cargarlas a mano en WhatsApp Manager es lento y propenso a errores: la
// categoría viene en "Marketing" por defecto (y no se puede cambiar después),
// y el editor es incómodo. Acá salen de lib/whatsapp-templates.ts, con la
// categoría correcta, y se mandan a revisión de una.
//
// Solo administradores logueados. Usa WHATSAPP_ACCESS_TOKEN (nunca se devuelve):
//   GET /api/whatsapp/plantillas?waba=<id>              -> estado de las plantillas del turnero
//   GET /api/whatsapp/plantillas?waba=<id>&crear=1      -> crea las que falten (quedan "en revisión")
//   GET /api/whatsapp/plantillas?waba=<id>&borrar=<nombre> -> borra una del turnero (el nombre queda bloqueado 30 días)
// El id de la cuenta (WABA) también puede venir de WHATSAPP_BUSINESS_ACCOUNT_ID.
// Las URLs de los botones usan el dominio desde el que se llama a esta ruta.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-admin'
import { isWhatsAppConfigured } from '@/lib/whatsapp'
import { plantillasTurnero } from '@/lib/whatsapp-templates'
import { isDeveloper } from '@/lib/turnero-access'

const WA_API = 'https://graph.facebook.com/v21.0'

interface MetaTemplate {
  name: string
  status: string
  category: string
  language: string
}

async function listar(waba: string): Promise<{ ok: true; plantillas: MetaTemplate[] } | { ok: false; status: number; meta: unknown }> {
  const res = await fetch(`${WA_API}/${waba}/message_templates?fields=name,status,category,language&limit=200`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    cache: 'no-store',
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) return { ok: false, status: res.status, meta: body }
  return { ok: true, plantillas: ((body as { data?: MetaTemplate[] } | null)?.data ?? []) }
}

export async function GET(request: NextRequest) {
  const caller = await requireAdmin()
  if (caller instanceof NextResponse) return caller

  // Turnero en prueba: solo el usuario desarrollador (lib/turnero-access.ts).
  if (!isDeveloper(caller.user.id)) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  if (!isWhatsAppConfigured()) {
    return NextResponse.json({ error: 'WhatsApp no está configurado en esta instancia.' }, { status: 503 })
  }

  const { searchParams, origin } = request.nextUrl
  const waba = searchParams.get('waba') ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? ''
  if (!/^\d{5,25}$/.test(waba)) {
    return NextResponse.json({ error: 'Falta el id de la cuenta de WhatsApp Business (?waba=...).' }, { status: 400 })
  }

  // Borrar una plantilla del turnero (ej. una versión vieja o con un error de texto).
  // Ojo: Meta bloquea el nombre de una plantilla borrada durante 30 días.
  // Sin verificar que ande: con el token de la primera instancia Meta respondió
  // #100 (falta de permiso); crear y listar sí funcionan. Plan B: borrarla a mano en WhatsApp Manager.
  const borrar = searchParams.get('borrar')
  if (borrar) {
    if (!/^(confirmacion|recordatorio|cancelacion)_turno_v\d+$/.test(borrar)) {
      return NextResponse.json({ error: 'Solo se pueden borrar las plantillas del turnero.' }, { status: 400 })
    }
    const res = await fetch(`${WA_API}/${waba}/message_templates?name=${encodeURIComponent(borrar)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      cache: 'no-store',
    })
    return NextResponse.json({ waba, borrar, status: res.status, meta: await res.json().catch(() => null) }, { status: res.ok ? 200 : 502 })
  }

  const definidas = plantillasTurnero(origin)
  const nombres = new Set(definidas.map((d) => d.name))

  const existentes = await listar(waba)
  if (!existentes.ok) {
    return NextResponse.json({ error: 'Meta rechazó la consulta.', status: existentes.status, meta: existentes.meta }, { status: 502 })
  }

  const creadas: { name: string; ok: boolean; status: number; meta: unknown }[] = []
  if (searchParams.get('crear') === '1') {
    const yaExisten = new Set(existentes.plantillas.map((p) => p.name))
    for (const def of definidas) {
      if (yaExisten.has(def.name)) continue
      const res = await fetch(`${WA_API}/${waba}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(def),
        cache: 'no-store',
      })
      creadas.push({ name: def.name, ok: res.ok, status: res.status, meta: await res.json().catch(() => null) })
    }
  }

  // Estado después de crear (Meta las devuelve como PENDING hasta que las revisa).
  const despues = creadas.length > 0 ? await listar(waba) : existentes
  const delTurnero = despues.ok ? despues.plantillas.filter((p) => nombres.has(p.name)) : []

  return NextResponse.json({
    waba,
    esperadas: definidas.map((d) => d.name),
    en_meta: delTurnero,
    faltan: definidas.map((d) => d.name).filter((n) => !delTurnero.some((p) => p.name === n)),
    creadas,
  })
}
