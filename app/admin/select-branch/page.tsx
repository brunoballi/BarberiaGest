import SelectBranchView from './select-branch-view'

// Evitar prerender estático: la vista consume Supabase desde el navegador
export const dynamic = 'force-dynamic'

export default function SelectBranchPage() {
  return <SelectBranchView />
}
