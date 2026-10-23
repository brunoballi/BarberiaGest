'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentProfile, listFlowyReviews, retryFlowyReviewSync } from '@/lib/supabase/supabase.client'
import type { FlowyReviewWithBranch } from '@/lib/supabase/database.types'
import '../admin-dashboard.css'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function statusBadge(status: FlowyReviewWithBranch['sync_status']) {
  if (status === 'sent') return <span className="badge badge--green">Enviada a Flowi</span>
  if (status === 'failed') return <span className="badge badge--red">Falló el envío</span>
  return <span className="badge badge--gray">Pendiente de enviar</span>
}

export default function FlowyReviewsView() {
  const router = useRouter()
  const [reviews, setReviews] = useState<FlowyReviewWithBranch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const profile = await getCurrentProfile()
      if (!profile || profile.role !== 'admin') {
        router.replace('/login')
        return
      }
      setReviews(await listFlowyReviews())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando las reseñas')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { load() }, [load])

  async function handleRetry(id: string) {
    setRetryError(null)
    setRetryingId(id)
    try {
      const res = await retryFlowyReviewSync(id)
      if (!res.synced && res.error) setRetryError(res.error)
      await load()
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : 'Error reintentando el envío')
    } finally {
      setRetryingId(null)
    }
  }

  if (loading) return (
    <div className="admin-app flex-center">
      <div className="admin-loader" />
    </div>
  )

  if (error) return (
    <div className="admin-app flex-center">
      <div className="error-box">
        <p className="error-msg">{error}</p>
        <button onClick={() => { setError(null); load() }} className="admin-btn admin-btn--primary">Reintentar</button>
      </div>
    </div>
  )

  const pendingCount = reviews.filter((r) => r.sync_status !== 'sent').length

  return (
    <div className="admin-app">
      <div className="admin-header-wrapper">
        <div className="admin-brand-bar">
          <span className="admin-logo">VALHALLA</span>
          <span className="admin-badge">Admin</span>
          <span className="admin-brand-separator">·</span>
          <span className="admin-brand-branch">Reseñas Flowi</span>
        </div>
      </div>

      <main className="admin-content">
        {pendingCount > 0 && (
          <div style={{ background: '#78350f33', border: '1px solid #b45309', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#fcd34d' }}>
            Hay reseñas sin enviar a la web de Flowi. Si todavía no configuraste la URL de destino
            (variable <code>FLOWY_REVIEWS_WEBHOOK_URL</code>) es normal: no se pierden, quedan acá
            abajo y podés mandarlas con &quot;Reintentar&quot; en cuanto esté lista.
          </div>
        )}

        <div className="admin-table-wrap">
          <div className="table-toolbar">
            <span className="toolbar-total">
              {reviews.length} reseña{reviews.length !== 1 ? 's' : ''}
              {pendingCount > 0 && ` · ${pendingCount} sin enviar a Flowi`}
            </span>
          </div>

          {retryError && (
            <div style={{ background: '#7f1d1d33', border: '1px solid #b91c1c', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', marginBottom: '0.75rem', fontSize: '0.85rem', color: '#fecaca' }}>
              {retryError}
            </div>
          )}

          {reviews.length === 0 ? (
            <div className="empty-state"><p>Todavía no hay reseñas registradas.</p></div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Nombre</th>
                  <th>Sucursal</th>
                  <th>Calificación</th>
                  <th>Comentario</th>
                  <th>Foto</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.id}>
                    <td className="td-left">{formatDate(r.created_at)}</td>
                    <td>
                      <span className={`badge ${r.kind === 'admin' ? 'badge--violet' : 'badge--blue'}`}>
                        {r.kind === 'admin' ? 'Admin' : 'Barbero'}
                      </span>
                    </td>
                    <td className="td-left">{r.reviewer_name}</td>
                    <td className="td-left">{r.branch?.name ?? <span className="td-na">—</span>}</td>
                    <td>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</td>
                    <td className="td-left" style={{ maxWidth: '260px', whiteSpace: 'normal' }}>
                      {r.comment || <span className="td-na">—</span>}
                    </td>
                    <td>
                      {r.photo_url ? (
                        <a href={r.photo_url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.photo_url} alt="" style={{ width: 40, height: 40, borderRadius: '0.4rem', objectFit: 'cover', border: '1px solid #27272a' }} />
                        </a>
                      ) : <span className="td-na">—</span>}
                    </td>
                    <td>{statusBadge(r.sync_status)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.sync_status !== 'sent' && (
                        <button
                          onClick={() => handleRetry(r.id)}
                          disabled={retryingId === r.id}
                          className="admin-btn admin-btn--ghost"
                          style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
                        >
                          {retryingId === r.id ? 'Enviando...' : '↻ Reintentar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  )
}
