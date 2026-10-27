import { redirect } from 'next/navigation'
import { requireTurneroAdminPage } from '@/lib/turnero-guard'

export const metadata = {
  title: 'Horarios — Valhalla',
}

// Los horarios pasaron a Barberos (solapa "Horarios"). La ruta vieja queda para no romper favoritos.
export default async function HorariosPage() {
  await requireTurneroAdminPage()
  redirect('/admin/barberos?tab=horarios')
}
