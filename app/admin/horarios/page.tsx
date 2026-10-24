import { requireTurneroAdminPage } from '@/lib/turnero-guard'
import HorariosView from './horarios-view'

export const metadata = {
  title: 'Horarios — Valhalla',
}

// Turnero en prueba: solo lo ve el usuario desarrollador (ver lib/turnero-access.ts).
export default async function HorariosPage() {
  await requireTurneroAdminPage()
  return <HorariosView />
}