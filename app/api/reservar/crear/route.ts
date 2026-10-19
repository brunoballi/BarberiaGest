// ============================================================
// Crea una reserva pública con tope de 20 por IP y por día (109).
//
// Antes el navegador llamaba directo a create_appointment_public con la
// clave anónima; ahí la IP no es confiable y no había forma de frenar a
// alguien que llenara la agenda cambiando de teléfono. Ahora la reserva
// pasa por acá: la IP la pone Vercel (x-real-ip / x-forwarded-for se
// sobrescriben en su borde, el cliente no los puede falsificar) y se manda
// solo un hash con sal a la base, nunca la IP.
//
// El tope, la creación del turno y la suma al contador ocurren juntos en
// create_appointment_public_rl: una reserva que falla no gasta cupo.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { serviceRoleClient } from '@/lib/api-admin'
import { turneroApiGate } from '@/lib/turnero-guard'

function clientIp(request: NextRequest): string {
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
}

function hashIp(ip: string): string {
  // Sal del servidor: sin ella, el hash de una IP (hay pocas) se revierte
  // probando todas.
  const salt = process.env.IP_HASH_SALT ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex')
}

export async function POST(request: NextRequest) {
  // Turnero en prueba: cerrado salvo para el usuario desarrollador (lib/turnero-access.ts).
  const gate = await turneroApiGate()
  if (gate) return gate

  let body: {
    branchId?: string
    barberId?: string
    clientName?: string
    clientPhone?: string
    clientEmail?: string | null
    startsAt?: string
    serviceIds?: string[]
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  }

  const ip = clientIp(request)
  if (!ip) {
    return NextResponse.json({ error: 'No pudimos identificar tu conexión. Probá de nuevo.' }, { status: 400 })
  }

  // 'any' = sin preferencia: la base elige el barbero (113). Cualquier otra
  // cosa tiene que venir como el id de un barbero; si falta, es un pedido mal
  // armado y se rechaza en vez de asignar uno sin que nadie lo haya pedido.
  if (typeof body.barberId !== 'string' || !body.barberId) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  }

  const { data, error } = await serviceRoleClient().rpc('create_appointment_public_rl', {
    p_ip_hash: hashIp(ip),
    p_branch_id: body.branchId,
    p_barber_id: body.barberId === 'any' ? null : body.barberId,
    p_client_name: body.clientName,
    p_client_phone: body.clientPhone,
    p_client_email: body.clientEmail ?? null,
    p_starts_at: body.startsAt,
    p_service_ids: body.serviceIds,
  })

  // Los mensajes de la base ya están redactados para mostrarse tal cual
  // ("Ese horario ya no está disponible", el del tope, etc.).
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const reserva = ((data ?? []) as { reference: string; starts_at: string; ends_at: string }[])[0]
  if (!reserva) return NextResponse.json({ error: 'No se pudo crear la reserva' }, { status: 500 })

  return NextResponse.json(reserva)
}
