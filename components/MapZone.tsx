'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Polygon, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'

interface MapZoneProps {
  lat: number
  lng: number
  polygon?: [number, number][]
  transports?: Array<{ name: string; line: string; lat: number; lng: number }>
  pois?: Array<{ name: string; lat: number; lng: number }>
}

const LINE_COLORS: Record<string, { bg: string; text: string }> = {
  M1:  { bg: '#FFCD00', text: '#000' },
  M2:  { bg: '#003CA6', text: '#fff' },
  M3:  { bg: '#9F9825', text: '#fff' },
  M4:  { bg: '#BE418D', text: '#fff' },
  M5:  { bg: '#FF7E2E', text: '#fff' },
  M6:  { bg: '#6ECA97', text: '#000' },
  M7:  { bg: '#FA9ABA', text: '#000' },
  M8:  { bg: '#E19BDF', text: '#000' },
  M9:  { bg: '#B6BD00', text: '#000' },
  M10: { bg: '#C9910D', text: '#fff' },
  M11: { bg: '#704B1C', text: '#fff' },
  M12: { bg: '#007852', text: '#fff' },
  M13: { bg: '#98D4E2', text: '#000' },
  M14: { bg: '#6628B4', text: '#fff' },
  'RER A': { bg: '#E2231A', text: '#fff' },
  'RER B': { bg: '#5191CD', text: '#fff' },
  'RER C': { bg: '#F4CE00', text: '#000' },
  'RER D': { bg: '#00A650', text: '#fff' },
  'RER E': { bg: '#BA4A9D', text: '#fff' },
}

function makeTransportIcon(line: string) {
  const colors = LINE_COLORS[line] ?? { bg: '#555', text: '#fff' }
  const label = line.replace(/^M/, '').replace(/^RER /, '')
  return L.divIcon({
    html: `<div style="background:${colors.bg};color:${colors.text};width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;border:2.5px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.35);font-family:sans-serif">${label}</div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  })
}

function makePoiIcon() {
  return L.divIcon({
    html: `<div style="width:10px;height:10px;border-radius:50%;background:#f97316;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>`,
    className: '',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    popupAnchor: [0, -7],
  })
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

export default function MapZone({ lat, lng, polygon = [], transports = [], pois = [] }: MapZoneProps) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      style={{ width: '100%', height: '100%' }}
      zoomControl={false}
      attributionControl={false}
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
      {transports.map((t, i) => (
        <Marker key={`t-${i}`} position={[t.lat, t.lng]} icon={makeTransportIcon(t.line)}>
          <Popup>{t.name}</Popup>
        </Marker>
      ))}
      {pois.map((p, i) => (
        <Marker key={`p-${i}`} position={[p.lat, p.lng]} icon={makePoiIcon()}>
          <Popup>{p.name}</Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
