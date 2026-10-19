// ============================================================
// Envío de reseñas a la web de Flowy (sección Reseñas).
// La URL todavía no está definida del lado de Flowy: mientras
// FLOWY_REVIEWS_WEBHOOK_URL no esté configurada, esto simplemente no
// intenta nada y la reseña queda 'pending' en flowy_reviews — no se
// pierde, se puede reintentar después desde /admin/resenas.
// ============================================================

export interface FlowyWebhookReview {
  id: string
  kind: 'admin' | 'barber'
  branchName: string | null
  reviewerName: string
  rating: number
  comment: string | null
  photoUrl: string | null
  createdAt: string
}

export interface FlowyWebhookResult {
  synced: boolean
  /** Motivo por el que no se sincronizó (falta config, timeout, respuesta con error, etc). */
  error?: string
}

/** Contrato JSON esperado por Flowy. Único lugar para ajustar cuando se defina el real. */
function buildPayload(review: FlowyWebhookReview) {
  return {
    id: review.id,
    tipo: review.kind, // 'admin' (dueño/administrador del negocio) | 'barber' (barbero)
    negocio: review.branchName ?? 'Valhalla',
    nombre_cliente: review.reviewerName,
    estrellas: review.rating,
    comentario: review.comment ?? '',
    foto_url: review.photoUrl,
    fecha: review.createdAt,
  }
}

export async function sendFlowyReviewWebhook(review: FlowyWebhookReview): Promise<FlowyWebhookResult> {
  const url = process.env.FLOWY_REVIEWS_WEBHOOK_URL
  if (!url) {
    return { synced: false, error: 'Todavía no se configuró FLOWY_REVIEWS_WEBHOOK_URL' }
  }

  const secret = process.env.FLOWY_REVIEWS_WEBHOOK_SECRET
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(buildPayload(review)),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { synced: false, error: `Flowy respondió ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}` }
    }
    return { synced: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error de red enviando a Flowy'
    return { synced: false, error: msg }
  } finally {
    clearTimeout(timeout)
  }
}
