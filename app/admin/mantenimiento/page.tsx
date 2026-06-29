import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import MantenimientoView from './mantenimiento-view'

export const metadata = {
  title: 'Mantenimiento — Valhalla',
}

export default async function MantenimientoPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  return <MantenimientoView />
}
