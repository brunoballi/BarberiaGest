import { requireTurneroAdminPage } from '@/lib/turnero-guard'
import ClientesView from './clientes-view'

export const metadata = {
  title: 'Clientes — Valhalla',
}

// Turnero en prueba: solo lo ve el usuario desarrollador (ver lib/turnero-access.ts).
export default async function ClientesPage() {
  await requireTurneroAdminPage()
  return <ClientesView />
}