import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import BenefitsView from './benefits-view'

export const metadata = {
  title: 'Beneficios — Valhalla',
}

export default async function BeneficiosPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  return <BenefitsView />
}
