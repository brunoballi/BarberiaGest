import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import RetirosSociosView from './retiros-socios-view'

export const metadata = {
  title: 'Retiros de socios — Valhalla',
}

export default async function RetirosSociosPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  return <RetirosSociosView />
}
