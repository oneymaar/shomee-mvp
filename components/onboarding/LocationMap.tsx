'use client'

import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'

interface LocationMapProps {
  lat: number
  lng: number
  radiusKm: number
}

function makeCenterIcon() {
  return L.divIcon({
    html: `<div style="width:14px;height:14px;border-radius:50%;background:#914E3C;border:3px solid white;box-shadow:0 2px 8px rgba(145,78,60,0.5)"></div>`,
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

function MapController({ lat, lng, radiusKm }: LocationMapProps) {
  const map = useMap()
  const markerRef = useRef<L.Marker | null>(null)
  const prevLatLng = useRef<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (prevLatLng.current?.lat === lat && prevLatLng.current?.lng === lng) return
    prevLatLng.current = { lat, lng }
    map.flyTo([lat, lng], getZoom(radiusKm), { duration: 0.8 })

    if (markerRef.current) markerRef.current.remove()
    markerRef.current = L.marker([lat, lng], { icon: makeCenterIcon() }).addTo(map)
  }, [lat, lng, map, radiusKm])

  useEffect(() => {
    return () => {
      markerRef.current?.remove()
    }
  }, [])

  return null
}

function getZoom(radiusKm: number): number {
  if (radiusKm <= 1) return 15
  if (radiusKm <= 2) return 14
  if (radiusKm <= 5) return 13
  if (radiusKm <= 10) return 12
  return 11
}

export default function LocationMap({ lat, lng, radiusKm }: LocationMapProps) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={getZoom(radiusKm)}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
      attributionControl={false}
      scrollWheelZoom={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
      <Circle
        center={[lat, lng]}
        radius={radiusKm * 1000}
        pathOptions={{
          color: '#914E3C',
          fillColor: '#914E3C',
          fillOpacity: 0.08,
          weight: 2,
          opacity: 0.5,
        }}
      />
      <MapController lat={lat} lng={lng} radiusKm={radiusKm} />
    </MapContainer>
  )
}
