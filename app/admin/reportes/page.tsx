import ReportesView from './reportes-view'

// Evitar prerender estático: la vista consume Supabase desde el navegador
export const dynamic = 'force-dynamic'

export default function ReportesPage() {
  return <ReportesView />
}
