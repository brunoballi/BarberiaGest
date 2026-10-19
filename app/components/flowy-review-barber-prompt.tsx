'use client'

import { useRef, useState } from 'react'
import {
  snoozeFlowyReviewPrompt,
  submitFlowyReview,
  uploadFlowyReviewPhoto,
} from '@/lib/supabase/supabase.client'
import { StarRating } from './star-rating'
import { TextInput } from './text-input'

interface Props {
  profileId: string
  branchId:  string
  fullName:  string
  onClose:   () => void
}

type Step = 'ask' | 'form' | 'done'

/** Popup de opinión para barberos: primero pregunta si quiere hacerla ahora,
 *  recién si dice que sí muestra el formulario completo. */
export function FlowyReviewBarberPrompt({ profileId, branchId, fullName, onClose }: Props) {
  const [step, setStep] = useState<Step>('ask')
  const [reviewerName, setReviewerName] = useState(fullName)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [snoozing, setSnoozing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isValid = rating > 0 && reviewerName.trim().length > 0

  async function handleNotNow() {
    setSnoozing(true)
    try {
      await snoozeFlowyReviewPrompt(profileId)
    } catch {
      // Si falla el snooze no bloqueamos el cierre: simplemente puede volver a
      // aparecer antes de lo esperado, no es grave.
    } finally {
      setSnoozing(false)
      onClose()
    }
  }

  function handlePickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function handleSubmit() {
    if (!isValid) { setError('Elegí una calificación y confirmá tu nombre.'); return }
    setError(null)
    setSubmitting(true)
    try {
      let photoUrl: string | null = null
      if (photoFile) {
        photoUrl = await uploadFlowyReviewPhoto(photoFile, `barber/${profileId}`)
      }
      await submitFlowyReview({
        kind: 'barber',
        branchId,
        reviewerName: reviewerName.trim(),
        rating,
        comment: comment.trim() || null,
        photoUrl,
      })
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error enviando tu opinión')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg p-6 space-y-6 animate-fadein max-h-[90vh] overflow-y-auto">
        {step === 'ask' && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <span className="text-4xl">⭐</span>
            <h2 className="text-white font-bold text-lg">¿Nos dejás tu opinión?</h2>
            <p className="text-zinc-400 text-sm">
              Queremos saber cómo te está yendo con el sistema. Es rápido: una calificación,
              tu nombre y, si querés, una foto tuya.
            </p>
            <div className="flex gap-3 w-full mt-2">
              <button onClick={handleNotNow} disabled={snoozing} className="btn-ghost flex-1">
                {snoozing ? 'Un momento...' : 'Ahora no'}
              </button>
              <button onClick={() => setStep('form')} className="btn-primary flex-1">
                Sí, dale
              </button>
            </div>
          </div>
        )}

        {step === 'form' && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-base">Tu opinión</h2>
              <button onClick={() => setStep('ask')} className="icon-btn"><span className="text-lg leading-none">✕</span></button>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div>
              <p className="section-label mb-2.5">Calificación</p>
              <StarRating value={rating} onChange={setRating} />
            </div>

            <div>
              <p className="section-label mb-2.5">Nombre y apellido</p>
              <TextInput
                value={reviewerName}
                onChange={setReviewerName}
                className="reason-input"
                maxLength={120}
              />
            </div>

            <div>
              <p className="section-label mb-2.5">Comentario <span className="text-zinc-600 font-normal normal-case">(opcional)</span></p>
              <TextInput
                allowNumbers
                value={comment}
                onChange={setComment}
                className="reason-input"
                placeholder="Contanos qué te parece..."
                maxLength={500}
              />
            </div>

            <div>
              <p className="section-label mb-2.5">Foto tuya <span className="text-zinc-600 font-normal normal-case">(opcional)</span></p>
              <div className="flex items-center gap-3">
                {photoPreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoPreview} alt="" className="w-14 h-14 rounded-xl object-cover border border-zinc-700" />
                )}
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePickPhoto} className="hidden" />
                <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-ghost">
                  {photoFile ? 'Cambiar foto' : 'Elegir foto'}
                </button>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting || !isValid}
              className="btn-primary w-full disabled:opacity-40"
            >
              {submitting ? 'Enviando...' : 'Enviar opinión'}
            </button>
          </>
        )}

        {step === 'done' && (
          <div className="text-center py-6 space-y-3">
            <div className="text-4xl">✓</div>
            <p className="text-emerald-400 font-semibold">¡Gracias por tu opinión!</p>
            <p className="text-zinc-400 text-sm">Ya quedó registrada.</p>
            <button onClick={onClose} className="btn-primary w-full mt-2">Cerrar</button>
          </div>
        )}
      </div>
    </div>
  )
}
