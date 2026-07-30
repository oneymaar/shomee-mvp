'use client'

/**
 * Carte de quartier — jumelle web de
 * `apps/mobile/src/components/property/MapZone.tsx`.
 *
 * Le natif exécute Leaflet dans une WebView ; ici on parle à Leaflet
 * directement via react-leaflet, mais TOUT le rendu est aligné au pixel sur
 * l'app : fond Carto Voyager, contour d'IRIS terracotta, pastilles de station
 * blanches (badge de ligne + nom + temps de marche), repères de quartier en
 * pastilles colorées par catégorie, et AUCUN marqueur au centre — le bien
 * n'est jamais localisé précisément.
 *
 * Le composant est chargé en `dynamic(..., { ssr: false })` par la fiche : il
 * ne doit donc rien exporter dont la fiche ait besoin (la palette des repères
 * vit dans `lib/useNearbyPois.ts`), sinon Leaflet repart dans le bundle
 * serveur.
 */

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Polygon, Marker, CircleMarker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { POI_COLORS, type Poi, type PoiCat } from '@/lib/useNearbyPois'

export interface MapTransport {
  name: string
  line: string
  lat: number
  lng: number
  walkMin?: number
}

interface MapZoneProps {
  lat: number
  lng: number
  polygon?: [number, number][]
  transports?: MapTransport[]
  /** Repères catégorisés (hook `useNearbyPois`). */
  pois?: Poi[]
  /** Anciens `mapPois` en base, sans catégorie — affichés en « monument ». */
  legacyPois?: Array<{ name: string; lat: number; lng: number }>
  /** Hauteur du bloc. `'100%'` pour le plein écran. */
  height?: number | string
  /** `false` = carte décorative : aucun geste, aucun zoom, aucune bulle. */
  interactive?: boolean
  /**
   * `'near'` — cadrage serré sur le quartier (stations à ≤ 8 min à pied) ;
   * `'all'` — tout entre dans le cadre (utilisé en plein écran).
   */
  fit?: 'near' | 'all'
}

const ACCENT = '#A64B27'
const NEAR_WALK_MAX = 8 // minutes

/** Couleurs officielles des lignes — identiques au natif. */
const LINE_COLORS: Record<string, { bg: string; text: string }> = {
  M1: { bg: '#FFCD00', text: '#000' },
  M2: { bg: '#003CA6', text: '#fff' },
  M3: { bg: '#9F9825', text: '#fff' },
  M4: { bg: '#BE418D', text: '#fff' },
  M5: { bg: '#FF7E2E', text: '#fff' },
  M6: { bg: '#6ECA97', text: '#000' },
  M7: { bg: '#FA9ABA', text: '#000' },
  M8: { bg: '#E19BDF', text: '#000' },
  M9: { bg: '#B6BD00', text: '#000' },
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

/** Style des pastilles de station — repris tel quel de la WebView native. */
const PILL_CSS = `
.stPill{display:flex;align-items:center;background:#fff;border-radius:999px;padding:2px 8px 2px 2px;box-shadow:0 1px 4px rgba(0,0,0,.28);white-space:nowrap;font-family:inherit}
.stPill b{width:17px;height:17px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:800;margin-right:5px;flex:0 0 auto}
.stPill span{font-size:10px;font-weight:700;color:#1c1917}
.stPill em{font-style:normal;font-weight:600;color:#a8a29e;margin-left:4px}
.shomee-map .leaflet-container{background:#FDF5F2}
`

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Numéro affiché dans le badge : « M4 » → « 4 », « RER B » → « B ». */
function lineLabel(line: string): string {
  return line.replace(/^RER\s+/, '').replace(/^TN\s+/, '').replace(/^M/, '')
}

function lineColors(line: string): { bg: string; text: string } {
  if (LINE_COLORS[line]) return LINE_COLORS[line]
  if (/^TN\s/.test(line)) return { bg: '#8D5BA6', text: '#fff' }
  return { bg: '#555', text: '#fff' }
}

function makeStationIcon(t: MapTransport) {
  const c = lineColors(t.line)
  const num = lineLabel(t.line)
  const walk = t.walkMin != null ? `<em>${t.walkMin} min</em>` : ''
  const html =
    `<div class="stPill"><b style="background:${c.bg};color:${c.text}">${esc(num)}</b>` +
    `<span>${esc(t.name)}</span>${walk}</div>`
  const w = 30 + String(t.name).length * 5.4 + (t.walkMin != null ? 34 : 0)
  return L.divIcon({ html, className: '', iconSize: [w, 21], iconAnchor: [10, 10] })
}

/**
 * Cadrage : le centre, le contour d'IRIS et les stations retenues. En mode
 * `near`, les stations lointaines sont dessinées mais ne tirent pas le cadre.
 */
function FitBounds({
  lat,
  lng,
  polygon,
  transports,
  fit,
}: {
  lat: number
  lng: number
  polygon: [number, number][]
  transports: MapTransport[]
  fit: 'near' | 'all'
}) {
  const map = useMap()
  const signature = `${lat},${lng},${polygon.length},${transports.length},${fit}`

  useEffect(() => {
    const pts: [number, number][] = [[lat, lng]]
    for (const p of polygon) pts.push(p)
    for (const t of transports) {
      if (fit === 'all' || t.walkMin == null || t.walkMin <= NEAR_WALK_MAX) pts.push([t.lat, t.lng])
    }
    if (pts.length < 2) {
      map.setView([lat, lng], 15)
      return
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [26, 26], maxZoom: 16 })
    // `signature` résume les entrées : on ne recadre pas quand les repères
    // arrivent après coup (ils ne doivent pas déplacer la carte).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature])

  return null
}

export default function MapZone({
  lat,
  lng,
  polygon = [],
  transports = [],
  pois = [],
  legacyPois = [],
  height = 200,
  interactive = true,
  fit = 'near',
}: MapZoneProps) {
  const I = interactive

  // Les anciens repères sans catégorie rejoignent les « monuments » : ils
  // datent d'avant la classification et sont presque tous des lieux notables.
  const merged = useMemo<Poi[]>(
    () => [...pois, ...legacyPois.map((p) => ({ ...p, cat: 'monument' as PoiCat }))],
    [pois, legacyPois],
  )

  return (
    <div className="shomee-map w-full" style={{ height }}>
      <style>{PILL_CSS}</style>
      <MapContainer
        center={[lat, lng]}
        zoom={15}
        style={{ width: '100%', height: '100%', background: '#FDF5F2' }}
        zoomControl={I}
        attributionControl={false}
        dragging={I}
        touchZoom={I}
        doubleClickZoom={I}
        scrollWheelZoom={I}
        boxZoom={I}
        keyboard={I}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
        />

        {/* Contour de l'IRIS — le quartier, jamais l'adresse. */}
        {polygon.length > 0 && (
          <Polygon
            positions={polygon}
            pathOptions={{
              color: ACCENT,
              fillColor: ACCENT,
              fillOpacity: 0.13,
              weight: 2.4,
              opacity: 0.9,
            }}
            interactive={false}
          />
        )}

        {/* Repères de quartier — sous les stations, qui priment à l'œil. */}
        {merged.map((p, i) => (
          <CircleMarker
            key={`p-${i}-${p.name}`}
            center={[p.lat, p.lng]}
            radius={I ? 5 : 3.5}
            pathOptions={{
              color: '#fff',
              weight: 1.6,
              opacity: 1,
              fillColor: POI_COLORS[p.cat],
              fillOpacity: 1,
            }}
            interactive={I}
          >
            {I ? <Popup>{p.name}</Popup> : null}
          </CircleMarker>
        ))}

        {/* Stations — pastilles non cliquables, comme dans l'app. */}
        {transports.map((t, i) => (
          <Marker
            key={`t-${i}-${t.name}-${t.line}`}
            position={[t.lat, t.lng]}
            icon={makeStationIcon(t)}
            interactive={false}
            keyboard={false}
          />
        ))}

        <FitBounds lat={lat} lng={lng} polygon={polygon} transports={transports} fit={fit} />
      </MapContainer>
    </div>
  )
}
