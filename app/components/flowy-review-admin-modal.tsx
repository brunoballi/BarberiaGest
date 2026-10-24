'use client'

import { useRef, useState } from 'react'
import { submitFlowyReview, uploadFlowyReviewPhoto } from '@/lib/supabase/supabase.client'
import { StarRating } from './star-rating'
import '@/app/admin/admin-dashboard.css'

interface Props {
  branchId:  string
  adminName: string
  onClose:   () => void
  /** Se llama cuando queda hecha (enviada u ofrecida) — ya no hay que volver a mostrarla. */
  onDone:    () => void
}

export function FlowyReviewAdminModal({ branchId, adminName, onClose, onDone }: Props) {
  const [reviewerName, setReviewerName] = useState(adminName)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isValid = rating > 0 && reviewerName.trim().length > 0

  function handlePickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function handleSubmit() {
    if (!isValid) { setError('Elegí una calificación y confirmá el nombre.'); return }
    setError(null)
    setSubmitting(true)
    try {
      let photoUrl: string | null = null
      if (photoFile) {
        photoUrl = await uploadFlowyReviewPhoto(photoFile, `admin/${branchId}`)
      }
      await submitFlowyReview({
        kind: 'admin',
        branchId,
        reviewerName: reviewerName.trim(),
        rating,
        comment: comment.trim() || null,
        photoUrl,
      })
      setDone(true)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error enviando la reseña')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{done ? '¡Gracias!' : 'Dejanos tu reseña'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {done ? (
          <div className="modal-body" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⭐</p>
            <p style={{ color: '#e4e4e7', marginBottom: '1.5rem' }}>
              Tu opinión ya quedó registrada. ¡Gracias por confiar en Flowi!
            </p>
            <button onClick={onClose} className="admin-btn admin-btn--primary">Cerrar</button>
          </div>
        ) : (
          <>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>
                ¿Cómo te está yendo con el sistema? Tu opinión nos ayuda muchísimo y aparece
                en la sección de reseñas de la web de Flowi.
              </p>

              {error && <p className="form-error">{error}</p>}

              <div>
                <label className="form-label">Calificación *</label>
                <StarRating value={rating} onChange={setRating} />
              </div>

              <div>
                <label className="form-label">Nombre y apellido *</label>
                <input
                  className="form-input"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  maxLength={120}
                  placeholder="Nombre y apellido"
                />
              </div>

              <div>
                <label className="form-label">Tu opinión <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Contanos tu experiencia con el sistema..."
                  maxLength={1000}
                />
              </div>

              <div>
                <label className="form-label">Foto del negocio o tuya <span style={{ color: '#52525b', fontWeight: 400 }}>(opcional)</span></label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {photoPreview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreview} alt="" style={{ width: 56, height: 56, borderRadius: '0.5rem', objectFit: 'cover', border: '1px solid #27272a' }} />
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePickPhoto} style={{ display: 'none' }} />
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="admin-btn admin-btn--ghost">
                    {photoFile ? 'Cambiar foto' : 'Elegir foto'}
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={onClose} className="admin-btn admin-btn--ghost">Ahora no</button>
              <button onClick={handleSubmit} disabled={submitting || !isValid} className="admin-btn admin-btn--primary">
                {submitting ? 'Enviando...' : 'Enviar reseña'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
