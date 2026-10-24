// ============================================================
// Suscribe la cuenta de WhatsApp Business (WABA) a la app de Meta, para que
// los estados de entrega lleguen al webhook (/api/whatsapp/webhook).
//
// Registrar el webhook en la app NO alcanza: Meta solo manda los eventos de
// una cuenta si esa cuenta está suscripta a la app (subscribed_apps). Con
// el alta por API (token de usuario del sistema) ese paso no es automático.
// Hay que hacerlo una vez por instancia.
//
// Solo para administradores logueados. Usa WHATSAPP_ACCESS_TOKEN (nunca se
// devuelve) y el id de la cuenta, que no es secreto:
//   GET /api/whatsapp/suscribir?waba=<id>                -> muestra qué apps están suscriptas
//   GET /api/whatsapp/suscribir?waba=<id>&suscribir=1    -> suscribe la app del token
// El id también puede venir de WHATSAPP_BUSINESS_ACCOUNT_ID.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-admin'
import { isWhatsAppConfigured } from '@/lib/whatsapp'
import { isDeveloper } from '@/lib/turnero-access'

const WA_API = 'https://graph.facebook.com/v21.0'

export async function GET(request: NextRequest) {
  const caller = await requireAdmin()
  if (caller instanceof NextResponse) return caller

  // Turnero en prueba: solo el usuario desarrollador (lib/turnero-access.ts).
  if (!isDeveloper(caller.user.id)) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  if (!isWhatsAppConfigured()) {
    return NextResponse.json({ error: 'WhatsApp no está configurado en esta instancia.' }, { status: 503 })
  }

  const { searchParams } = request.nextUrl
  const waba = searchParams.get('waba') ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? ''
  if (!/^\d{5,25}$/.test(waba)) {
    return NextResponse.json({ error: 'Falta el id de la cuenta de WhatsApp Business (?waba=...).' }, { status: 400 })
  }

  const suscribir = searchParams.get('suscribir') === '1'
  const res = await fetch(`${WA_API}/${waba}/subscribed_apps`, {
    method: suscribir ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    cache: 'no-store',
  })

  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }

  return NextResponse.json({ waba, accion: suscribir ? 'suscribir' : 'listar', status: res.status, meta: body }, { status: res.ok ? 200 : 502 })
}
