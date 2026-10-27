import { requireTurneroAdminPage } from '@/lib/turnero-guard'
import BloqueosView from './bloqueos-view'

export const metadata = {
  title: 'Bloqueos — Valhalla',
}

// Turnero en prueba: solo lo ve el usuario desarrollador (ver lib/turnero-access.ts).
export default async function BloqueosPage() {
  await requireTurneroAdminPage()
  return <BloqueosView />
}
