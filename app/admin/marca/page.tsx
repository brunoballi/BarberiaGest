import { requireTurneroAdminPage } from '@/lib/turnero-guard'
import MarcaView from './marca-view'

export const metadata = {
  title: 'Marca - Valhalla',
}

// Turnero en prueba: solo lo ve el usuario desarrollador (ver lib/turnero-access.ts).
export default async function MarcaPage() {
  await requireTurneroAdminPage()
  return <MarcaView />
}