import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import GastosView from './gastos-view'

export const metadata = {
  title: 'Gastos — Valhalla',
}

export default async function GastosPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  return <GastosView />
}
