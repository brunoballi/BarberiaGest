// ============================================================
// Verifica un Phone Number ID de Meta contra la Cloud API, para que el admin
// confirme que cargó el número correcto ANTES de guardarlo en la sucursal.
//
//   GET /api/whatsapp/numero?id=<phone_number_id>
//     -> { id, numero, nombre, calidad }
//
// Usa WHATSAPP_ACCESS_TOKEN (nunca se devuelve). Solo administradores. Un id
// que el token no puede ver (o que es un WABA id en vez de un Phone Number
// ID) devuelve el mismo error genérico de Meta -- ver la sección 4 de
// docs/whatsapp_alta_instancia.md.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-admin'
import { isWhatsAppConfigured } from '@/lib/whatsapp'
import { canUseTurnero } from '@/lib/turnero-access'

const WA_API = 'https://graph.facebook.com/v21.0'

export async function GET(request: NextRequest) {
  const caller = await requireAdmin()
  if (caller instanceof NextResponse) return caller

  // Turnero en prueba: solo el usuario desarrollador (lib/turnero-access.ts).
  if (!canUseTurnero(caller.user.id)) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  if (!isWhatsAppConfigured()) {
    return NextResponse.json({ error: 'WhatsApp no está configurado en esta instancia (falta el token).' }, { status: 503 })
  }

  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!/^\d{5,25}$/.test(id)) {
    return NextResponse.json({ error: 'El Phone Number ID tiene que ser solo números.' }, { status: 400 })
  }

  const res = await fetch(
    `${WA_API}/${id}?fields=display_phone_number,verified_name,quality_rating`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }, cache: 'no-store' },
  )
  const body = (await res.json().catch(() => null)) as {
    display_phone_number?: string
    verified_name?: string
    quality_rating?: string
    error?: { message?: string }
  } | null

  if (!res.ok || !body?.display_phone_number) {
    return NextResponse.json(
      { error: body?.error?.message ?? 'Meta no reconoció ese número. Revisá que sea el Phone Number ID (no el id de la cuenta) y que el token tenga acceso.' },
      { status: 422 },
    )
  }

  return NextResponse.json({
    id,
    numero: body.display_phone_number,
    nombre: body.verified_name ?? null,
    calidad: body.quality_rating ?? null,
  })
}
