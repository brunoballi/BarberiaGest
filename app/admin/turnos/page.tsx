import { requireTurneroAdminPage } from '@/lib/turnero-guard'
import TurnosView from './turnos-view'

export const metadata = {
  title: 'Turnos - Valhalla',
}

// Turnero en prueba: solo lo ve el usuario desarrollador (ver lib/turnero-access.ts).
export default async function TurnosPage() {
  await requireTurneroAdminPage()
  return <TurnosView />
}