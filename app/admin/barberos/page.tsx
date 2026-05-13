import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import BarbersAbm from './barbers-abm'

export const metadata = {
  title: 'Barberos — Valhalla',
}

export default async function BarberosPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  return <BarbersAbm />
}
