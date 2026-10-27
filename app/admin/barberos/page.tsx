import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import { canUseTurnero } from '@/lib/turnero-access'
import BarberosTabs from './barberos-tabs'

export const metadata = {
  title: 'Barberos — Valhalla',
}

export default async function BarberosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  const { tab } = await searchParams
  return <BarberosTabs turnero={canUseTurnero(profile.id)} initialTab={tab === 'horarios' ? 'horarios' : 'datos'} />
}
