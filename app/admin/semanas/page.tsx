import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import WeeksView from './weeks-view'

export const metadata = {
  title: 'Semanas — Valhalla',
}

export default async function SemanasPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  return <WeeksView />
}
