'use client'

import { useEffect, useRef } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './branches-map.css'

export interface MapBranch {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
}

/**
 * Mapa de las sucursales con coordenadas cargadas (097_encabezado_y_mapa_reserva.sql).
 * OpenStreetMap + Leaflet: sin API key ni facturación, a diferencia de
 * Google Maps JS API. Las que no tienen latitude/longitude simplemente no
 * aparecen -- no hay geocoding automático, el admin las pega a mano en
 * /admin/marca.
 *
 * Leaflet toca el DOM directo y depende de `window`, por eso se importa
 * recién acá adentro (nunca en el server) y el componente entero asume
 * 'use client'.
 */
export default function BranchesMap({ branches }: { branches: MapBranch[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)

  useEffect(() => {
    const puntos = branches.filter(
      (b): b is MapBranch & { latitude: number; longitude: number } =>
        b.latitude != null && b.longitude != null
    )
    if (puntos.length === 0 || !containerRef.current) return

    let cancelado = false

    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelado || !containerRef.current) return

      // Los íconos default de Leaflet apuntan a rutas relativas que un
      // bundler (Turbopack/webpack) no resuelve -- problema conocido, se
      // arregla apuntando a los mismos assets servidos por unpkg.
      delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(containerRef.current, { scrollWheelZoom: false })
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      puntos.forEach((b) => {
        L.marker([b.latitude, b.longitude])
          .addTo(map)
          .bindPopup(`<strong>${b.name}</strong>${b.address ? `<br>${b.address}` : ''}`)
      })

      if (puntos.length === 1) {
        map.setView([puntos[0].latitude, puntos[0].longitude], 15)
      } else {
        map.fitBounds(
          L.latLngBounds(puntos.map((b) => [b.latitude, b.longitude])),
          { padding: [28, 28] }
        )
      }
    })()

    return () => {
      cancelado = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches.map((b) => `${b.id}:${b.latitude}:${b.longitude}`).join(',')])

  const hayCoords = branches.some((b) => b.latitude != null && b.longitude != null)
  if (!hayCoords) return null

  return <div ref={containerRef} className="bk-map" role="img" aria-label="Mapa de sucursales" />
}
