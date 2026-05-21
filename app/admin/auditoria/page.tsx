import AuditView from './auditoria-view'

// Evitar prerender estático: la vista consume datos del cliente Supabase
export const dynamic = 'force-dynamic'

export default function AuditPage() {
  return <AuditView />
}
