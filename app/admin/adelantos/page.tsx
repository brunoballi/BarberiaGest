import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import AdvancesView from './advances-view'

export const metadata = {
  title: 'Adelantos — Valhalla',
}

export default async function AdelantosPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  return <AdvancesView />
}
