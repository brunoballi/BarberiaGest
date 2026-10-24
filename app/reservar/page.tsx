// Reserva pública — la única pantalla del sistema SIN login.
//
// El proxy (proxy.ts) solo protege /admin y /barber, así que esta ruta queda
// accesible sin sesión sin necesidad de eximirla.

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { requireTurneroPublicPage } from '@/lib/turnero-guard'
import BookingView from './booking-view'

// La única pantalla que se comparte por WhatsApp e Instagram: el título y la
// descripción son lo que ve el cliente en la tarjeta del link, y sin las de
// Open Graph la tarjeta sale vacía.
// El logo de la marca vive en la base (no en el repo): se lee con la misma RPC
// pública que usa la pantalla (get_booking_header) para ponerlo como imagen de
// la tarjeta. Si falla, la tarjeta sale sin imagen en vez de romper la página.
async function logoDeLaMarca(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_booking_header`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { logo_url: string | null }[] | { logo_url: string | null } | null
    const row = Array.isArray(data) ? data[0] : data
    return row?.logo_url ?? null
  } catch {
    return null
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const logo = await logoDeLaMarca()
  return {
    title: 'Reservar turno online',
    description:
      'Sacá tu turno en segundos: elegí sucursal, servicio, barbero y horario. Sin llamar, sin esperar, y con confirmación al instante.',
    alternates: { canonical: '/reservar' },
    openGraph: {
      type: 'website',
      title: 'Reservá tu turno online',
      description:
        'Elegí sucursal, servicio, barbero y horario. Sin llamar y sin esperar.',
      url: '/reservar',
      ...(logo ? { images: [{ url: logo }] } : {}),
    },
    twitter: { card: logo ? 'summary_large_image' : 'summary', ...(logo ? { images: [logo] } : {}) },
  }
}

// Los datos los pide el cliente vía RPC con la clave anónima; no hay nada que
// prerenderizar y el contenido cambia con cada reserva.
export const dynamic = 'force-dynamic'

// Turnero en prueba: 404 salvo para el usuario desarrollador (ver lib/turnero-access.ts).
export default async function ReservarPage() {
  await requireTurneroPublicPage()
  return (
    // BookingView lee ?sucursal= con useSearchParams -- exige un límite de
    // Suspense en el build de producción.
    <Suspense fallback={null}>
      <BookingView />
    </Suspense>
  )
}
