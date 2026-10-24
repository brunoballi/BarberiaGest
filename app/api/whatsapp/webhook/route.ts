// ============================================================
// Webhook de WhatsApp Cloud API: estados de entrega de los mensajes.
//
// Meta le avisa acá cuando un mensaje pasa a sent / delivered / read o
// falla (con el código de error real: 131042 = falta método de pago,
// 131026 = el número no tiene WhatsApp, etc.). Sin esto la app solo sabe que
// Meta ACEPTÓ el pedido, no que el mensaje haya llegado.
//
// Configuración en developers.facebook.com -> tu app -> WhatsApp ->
// Configuración -> Webhook (paso a paso en docs/whatsapp_webhook.md):
//   · URL de devolución de llamada: https://<dominio>/api/whatsapp/webhook
//   · Token de verificación: el valor de WHATSAPP_WEBHOOK_VERIFY_TOKEN
//   · Suscribirse al campo "messages" (los estados vienen ahí).
//
// Seguridad: la URL es pública, así que el POST se acepta SOLO si trae la
// firma HMAC-SHA256 correcta (header X-Hub-Signature-256, calculada con el
// "secreto de la app" de Meta sobre el cuerpo crudo). Sin WHATSAPP_APP_SECRET
// configurado se rechaza todo: nunca se procesa un cuerpo sin firmar.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { recordWhatsAppStatus } from '@/lib/whatsapp-log'

const MAX_BODY_BYTES = 1_000_000

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** Handshake inicial: Meta llama una vez al guardar la URL del webhook. */
export async function GET(request: NextRequest) {
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  const { searchParams } = request.nextUrl
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token') ?? ''
  const challenge = searchParams.get('hub.challenge') ?? ''

  if (!expected || mode !== 'subscribe' || !safeEqual(token, expected)) {
    return new Response('Forbidden', { status: 403 })
  }
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

interface WaError {
  code?: number
  title?: string
  message?: string
  error_data?: { details?: string }
}

interface WaStatus {
  id?: string
  status?: string
  recipient_id?: string
  errors?: WaError[]
}

interface WaPayload {
  object?: string
  entry?: { changes?: { value?: { statuses?: WaStatus[] } }[] }[]
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret) {
    console.error('[whatsapp-webhook] falta WHATSAPP_APP_SECRET: se rechaza el pedido')
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  const raw = await request.text()
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 })
  }

  const signature = request.headers.get('x-hub-signature-256') ?? ''
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex')
  if (!safeEqual(signature, expected)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let payload: WaPayload
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  let processed = 0
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        if (!s.id || !s.status) continue
        const err = s.errors?.[0]
        const ok = await recordWhatsAppStatus({
          wamid: s.id,
          status: s.status,
          recipient: s.recipient_id ?? null,
          errorCode: typeof err?.code === 'number' ? err.code : null,
          errorTitle: err?.title ?? err?.message ?? null,
          errorDetail: err?.error_data?.details ?? err?.message ?? null,
        })
        // Si la base falla se responde 500: Meta reintenta el webhook, y el
        // upsert monótono hace seguro repetirlo.
        if (!ok) return NextResponse.json({ error: 'db_error' }, { status: 500 })
        processed++
      }
    }
  }

  return NextResponse.json({ ok: true, processed })
}
