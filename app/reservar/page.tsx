// Reserva pública — la única pantalla del sistema SIN login.
//
// El proxy (proxy.ts) solo protege /admin y /barber, así que esta ruta queda
// accesible sin sesión sin necesidad de eximirla.

import { Suspense } from 'react'
import { requireTurneroPublicPage } from '@/lib/turnero-guard'
import BookingView from './booking-view'

// La única pantalla que se comparte por WhatsApp e Instagram: el título y la
// descripción son lo que ve el cliente en la tarjeta del link, y sin las de
// Open Graph la tarjeta sale vacía.
export const metadata = {
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
  },
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
