import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { sendFlowyReviewWebhook } from '@/lib/flowy-webhook'

/** Reintenta el envío a Flowy de una reseña 'pending'/'failed'. Solo admin. */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const serverClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )

  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await serverClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  let body: { id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'Falta el id de la reseña' }, { status: 400 })

  const { data: review, error: fetchError } = await serverClient
    .from('flowy_reviews')
    .select('id, kind, reviewer_name, rating, comment, photo_url, created_at, branch:branches(name)')
    .eq('id', body.id)
    .single()

  if (fetchError || !review) {
    return NextResponse.json({ error: 'Reseña no encontrada' }, { status: 404 })
  }

  const branch = Array.isArray(review.branch) ? review.branch[0] : review.branch

  const result = await sendFlowyReviewWebhook({
    id: review.id,
    kind: review.kind,
    branchName: branch?.name ?? null,
    reviewerName: review.reviewer_name,
    rating: review.rating,
    comment: review.comment,
    photoUrl: review.photo_url,
    createdAt: review.created_at,
  })

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  await adminClient
    .from('flowy_reviews')
    .update(
      result.synced
        ? { sync_status: 'sent', sent_at: new Date().toISOString(), sync_error: null }
        : { sync_status: 'failed', sync_error: result.error ?? null }
    )
    .eq('id', review.id)

  return NextResponse.json({ ok: true, synced: result.synced, error: result.error })
}
