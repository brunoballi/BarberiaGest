// Gestionar/cancelar un turno ya reservado — sin login, misma superficie
// pública que /reservar. Accesible sola (ej. desde el link del mail) o
// desde el botón "Gestionar mi turno" al confirmar una reserva.

import { Suspense } from 'react'
import { requireTurneroPublicPage } from '@/lib/turnero-guard'
import GestionarView from './gestionar-view'

export const metadata = {
  title: 'Gestionar mi turno',
  description: 'Consultá o cancelá tu turno',
}

export const dynamic = 'force-dynamic'

// Turnero en prueba: 404 salvo para el usuario desarrollador (ver lib/turnero-access.ts).
export default async function GestionarPage() {
  await requireTurneroPublicPage()
  return (
    // GestionarView lee ?ref= y ?sucursal= con useSearchParams -- mismo
    // límite de Suspense que exige el build de producción en /reservar.
    <Suspense fallback={null}>
      <GestionarView />
    </Suspense>
  )
}
