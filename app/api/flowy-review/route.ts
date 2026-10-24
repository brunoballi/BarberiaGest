import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { sendFlowyReviewWebhook } from '@/lib/flowy-webhook'

interface ReviewPayload {
  kind: 'admin' | 'barber'
  branchId: string
  reviewerName: string
  rating: number
  comment?: string | null
  photoUrl?: string | null
}

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
    .select('id, role, is_barber')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 })

  let body: ReviewPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { kind, branchId, reviewerName, rating, comment, photoUrl } = body

  if (kind !== 'admin' && kind !== 'barber') {
    return NextResponse.json({ error: 'Tipo de reseña inválido' }, { status: 400 })
  }
  if (kind === 'admin' && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Solo un administrador puede dejar esta reseña' }, { status: 403 })
  }
  if (kind === 'barber' && profile.role !== 'barber' && !profile.is_barber) {
    return NextResponse.json({ error: 'Solo un barbero puede dejar esta reseña' }, { status: 403 })
  }
  if (!reviewerName?.trim()) {
    return NextResponse.json({ error: 'Falta el nombre y apellido' }, { status: 400 })
  }
  const ratingNum = Number(rating)
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return NextResponse.json({ error: 'La calificación debe ser de 1 a 5 estrellas' }, { status: 400 })
  }
  if (!branchId) {
    return NextResponse.json({ error: 'Falta la sucursal' }, { status: 400 })
  }

  const { data: inserted, error: insertError } = await serverClient
    .from('flowy_reviews')
    .insert({
      branch_id: branchId,
      kind,
      submitted_by: user.id,
      reviewer_name: reviewerName.trim().slice(0, 120),
      rating: ratingNum,
      comment: comment?.trim() ? comment.trim().slice(0, 1000) : null,
      photo_url: photoUrl ?? null,
    })
    .select('id, kind, reviewer_name, rating, comment, photo_url, created_at, branch:branches(name)')
    .single()

  if (insertError) {
    // El índice único (un barbero = una sola reseña) rebota acá si ya la había hecho.
    if (insertError.code === '23505') {
      return NextResponse.json({ ok: true, synced: false, error: 'Ya habías dejado tu reseña' })
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  const branch = Array.isArray(inserted.branch) ? inserted.branch[0] : inserted.branch

  // A la web va una sola reseña de admin por período de 6 meses. Si ya salió una, esta queda
  // guardada (interna, 'pending') y no se envía; se puede mandar a mano desde /admin/resenas.
  if (kind === 'admin') {
    const desde = new Date()
    desde.setMonth(desde.getMonth() - 6)
    const { count } = await serverClient
      .from('flowy_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'admin')
      .eq('sync_status', 'sent')
      .gte('created_at', desde.toISOString())
      .neq('id', inserted.id)
    if ((count ?? 0) > 0) {
      // sync_error = 'interna' la distingue de una pendiente por falta de configuración.
      await createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
        .from('flowy_reviews')
        .update({ sync_error: 'interna' })
        .eq('id', inserted.id)
      return NextResponse.json({ ok: true, synced: false, internal: true })
    }
  }

  const result = await sendFlowyReviewWebhook({
    id: inserted.id,
    kind: inserted.kind,
    branchName: branch?.name ?? null,
    reviewerName: inserted.reviewer_name,
    rating: inserted.rating,
    comment: inserted.comment,
    photoUrl: inserted.photo_url,
    createdAt: inserted.created_at,
  })

  // Actualizar sync_status requiere service role: la RLS de flowy_reviews solo
  // deja a los barberos insertar/leer su propia fila, no actualizarla.
  if (result.synced || process.env.FLOWY_REVIEWS_WEBHOOK_URL) {
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
      .eq('id', inserted.id)
  }

  return NextResponse.json({ ok: true, synced: result.synced })
}
