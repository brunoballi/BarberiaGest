// Server Component: verifica que el usuario sea admin.
// Si es barbero lo redirige a /barber; sin sesión va a /login.

import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import AdminDashboard from './admin-dashboard'

export const metadata = {
  title: 'Admin — Valhalla',
}

export default async function AdminPage() {
  const profile = await getServerProfile()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/barber')

  return <AdminDashboard />
}
