import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'

// Redirige al dashboard correspondiente según el rol.
// Si no hay sesión, va a /login.
export default async function RootPage() {
  const profile = await getServerProfile()

  if (!profile) {
    redirect('/login')
  }

  redirect(profile.role === 'admin' ? '/admin' : '/barber')
}
