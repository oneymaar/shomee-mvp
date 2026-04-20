'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Polygon, useMap } from 'react-leaflet'

interface MapZoneProps {
  lat: number
  lng: number
  polygon?: [number, number][]
}

function FitBounds({ polygon }: { polygon: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (polygon.length > 0) {
      map.fitBounds(polygon as [number, number][], { padding: [32, 32] })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export default function MapZone({ lat, lng, polygon = [] }: MapZoneProps) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      style={{ width: '100%', height: '100%' }}
      zoomControl={false}
      attributionControl={false}
      scrollWheelZoom={false}
      dragging={false}
      touchZoom={false}
      doubleClickZoom={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
      />
      {polygon.length > 0 && (
        <>
          <Polygon
            positions={polygon}
            pathOptions={{
              color: '#7c3aed',
              fillColor: '#7c3aed',
              fillOpacity: 0.18,
              weight: 3,
              opacity: 0.85,
            }}
          />
          <FitBounds polygon={polygon} />
        </>
      )}
    </MapContainer>
  )
}
