// Server Component: verifica sesión antes de mostrar el formulario.
// Si el usuario ya está autenticado, lo redirige directo a su dashboard.

import { redirect } from 'next/navigation'
import { getServerProfile } from '@/lib/supabase/server'
import LoginForm from './login-form'

export const metadata = {
  title: 'Ingresar — Valhalla',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const profile = await getServerProfile()

  if (profile) {
    redirect(profile.role === 'admin' ? '/admin' : '/barber')
  }

  const { next, error } = await searchParams

  return <LoginForm redirectTo={next} authError={error} />
}
