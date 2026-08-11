import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import SaldoInicialView from './saldo-inicial-view'

export const metadata = {
  title: 'Saldo inicial — Valhalla',
}

export default async function SaldoInicialPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  return <SaldoInicialView />
}
