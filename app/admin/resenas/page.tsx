import { requireDeveloperAdminPage } from '@/lib/turnero-guard'
import FlowyReviewsView from './resenas-view'

export const dynamic = 'force-dynamic'

// Pantalla interna del desarrollador (estado del envío de reseñas a Flowi): no se muestra al cliente.
export default async function FlowyReviewsPage() {
  await requireDeveloperAdminPage()
  return <FlowyReviewsView />
}
