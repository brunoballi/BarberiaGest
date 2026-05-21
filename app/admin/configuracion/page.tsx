import ConfiguracionView from './configuracion-view'

// Evitar prerender estático: la vista consume Supabase desde el navegador
export const dynamic = 'force-dynamic'

export default function ConfiguracionPage() {
  return <ConfiguracionView />
}
