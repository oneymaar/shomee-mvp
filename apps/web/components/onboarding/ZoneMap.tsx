'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { GeoZone } from '@shomee/core/geo/geoDataService'
import rawStations from '@shomee/core/data/transportStations.json'

type RawStation = { label: string; type: string; lines: string[]; coordinates: { lat: number; lng: number } }

// Only metro + RER stations (no tram, no Transilien)
const MAP_STATIONS_RAW = (rawStations as RawStation[])
  .filter(s => s.type === 'metro_station' || s.type === 'rer_station')

/**
 * IDFM records each physical entrance separately (e.g. Concorde M1/M12 and M8
 * are 300m apart → separate entries). Merge entries with the same label that
 * are within 800m of each other: running-average centroid + union of lines.
 */
function mergeNearbyStations(stations: RawStation[]): RawStation[] {
  type M = RawStation & { _count: number }
  const result: M[] = []
  for (const s of stations) {
    const match = result.find(r => {
      if (r.label !== s.label) return false
      const dLat = (r.coordinates.lat - s.coordinates.lat) * 111_000
      const dLng = (r.coordinates.lng - s.coordinates.lng) * 111_000 * Math.cos(r.coordinates.lat * Math.PI / 180)
      return Math.sqrt(dLat * dLat + dLng * dLng) < 800
    })
    if (match) {
      const n = match._count
      match.coordinates.lat = (match.coordinates.lat * n + s.coordinates.lat) / (n + 1)
      match.coordinates.lng = (match.coordinates.lng * n + s.coordinates.lng) / (n + 1)
      match._count = n + 1
      for (const l of s.lines) if (!match.lines.includes(l)) match.lines.push(l)
      if (s.type === 'metro_station') match.type = 'metro_station' // metro takes priority
    } else {
      result.push({ ...s, lines: [...s.lines], _count: 1 })
    }
  }
  return result
}

const MAP_STATIONS = mergeNearbyStations(MAP_STATIONS_RAW)

// ─── RATP line colors ───────────────────────────────────────────────────────
const RATP_LINE: Record<string, { bg: string; fg: string }> = {
  '1':  { bg: '#FFCD00', fg: '#000' }, '2':  { bg: '#003CA6', fg: '#fff' },
  '3':  { bg: '#837902', fg: '#fff' }, '3b': { bg: '#6EC4E8', fg: '#000' },
  '4':  { bg: '#CF009E', fg: '#fff' }, '5':  { bg: '#FF7E2E', fg: '#fff' },
  '6':  { bg: '#6ECA97', fg: '#000' }, '7':  { bg: '#FA9ABA', fg: '#000' },
  '7b': { bg: '#6ECA97', fg: '#000' }, '8':  { bg: '#E19BDF', fg: '#000' },
  '9':  { bg: '#B6BD00', fg: '#000' }, '10': { bg: '#C9910D', fg: '#fff' },
  '11': { bg: '#704B1C', fg: '#fff' }, '12': { bg: '#007852', fg: '#fff' },
  '13': { bg: '#98D4E2', fg: '#000' }, '14': { bg: '#62259D', fg: '#fff' },
  'A':  { bg: '#FF0000', fg: '#fff' }, 'B':  { bg: '#5191CD', fg: '#fff' },
  'C':  { bg: '#FFDD00', fg: '#000' }, 'D':  { bg: '#009900', fg: '#fff' },
  'E':  { bg: '#C04191', fg: '#fff' },
}

function stationPopupHTML(name: string, lines: string[]): string {
  const circles = lines.map(l => {
    const c = RATP_LINE[l] ?? { bg: '#888', fg: '#fff' }
    // font-size: 3-char labels (RER lines) get 7px, 1-2 char labels get 9px
    const fs = l.length >= 3 ? 7 : 9
    return `<div style="width:20px;height:20px;border-radius:50%;background:${c.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <span style="font-size:${fs}px;font-weight:900;color:${c.fg};font-family:system-ui,sans-serif;line-height:1;letter-spacing:-0.3px">${l}</span>
    </div>`
  }).join('')
  return `<div style="font-family:system-ui,sans-serif">
    <div style="font-weight:700;font-size:13px;color:#111;margin-bottom:5px">${name}</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">${circles}</div>
  </div>`
}

/** Build the map icon HTML for a station marker.
 *  Mixed metro+RER → two circles side by side. */
function stationIconHTML(name: string, isMet: boolean, isRer: boolean): string {
  const circle = (label: string) => {
    const isRerLabel = label === 'RER'
    // M : fond blanc, contour bleu, texte bleu
    // RER : fond bleu, texte blanc (plus lisible à petite taille)
    const bg     = isRerLabel ? '#003189' : '#fff'
    const border = isRerLabel ? 'none'    : '2px solid #003189'
    const color  = isRerLabel ? '#fff'    : '#003189'
    const fs     = isRerLabel ? '6.5px'   : '8px'
    return `<div style="width:16px;height:16px;border-radius:50%;background:${bg};border:${border};display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.22)">
      <span style="color:${color};font-size:${fs};font-weight:900;font-family:system-ui,sans-serif;line-height:1;letter-spacing:-0.4px">${label}</span>
    </div>`
  }
  const badges = (isMet && isRer)
    ? `<div style="display:flex;gap:2px">${circle('M')}${circle('RER')}</div>`
    : circle(isRer ? 'RER' : 'M')
  return `<div style="user-select:none;display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-40%);cursor:pointer">
    ${badges}
    <span style="margin-top:2px;font-size:9px;color:#111;font-family:system-ui,sans-serif;font-weight:600;white-space:nowrap;line-height:1.2;max-width:80px;overflow:hidden;text-overflow:ellipsis;text-align:center;text-shadow:0 0 3px #fff,0 0 4px #fff,0 0 5px #fff">${name}</span>
  </div>`
}

// ─── Visual styles ─────────────────────────────────────────────────────────

type ZoneState = 'unselected' | 'selected' | 'partial'

function topLevelStyle(state: ZoneState): L.PathOptions {
  switch (state) {
    case 'selected':  return { color: '#A64B27', fillColor: '#A64B27', fillOpacity: 0.16, weight: 2.5, opacity: 0.9 }
    case 'partial':   return { color: '#A64B27', fillColor: '#A64B27', fillOpacity: 0.05, weight: 2, opacity: 0.55, dashArray: '7 4' }
    case 'unselected':return { color: '#444', fillColor: 'transparent', fillOpacity: 0, weight: 1, opacity: 0.18 }
  }
}

function quartierStyle(state: ZoneState): L.PathOptions {
  switch (state) {
    case 'selected':  return { color: '#A64B27', fillColor: '#A64B27', fillOpacity: 0.22, weight: 1.8, opacity: 0.85 }
    case 'partial':   return { color: '#A64B27', fillColor: '#A64B27', fillOpacity: 0.06, weight: 1.5, opacity: 0.5, dashArray: '5 3' }
    case 'unselected':return { color: '#555', fillColor: 'transparent', fillOpacity: 0, weight: 0.8, opacity: 0.22 }
  }
}

// At zoom < 14 (arrondissement level), quartiers are not individually interactive.
// Selected: solid fill, no border → adjacent QAs fuse into one shape.
// Partial/unselected: fully invisible → IRIS layer handles partial areas.
function quartierStyleLowZoom(state: ZoneState): L.PathOptions {
  if (state === 'selected') return { fillColor: '#A64B27', fillOpacity: 0.18, weight: 0, opacity: 0 }
  return { fillOpacity: 0, weight: 0, opacity: 0 }
}

function irisStyle(selected: boolean): L.PathOptions {
  return selected
    ? { color: '#A64B27', fillColor: '#A64B27', fillOpacity: 0.28, weight: 1.5, opacity: 0.9 }
    : { color: '#777', fillColor: 'transparent', fillOpacity: 0, weight: 0.6, opacity: 0.3 }
}

// At zoom < 15 (not the natural IRIS zoom), show selected IRIS as a solid merged area:
// weight:0 removes borders between adjacent selected zones so they fuse into one shape.
// Unselected IRIS are fully transparent — invisible at low zoom (no visual noise).
function irisStyleLowZoom(selected: boolean): L.PathOptions {
  return selected
    ? { color: '#A64B27', fillColor: '#A64B27', fillOpacity: 0.22, weight: 0, opacity: 0 }
    : { fillColor: 'transparent', fillOpacity: 0, weight: 0, opacity: 0 }
}

// ─── Labels — text only, centered, no background ──────────────────────────

function makeLabel(text: string, state: ZoneState | 'selected' | 'unselected', fontSize = 11, bold = true): L.DivIcon {
  const isSelected = state === 'selected'
  const color = isSelected ? '#A64B27' : '#2a2a2a'
  return L.divIcon({
    html: `<div style="
      display:inline-block;
      transform:translate(-50%,-50%);
      color:${color};
      font-size:${fontSize}px;
      font-weight:${bold ? 700 : 500};
      white-space:nowrap;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      text-shadow:0 1px 3px rgba(255,255,255,0.95),0 0 6px rgba(255,255,255,0.8);
      pointer-events:none;
      user-select:none;
      line-height:1.4;
      letter-spacing:-0.01em;
    ">${text}</div>`,
    className: 'shomee-zone-label',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

// ─── Centroid helpers ──────────────────────────────────────────────────────

function layerCenter(l: L.Layer): L.LatLng | null {
  try {
    if (l instanceof L.Polygon || l instanceof L.Polyline) return l.getBounds().getCenter()
  } catch { /* skip */ }
  return null
}

// ─── Imperative GeoJSON layer ──────────────────────────────────────────────

interface GeoLayerConfig {
  zones: GeoZone[]
  getPathStyle: (zone: GeoZone) => L.PathOptions
  getLabelState: (zone: GeoZone) => ZoneState | 'selected' | 'unselected'
  fontSize: number
  onClick: (zone: GeoZone) => void
  visible: boolean
  /**
   * Opaque string that changes only when the selection state affecting this layer changes.
   * Gates the style-refresh effect so it never runs during zoom/pan re-renders.
   */
  styleKey: string
  /** Pre-computed boolean: labels visible. Changes only at zoom thresholds, not on every tick. */
  showLabels: boolean
  /**
   * Optional per-zone label visibility predicate. When provided, a marker is
   * only shown if showLabels is true AND labelFilter returns true. Used to
   * thin out crowded label sets at intermediate zoom levels (e.g. only the
   * largest communes at zoom 11, all of them at zoom 12+).
   */
  labelFilter?: (zone: GeoZone) => boolean
  /**
   * Opaque key whose change re-runs the per-marker visibility pass. Must
   * change whenever labelFilter's effective output changes (function
   * identity isn't enough — useCallback works too but a string key keeps
   * the effect deps array stable).
   */
  labelFilterKey?: string
  /**
   * When false, all SVG paths in this layer get pointer-events:none so clicks fall
   * through to the layer underneath. Used to restore correct click targets when
   * sticky-visible layers are shown outside their natural interactive zoom range.
   */
  clickable: boolean
}

/**
 * Toggle pointer-events on a GeoJSON layer's SVG paths.
 *
 * L.Path.setStyle({ interactive:false }) only sets the SVG *attribute*
 * pointer-events:none, but the CSS class `leaflet-interactive` remains,
 * which overrides the attribute (CSS > SVG presentation attributes).
 * We must remove the class AND set the attribute to really disable clicks.
 */
function applyInteractive(layer: L.GeoJSON, clickable: boolean) {
  layer.eachLayer((l) => {
    if (!(l instanceof L.Path)) return
    const path = (l as unknown as { _path?: SVGElement })._path
    if (!path) return
    if (clickable) {
      path.removeAttribute('pointer-events')
      path.classList.add('leaflet-interactive')
    } else {
      path.setAttribute('pointer-events', 'none')
      path.classList.remove('leaflet-interactive')
    }
  })
}

function useGeoLayer(map: L.Map, cfg: GeoLayerConfig) {
  const layerRef = useRef<L.GeoJSON | null>(null)
  const labelsRef = useRef<L.Marker[]>([])
  const zoneMarkerMapRef = useRef<Map<string, L.Marker>>(new Map())
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg

  // ── Effect 1: rebuild GeoJSON layer when zone geometry changes ────────────
  useEffect(() => {
    layerRef.current?.remove()
    labelsRef.current.forEach((m) => m.remove())
    labelsRef.current = []
    if (!cfg.zones.length) return

    const layer = L.geoJSON(
      { type: 'FeatureCollection', features: cfg.zones.map((z) => z.feature) } as GeoJSON.FeatureCollection,
      {
        style: (f) => {
          const zone = cfg.zones.find((z) => z.id === f?.properties?._zoneId)
          return zone ? cfg.getPathStyle(zone) : {}
        },
        onEachFeature: (f, l) => {
          l.on('click', (e) => {
            // Guard: if this layer is not in its interactive zoom range, let
            // the click fall through to the layer underneath.
            if (!cfgRef.current.clickable) return
            L.DomEvent.stopPropagation(e)
            const zone = cfg.zones.find((z) => z.id === f.properties?._zoneId)
            if (zone) cfgRef.current.onClick(zone)
          })
        },
      }
    )
    if (cfg.visible) {
      layer.addTo(map)
      // Immediately enforce interactive state — Effect 4 won't re-run when
      // cfg.clickable didn't change in value (new layer, same zoom range).
      applyInteractive(layer, cfgRef.current.clickable)
    }
    layerRef.current = layer
    rebuildLabels(layer, cfg.zones)

    return () => {
      layer.remove()
      labelsRef.current.forEach((m) => m.remove())
      labelsRef.current = []
      zoneMarkerMapRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.zones, map])

  // ── Effect 2: update styles + label colors when selection changes ─────────
  // styleKey changes ONLY when the selection arrays change, not on zoom/pan.
  // This prevents setStyle() from running during Leaflet's SVG redraws.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.eachLayer((l) => {
      if (!(l instanceof L.Path)) return
      const f = (l as any).feature as GeoJSON.Feature | undefined
      const zone = cfgRef.current.zones.find((z) => z.id === f?.properties?._zoneId)
      if (zone) l.setStyle(cfgRef.current.getPathStyle(zone))
    })
    // Update label icons in-place — no DOM add/remove, just icon swap
    cfgRef.current.zones.forEach((zone) => {
      const marker = zoneMarkerMapRef.current.get(zone.id)
      if (!marker) return
      const st = cfgRef.current.getLabelState(zone)
      marker.setIcon(makeLabel(zone.shortName, st, cfgRef.current.fontSize))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.styleKey])

  // ── Effect 3: toggle layer + labels visibility ────────────────────────────
  // Fast: only adds/removes from map. Deps are booleans/strings that change
  // only at threshold crossings, not on every zoom tick — avoids O(n) marker
  // work. When labelFilter is set, per-marker visibility is recomputed
  // whenever labelFilterKey changes (e.g. crossing the "thin labels" tier).
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    if (cfg.visible && !map.hasLayer(layer)) map.addLayer(layer)
    else if (!cfg.visible && map.hasLayer(layer)) map.removeLayer(layer)

    const filter = cfgRef.current.labelFilter
    for (const zone of cfgRef.current.zones) {
      const marker = zoneMarkerMapRef.current.get(zone.id)
      if (!marker) continue
      const passes = filter ? filter(zone) : true
      const shouldShow = cfg.showLabels && passes
      if (shouldShow && !map.hasLayer(marker)) map.addLayer(marker)
      else if (!shouldShow && map.hasLayer(marker)) map.removeLayer(marker)
    }
  }, [cfg.visible, cfg.showLabels, cfg.labelFilterKey, map])

  // ── Effect 4: toggle pointer-events when clickable changes ────────────────
  // Uses applyInteractive() which removes the leaflet-interactive CSS class
  // AND sets pointer-events:none — both are required because CSS overrides
  // the SVG presentation attribute if the class is still present.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    applyInteractive(layer, cfg.clickable)
  }, [cfg.clickable])

  function rebuildLabels(layer: L.GeoJSON, zones: GeoZone[]) {
    labelsRef.current.forEach((m) => m.remove())
    labelsRef.current = []
    zoneMarkerMapRef.current.clear()
    const showLabels = cfgRef.current.showLabels
    const filter = cfgRef.current.labelFilter
    layer.eachLayer((l) => {
      if (!(l instanceof L.Path)) return
      const f = (l as any).feature as GeoJSON.Feature | undefined
      const zone = zones.find((z) => z.id === f?.properties?._zoneId)
      const center = layerCenter(l)
      if (!zone || !center) return
      const st = cfgRef.current.getLabelState(zone)
      const marker = L.marker(center, {
        icon: makeLabel(zone.shortName, st, cfgRef.current.fontSize),
        interactive: false,
        zIndexOffset: 300,
      })
      const passes = filter ? filter(zone) : true
      if (showLabels && passes) marker.addTo(map)
      labelsRef.current.push(marker)
      zoneMarkerMapRef.current.set(zone.id, marker)
    })
  }
}

// ─── GeoLayers — owns live zoom via useMapEvents ───────────────────────────

interface GeoLayersProps {
  arrondissements: GeoZone[]
  quartiers: GeoZone[]
  iris: GeoZone[]
  communes: GeoZone[]
  selectedArrIds: string[]
  selectedQuartierIds: string[]
  selectedIrisIds: string[]
  selectedCommuneIds: string[]
  onClickArr: (z: GeoZone) => void
  onClickQuartier: (z: GeoZone) => void
  onClickIris: (z: GeoZone) => void
  onClickCommune: (z: GeoZone) => void
  onClickCommuneIris: (z: GeoZone) => void
  irisLoading: boolean
  showIrisNames?: boolean
  onZoomChange: (z: number) => void
}

function computeArrState(id: string, allQuartiers: GeoZone[], allIris: GeoZone[], state: { selectedArrIds: string[]; selectedQuartierIds: string[]; selectedIrisIds: string[] }): ZoneState {
  if (state.selectedArrIds.includes(id)) return 'selected'
  const childQu = allQuartiers.filter((q) => q.parentId === id)
  if (childQu.length === 0) return 'unselected'
  const selQu = childQu.filter((q) => state.selectedQuartierIds.includes(q.id))
  const partialQu = childQu.filter((q) => {
    const childIris = allIris.filter((i) => i.parentId === q.id)
    return childIris.length > 0 && childIris.some((i) => state.selectedIrisIds.includes(i.id)) && !state.selectedQuartierIds.includes(q.id)
  })
  if (selQu.length === childQu.length) return 'selected'
  if (selQu.length > 0 || partialQu.length > 0) return 'partial'
  return 'unselected'
}

function computeQuartierState(id: string, allIris: GeoZone[], state: { selectedQuartierIds: string[]; selectedIrisIds: string[] }): ZoneState {
  if (state.selectedQuartierIds.includes(id)) return 'selected'
  const childIris = allIris.filter((i) => i.parentId === id)
  if (childIris.length === 0) return 'unselected'
  const selIris = childIris.filter((i) => state.selectedIrisIds.includes(i.id))
  if (selIris.length === childIris.length) return 'selected'
  if (selIris.length > 0) return 'partial'
  return 'unselected'
}

/**
 * Cheap centroid (mean of the longest outer ring's vertices). Sufficient
 * for ranking and angular bucketing — we don't need a true mass centroid.
 */
function polygonCentroid(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const outers: GeoJSON.Position[][] =
    geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.type === 'MultiPolygon' ? geom.coordinates.map(p => p[0])
    : []
  let best: GeoJSON.Position[] = outers[0] ?? []
  for (const r of outers) if (r.length > best.length) best = r
  if (best.length === 0) return [0, 0]
  let sx = 0, sy = 0
  for (const p of best) { sx += p[0]; sy += p[1] }
  return [sx / best.length, sy / best.length]
}

interface CommuneCentroid {
  id: string
  centroid: [number, number] // [lng, lat]
}

/**
 * Pick a geographically-spread subset of items around a reference point.
 *
 * Angular bucketing: each item is binned by its centroid's bearing from
 * the reference. Within each sector the closest items win, filled round-
 * robin until we hit the target count. Result: every cardinal direction
 * is represented AND the closest items are favoured over distant ones —
 * much better than "biggest by area" (which lets far-but-large items win)
 * and adapts to the current map centre instead of a fixed Paris anchor.
 */
function pickSpreadByCentroid(
  items: CommuneCentroid[],
  refLngLat: [number, number],
  targetCount: number,
  sectorCount = 8,
): Set<string> {
  if (items.length === 0 || targetCount <= 0) return new Set()
  const enriched = items.map(it => {
    const dx = it.centroid[0] - refLngLat[0]
    const dy = it.centroid[1] - refLngLat[1]
    return {
      id: it.id,
      dist: Math.sqrt(dx * dx + dy * dy),
      sector: Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * sectorCount) % sectorCount,
    }
  })
  const buckets: Array<typeof enriched> = Array.from({ length: sectorCount }, () => [])
  for (const e of enriched) buckets[e.sector].push(e)
  for (const b of buckets) b.sort((a, b) => a.dist - b.dist)

  const picked = new Set<string>()
  for (let lap = 0; picked.size < targetCount; lap++) {
    let progressed = false
    for (const b of buckets) {
      if (lap < b.length) {
        picked.add(b[lap].id)
        progressed = true
        if (picked.size >= targetCount) break
      }
    }
    if (!progressed) break
  }
  return picked
}

function computeCommuneState(id: string, communeIris: GeoZone[], state: { selectedCommuneIds: string[]; selectedIrisIds: string[] }): ZoneState {
  if (state.selectedCommuneIds.includes(id)) return 'selected'
  const childIris = communeIris.filter((i) => i.parentId === id)
  if (childIris.length === 0) return 'unselected'
  const selIris = childIris.filter((i) => state.selectedIrisIds.includes(i.id))
  if (selIris.length === childIris.length) return 'selected'
  if (selIris.length > 0) return 'partial'
  return 'unselected'
}

function GeoLayers(props: GeoLayersProps) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  // Tracks the visible viewport — used by the thin-mode label picker so the
  // set follows the user as they pan, instead of staying locked to whatever
  // happened to be near Paris on first paint.
  const [viewBounds, setViewBounds] = useState<L.LatLngBounds>(() => map.getBounds())

  useMapEvents({
    zoomend: () => {
      const z = map.getZoom()
      setZoom(z)
      setViewBounds(map.getBounds())
      props.onZoomChange(z)
    },
    moveend: () => setViewBounds(map.getBounds()),
  })

  const { arrondissements, quartiers, iris, communes, selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds, onClickArr, onClickQuartier, onClickIris, onClickCommune, onClickCommuneIris, irisLoading } = props
  const sel = { selectedArrIds, selectedQuartierIds, selectedIrisIds }
  const comSel = { selectedCommuneIds, selectedIrisIds }

  const parisIris = useMemo(() => iris.filter((i) => !i.parentId?.startsWith('com-')), [iris])
  const communeIris = useMemo(() => iris.filter((i) => i.parentId?.startsWith('com-')), [iris])

  // Precompute commune centroids once — used by the viewport-aware label
  // picker below. The centroids themselves don't change unless the commune
  // dataset is reloaded.
  const communeCentroids = useMemo<CommuneCentroid[]>(
    () => communes.map(c => ({
      id: c.id,
      centroid: polygonCentroid(c.feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon),
    })),
    [communes],
  )

  // Thin-mode label set at zoom 11: restricted to communes whose centroid
  // sits inside the current viewport (padded slightly to catch communes
  // whose polygon spills into the visible area), then angular-bucketed
  // around the *current* viewport centre. Capped at MAX_THIN_LABELS so the
  // map never feels noisy. Updates on pan + zoom.
  const MAX_THIN_LABELS = 8
  const thinCommuneLabels = zoom < 12
  const thinLabeledSet = useMemo<Set<string> | null>(() => {
    if (!thinCommuneLabels) return null
    const padded = viewBounds.pad(0.1)
    const visible = communeCentroids.filter(c =>
      padded.contains([c.centroid[1], c.centroid[0]]),  // L.LatLngBounds.contains expects [lat, lng]
    )
    if (visible.length === 0) return new Set()
    const center = viewBounds.getCenter()
    const target = Math.min(MAX_THIN_LABELS, visible.length)
    return pickSpreadByCentroid(visible, [center.lng, center.lat], target)
  }, [thinCommuneLabels, communeCentroids, viewBounds])

  // Stable key for the labelFilter effect — changes only when the picked
  // set's identity changes, not on every render.
  const thinLabelKey = useMemo(
    () => (thinLabeledSet ? Array.from(thinLabeledSet).sort().join('|') : 'all'),
    [thinLabeledSet],
  )

  // "Sticky selection" flags: layers with active selections stay visible when zooming out
  // so the user always sees their selection mosaic, regardless of zoom level.
  const hasSelectedIris      = selectedIrisIds.length > 0
  const hasSelectedQuartiers = selectedQuartierIds.length > 0

  // Zoom thresholds
  // Paris:   ≥15 IRIS  |  13-14 QA  |  ≤12 arrondissements
  // Suburbs: ≥15 IRIS  |  ≤14 communes
  const showTopLevel    = zoom <= 12
  // IRIS: visible at zoom ≥15, AND always visible once some IRIS are selected (sticky)
  const showCommuneIris = !irisLoading && (zoom >= 15 || hasSelectedIris)
  const showParisIris   = !irisLoading && (zoom >= 15 || hasSelectedIris)
  // Quartier: natural range 13-14, sticky below 13 if quartiers are selected
  const showQuartier    = (zoom >= 13 && zoom <= 14) || (zoom < 13 && hasSelectedQuartiers)
  // Communes have no intermediate quartier level, so they stay visible at all zooms.
  const showCommunes    = true

  // Clickable: each layer is only interactive in its natural zoom range.
  // Outside that range (sticky-visible), pointer-events:none lets clicks fall through.
  const irisZoomHi       = zoom >= 15                        // IRIS natural range
  const quartierNatural  = zoom >= 13 && zoom <= 14          // Quartier natural range

  // styleKeys: opaque strings that change only when the relevant selection changes.
  // Stable across zoom/pan re-renders → style-refresh effect stays silent during animation.
  // irisStyleKey and quartierStyleKey encode their zoom band so styles update when
  // crossing their respective zoom thresholds (14 for QA, 15 for IRIS).
  const parisStyleKey = useMemo(
    () => `${selectedArrIds.join()}_${selectedQuartierIds.join()}_${selectedIrisIds.join()}`,
    [selectedArrIds, selectedQuartierIds, selectedIrisIds]
  )
  // Separate key for quartiers: includes zoom band (hi = 14-15, lo = <14)
  const quartierStyleKey = useMemo(
    () => `${selectedArrIds.join()}_${selectedQuartierIds.join()}_${selectedIrisIds.join()}_${quartierNatural ? 1 : 0}`,
    [selectedArrIds, selectedQuartierIds, selectedIrisIds, quartierNatural]
  )
  const communeStyleKey = useMemo(
    () => `${selectedCommuneIds.join()}_${selectedIrisIds.join()}`,
    [selectedCommuneIds, selectedIrisIds]
  )
  const irisStyleKey = useMemo(
    () => `${selectedIrisIds.join()}_${irisZoomHi ? 1 : 0}`,
    [selectedIrisIds, irisZoomHi]
  )

  useGeoLayer(map, {
    zones: arrondissements,
    getPathStyle: (z) => topLevelStyle(computeArrState(z.id, quartiers, parisIris, sel)),
    getLabelState: (z) => computeArrState(z.id, quartiers, parisIris, sel),
    fontSize: 11,
    onClick: onClickArr,
    visible: showTopLevel,
    styleKey: parisStyleKey,
    showLabels: showTopLevel && zoom >= 11,
    clickable: true,
  })

  // Commune labels at zoom 11 (Paris-wide): viewport-aware thinning —
  // only ~MAX_THIN_LABELS labels visible, geographically spread around the
  // current viewport centre. At zoom 12+ the user has zoomed in enough
  // that every commune can breathe; we drop the filter.
  useGeoLayer(map, {
    zones: communes,
    getPathStyle: (z) => topLevelStyle(computeCommuneState(z.id, communeIris, comSel)),
    getLabelState: (z) => computeCommuneState(z.id, communeIris, comSel),
    fontSize: 10,
    onClick: onClickCommune,
    visible: showCommunes,
    styleKey: communeStyleKey,
    showLabels: zoom >= 11,
    labelFilter: thinLabeledSet ? (z) => thinLabeledSet.has(z.id) : undefined,
    labelFilterKey: thinLabelKey,
    clickable: true,
  })

  useGeoLayer(map, {
    zones: quartiers,
    // Low zoom (<14): merged style — no borders, only selected zones filled, others invisible
    // Natural range (14-15): full quartier style with borders and partial states
    getPathStyle: (z) => quartierNatural
      ? quartierStyle(computeQuartierState(z.id, parisIris, sel))
      : quartierStyleLowZoom(computeQuartierState(z.id, parisIris, sel)),
    getLabelState: (z) => computeQuartierState(z.id, parisIris, sel),
    fontSize: 10,
    onClick: onClickQuartier,
    visible: showQuartier,
    styleKey: quartierStyleKey,
    // Labels only in the natural quartier zoom range — not when force-shown by sticky selection
    showLabels: zoom >= 13 && zoom <= 14,
    // Non-interactive when sticky-shown outside natural range (lets arr clicks through)
    clickable: quartierNatural,
  })

  useGeoLayer(map, {
    zones: communeIris,
    getPathStyle: (z) => irisZoomHi
      ? irisStyle(selectedIrisIds.includes(z.id))
      : irisStyleLowZoom(selectedIrisIds.includes(z.id)),
    getLabelState: (z) => selectedIrisIds.includes(z.id) ? 'selected' : 'unselected',
    fontSize: 9,
    onClick: onClickCommuneIris,
    visible: showCommuneIris,
    styleKey: irisStyleKey,
    showLabels: false,
    clickable: irisZoomHi,
  })

  useGeoLayer(map, {
    zones: parisIris,
    getPathStyle: (z) => irisZoomHi
      ? irisStyle(selectedIrisIds.includes(z.id))
      : irisStyleLowZoom(selectedIrisIds.includes(z.id)),
    getLabelState: (z) => selectedIrisIds.includes(z.id) ? 'selected' : 'unselected',
    fontSize: 9,
    onClick: onClickIris,
    visible: showParisIris,
    styleKey: irisStyleKey,
    showLabels: false,
    clickable: irisZoomHi,
  })

  // ── Metro / RER station markers ────────────────────────────────────────────
  const stationMarkersRef = useRef<L.Marker[]>([])

  useEffect(() => {
    stationMarkersRef.current.forEach(m => m.remove())
    stationMarkersRef.current = []
    if (!irisZoomHi) return

    for (const s of MAP_STATIONS) {
      const isRer = s.type === 'rer_station' || s.lines.some(l => /^[A-E]$/.test(l))
      const isMet = s.type === 'metro_station' || s.lines.some(l => /^\d+$/.test(l))

      const icon = L.divIcon({
        html: stationIconHTML(s.label, isMet, isRer),
        className: '',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      })
      const marker = L.marker([s.coordinates.lat, s.coordinates.lng], { icon, keyboard: false })
      marker.bindPopup(stationPopupHTML(s.label, s.lines), {
        className: 'station-popup',
        closeButton: false,
        maxWidth: 220,
        offset: [0, 12],
      })
      marker.addTo(map)
      stationMarkersRef.current.push(marker)
    }

    return () => {
      stationMarkersRef.current.forEach(m => m.remove())
      stationMarkersRef.current = []
    }
  }, [map, irisZoomHi])

  // ── IRIS name labels (debug / temporaire) ─────────────────────────────────
  // Couche invisible géométriquement, labels uniquement sur les IRIS sélectionnés.
  const { showIrisNames } = props
  const selectedParisIris = useMemo(
    () => parisIris.filter(i => selectedIrisIds.includes(i.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIrisIds, parisIris]
  )
  useGeoLayer(map, {
    zones: selectedParisIris,
    getPathStyle: () => ({ opacity: 0, fillOpacity: 0, weight: 0 }),
    getLabelState: () => 'selected',
    fontSize: 10,
    onClick: () => {},
    visible: !!(showIrisNames && selectedParisIris.length > 0),
    styleKey: selectedIrisIds.join(','),
    showLabels: !!(showIrisNames && selectedParisIris.length > 0),
    clickable: false,
  })

  return null
}

// ─── MapViewController — fitBounds prioritaire sur flyTo ──────────────────
//
// fitBounds est utilisé pour l'état initial (moteur sémantique → vue sur
// toutes les zones sélectionnées). flyTo prend le relais pour les navigations
// ultérieures (changement de centrage après interaction utilisateur).

function MapViewController({
  center,
  fitBounds,
}: {
  center: [number, number]
  fitBounds: [[number, number], [number, number]] | null
}) {
  const map = useMap()
  const prevCenter = useRef<string | null>(null)
  const prevBoundsKey = useRef<string | null>(null)

  useEffect(() => {
    // fitBounds prime sur flyTo — positionne sur l'ensemble des zones
    if (fitBounds) {
      const key = fitBounds.flat().map(n => n.toFixed(5)).join(',')
      if (key === prevBoundsKey.current) return
      prevBoundsKey.current = key
      map.fitBounds(fitBounds, { padding: [28, 28], maxZoom: 15, animate: true, duration: 0.5 })
      return
    }

    // flyTo pour les changements de centrage ultérieurs
    const cKey = `${center[0].toFixed(4)},${center[1].toFixed(4)}`
    if (prevCenter.current === null) {
      prevCenter.current = cKey
      return
    }
    if (prevCenter.current === cKey) return
    prevCenter.current = cKey
    map.flyTo(center, map.getZoom(), { duration: 0.8 })
  }, [center, fitBounds, map])

  return null
}

// ─── Public component ──────────────────────────────────────────────────────

export interface ZoneMapProps {
  center: [number, number]
  zoom: number
  fitBounds?: [[number, number], [number, number]] | null
  arrondissements: GeoZone[]
  quartiers: GeoZone[]
  iris: GeoZone[]
  communes: GeoZone[]
  selectedArrIds: string[]
  selectedQuartierIds: string[]
  selectedIrisIds: string[]
  selectedCommuneIds: string[]
  irisLoading: boolean
  /** Affiche le nom de chaque IRIS sélectionné au centre de son polygone */
  showIrisNames?: boolean
  onClickArr: (z: GeoZone) => void
  onClickQuartier: (z: GeoZone) => void
  onClickIris: (z: GeoZone) => void
  onClickCommune: (z: GeoZone) => void
  onClickCommuneIris: (z: GeoZone) => void
  onZoomChange: (z: number) => void
  /** Fires once when the Leaflet map instance is ready (tiles can paint). */
  whenMapReady?: () => void
}

export default function ZoneMap({ center, zoom, fitBounds, arrondissements, quartiers, iris, communes, selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds, irisLoading, showIrisNames, onClickArr, onClickQuartier, onClickIris, onClickCommune, onClickCommuneIris, onZoomChange, whenMapReady }: ZoneMapProps) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
      attributionControl={false}
      whenReady={whenMapReady}
    >
      {/* Base sans labels — nos labels custom restent les seuls au zoom large */}
      <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png" />
      {/* Labels CartoDB (rues, POI, monuments) visibles seulement au zoom ≥ 15
          où nos labels custom d'arrondissement / quartier ne sont plus affichés */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png"
        minZoom={15}
        opacity={0.85}
      />
      <GeoLayers
        arrondissements={arrondissements}
        quartiers={quartiers}
        iris={iris}
        communes={communes}
        selectedArrIds={selectedArrIds}
        selectedQuartierIds={selectedQuartierIds}
        selectedIrisIds={selectedIrisIds}
        selectedCommuneIds={selectedCommuneIds}
        onClickArr={onClickArr}
        onClickQuartier={onClickQuartier}
        onClickIris={onClickIris}
        onClickCommune={onClickCommune}
        onClickCommuneIris={onClickCommuneIris}
        irisLoading={irisLoading}
        showIrisNames={showIrisNames}
        onZoomChange={onZoomChange}
      />
      <MapViewController center={center} fitBounds={fitBounds ?? null} />
    </MapContainer>
  )
}
