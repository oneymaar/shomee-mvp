'use client'

import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Zone } from '@/lib/services/zoneService'

interface ZoneMapProps {
  center: [number, number]
  zoom: number
  zones: Zone[]
  selectedIds: string[]
  onToggle: (id: string) => void
}

function ZoneLayers({ zones, selectedIds, onToggle }: { zones: Zone[]; selectedIds: string[]; onToggle: (id: string) => void }) {
  const map = useMap()
  const markersRef = useRef<L.Marker[]>([])

  useEffect(() => {
    // Clear previous label markers
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    zones.forEach((zone) => {
      const isSelected = selectedIds.includes(zone.id)
      const icon = L.divIcon({
        html: `<div style="
          background:${isSelected ? '#914E3C' : 'white'};
          color:${isSelected ? 'white' : '#1a1a1a'};
          border:1.5px solid ${isSelected ? '#914E3C' : 'rgba(0,0,0,0.18)'};
          border-radius:20px;
          padding:3px 8px;
          font-size:11px;
          font-weight:600;
          white-space:nowrap;
          font-family:-apple-system,sans-serif;
          box-shadow:0 1px 4px rgba(0,0,0,0.12);
          pointer-events:none;
          user-select:none;
        ">${zone.shortLabel}</div>`,
        className: '',
        iconAnchor: [0, 0],
      })
      const marker = L.marker([zone.lat, zone.lng], { icon, interactive: false }).addTo(map)
      markersRef.current.push(marker)
    })

    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
    }
  }, [zones, selectedIds, map])

  return (
    <>
      {zones.map((zone) => {
        const isSelected = selectedIds.includes(zone.id)
        return (
          <Circle
            key={zone.id}
            center={[zone.lat, zone.lng]}
            radius={zone.radiusM}
            eventHandlers={{ click: () => onToggle(zone.id) }}
            pathOptions={{
              color: isSelected ? '#914E3C' : '#1a1a1a',
              fillColor: isSelected ? '#914E3C' : '#914E3C',
              fillOpacity: isSelected ? 0.18 : 0.03,
              weight: isSelected ? 2 : 1,
              opacity: isSelected ? 0.8 : 0.2,
            }}
          />
        )
      })}
    </>
  )
}

function FlyTo({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap()
  const prev = useRef<string>('')
  useEffect(() => {
    const key = `${center[0]},${center[1]},${zoom}`
    if (prev.current === key) return
    prev.current = key
    map.flyTo(center, zoom, { duration: 0.7 })
  }, [center, zoom, map])
  return null
}

export default function ZoneMap({ center, zoom, zones, selectedIds, onToggle }: ZoneMapProps) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
      <ZoneLayers zones={zones} selectedIds={selectedIds} onToggle={onToggle} />
      <FlyTo center={center} zoom={zoom} />
    </MapContainer>
  )
}
