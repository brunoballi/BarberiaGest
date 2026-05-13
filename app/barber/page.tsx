// Server Component: verifica que el usuario sea barbero.
// Si es admin lo redirige a /admin; sin sesión va a /login.

import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import BarberMobileView from './barber-mobile-view'

export const metadata = {
  title: 'Valhalla — Mi panel',
}

export default async function BarberPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'barber') redirect('/admin')

  return <BarberMobileView />
}
