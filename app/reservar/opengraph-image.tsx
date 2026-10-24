// Imagen de la tarjeta del link /reservar (WhatsApp, Instagram, etc.).
//
// El logo de la marca es un banner ancho (1311x326): como imagen de tarjeta
// directa WhatsApp lo recorta o lo ignora. Acá se lo apoya centrado sobre un
// fondo oscuro en el formato que esperan esas apps (1200x630).

import { ImageResponse } from 'next/og'

export const alt = 'Reservá tu turno online'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 3600

async function logoDeLaMarca(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_booking_header`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { logo_url: string | null }[] | { logo_url: string | null } | null
    const row = Array.isArray(data) ? data[0] : data
    return row?.logo_url ?? null
  } catch {
    return null
  }
}

export default async function Image() {
  const logo = await logoDeLaMarca()
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#161616',
          color: '#ffffff',
        }}
      >
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" width={1200} height={298} style={{ width: 1200, height: 298 }} />
        )}
        <div style={{ display: 'flex', marginTop: logo ? 56 : 0, fontSize: 64, fontWeight: 700 }}>
          Reservá tu turno online
        </div>
        <div style={{ display: 'flex', marginTop: 16, fontSize: 32, color: '#b9b9b9' }}>
          Sin llamar y sin esperar
        </div>
      </div>
    ),
    size,
  )
}
