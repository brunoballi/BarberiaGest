// Devuelve el buildId del deployment que está sirviendo ahora mismo.
// El cliente lo compara contra su propio NEXT_PUBLIC_BUILD_ID (horneado al
// build) para detectar que hay una versión nueva desplegada.
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? 'unknown' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}
