import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import ServicesView from './services-view'

export const metadata = {
  title: 'Servicios — Valhalla',
}

export default async function ServiciosPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  return <ServicesView />
}
