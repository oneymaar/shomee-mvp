'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { GeoZone } from '@/lib/services/geoDataService'

// ─── Visual styles ─────────────────────────────────────────────────────────

type ZoneState = 'unselected' | 'selected' | 'partial'

function topLevelStyle(state: ZoneState): L.PathOptions {
  switch (state) {
    case 'selected':  return { color: '#914E3C', fillColor: '#914E3C', fillOpacity: 0.16, weight: 2.5, opacity: 0.9 }
    case 'partial':   return { color: '#914E3C', fillColor: '#914E3C', fillOpacity: 0.05, weight: 2, opacity: 0.55, dashArray: '7 4' }
    case 'unselected':return { color: '#444', fillColor: 'transparent', fillOpacity: 0, weight: 1, opacity: 0.18 }
  }
}

function quartierStyle(state: ZoneState): L.PathOptions {
  switch (state) {
    case 'selected':  return { color: '#914E3C', fillColor: '#914E3C', fillOpacity: 0.22, weight: 1.8, opacity: 0.85 }
    case 'partial':   return { color: '#914E3C', fillColor: '#914E3C', fillOpacity: 0.06, weight: 1.5, opacity: 0.5, dashArray: '5 3' }
    case 'unselected':return { color: '#555', fillColor: 'transparent', fillOpacity: 0, weight: 0.8, opacity: 0.22 }
  }
}

// At zoom < 14 (arrondissement level), quartiers are not individually interactive.
// Selected: solid fill, no border → adjacent QAs fuse into one shape.
// Partial/unselected: fully invisible → IRIS layer handles partial areas.
function quartierStyleLowZoom(state: ZoneState): L.PathOptions {
  if (state === 'selected') return { fillColor: '#914E3C', fillOpacity: 0.18, weight: 0, opacity: 0 }
  return { fillOpacity: 0, weight: 0, opacity: 0 }
}

function irisStyle(selected: boolean): L.PathOptions {
  return selected
    ? { color: '#914E3C', fillColor: '#914E3C', fillOpacity: 0.28, weight: 1.5, opacity: 0.9 }
    : { color: '#777', fillColor: 'transparent', fillOpacity: 0, weight: 0.6, opacity: 0.3 }
}

// At zoom < 15 (not the natural IRIS zoom), show selected IRIS as a solid merged area:
// weight:0 removes borders between adjacent selected zones so they fuse into one shape.
// Unselected IRIS are fully transparent — invisible at low zoom (no visual noise).
function irisStyleLowZoom(selected: boolean): L.PathOptions {
  return selected
    ? { color: '#914E3C', fillColor: '#914E3C', fillOpacity: 0.22, weight: 0, opacity: 0 }
    : { fillColor: 'transparent', fillOpacity: 0, weight: 0, opacity: 0 }
}

// ─── Labels — text only, centered, no background ──────────────────────────

function makeLabel(text: string, state: ZoneState | 'selected' | 'unselected', fontSize = 11, bold = true): L.DivIcon {
  const isSelected = state === 'selected'
  const color = isSelected ? '#914E3C' : '#2a2a2a'
  return L.divIcon({
    html: `<div style="
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
   * When false, all SVG paths in this layer get pointer-events:none so clicks fall
   * through to the layer underneath. Used to restore correct click targets when
   * sticky-visible layers are shown outside their natural interactive zoom range.
   */
  clickable: boolean
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
            L.DomEvent.stopPropagation(e)
            const zone = cfg.zones.find((z) => z.id === f.properties?._zoneId)
            if (zone) cfgRef.current.onClick(zone)
          })
        },
      }
    )
    if (cfg.visible) layer.addTo(map)
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
  // Fast: only adds/removes from map. Deps are booleans that change only at
  // threshold crossings, not on every zoom tick — avoids O(n) marker work.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    if (cfg.visible && !map.hasLayer(layer)) map.addLayer(layer)
    else if (!cfg.visible && map.hasLayer(layer)) map.removeLayer(layer)

    labelsRef.current.forEach((m) => {
      if (cfg.showLabels && !map.hasLayer(m)) map.addLayer(m)
      else if (!cfg.showLabels && map.hasLayer(m)) map.removeLayer(m)
    })
  }, [cfg.visible, cfg.showLabels, map])

  // ── Effect 4: toggle pointer-events when clickable changes ────────────────
  // L.Path.setStyle({ interactive }) propagates to SVG pointer-events attribute.
  // false → pointer-events:none → clicks fall through to layers underneath.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.eachLayer((l) => {
      if (l instanceof L.Path) l.setStyle({ interactive: cfg.clickable })
    })
  }, [cfg.clickable])

  function rebuildLabels(layer: L.GeoJSON, zones: GeoZone[]) {
    labelsRef.current.forEach((m) => m.remove())
    labelsRef.current = []
    zoneMarkerMapRef.current.clear()
    const showLabels = cfgRef.current.showLabels
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
      if (showLabels) marker.addTo(map)
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

  useMapEvents({
    zoomend: () => {
      const z = map.getZoom()
      setZoom(z)
      props.onZoomChange(z)
    },
  })

  const { arrondissements, quartiers, iris, communes, selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds, onClickArr, onClickQuartier, onClickIris, onClickCommune, onClickCommuneIris, irisLoading } = props
  const sel = { selectedArrIds, selectedQuartierIds, selectedIrisIds }
  const comSel = { selectedCommuneIds, selectedIrisIds }

  const parisIris = useMemo(() => iris.filter((i) => !i.parentId?.startsWith('com-')), [iris])
  const communeIris = useMemo(() => iris.filter((i) => i.parentId?.startsWith('com-')), [iris])

  // "Sticky selection" flags: layers with active selections stay visible when zooming out
  // so the user always sees their selection mosaic, regardless of zoom level.
  const hasSelectedIris      = selectedIrisIds.length > 0
  const hasSelectedQuartiers = selectedQuartierIds.length > 0

  // Zoom thresholds
  const showTopLevel    = zoom <= 13
  // IRIS: visible at zoom ≥15, AND always visible once some IRIS are selected (sticky)
  const showCommuneIris = !irisLoading && (zoom >= 15 || hasSelectedIris)
  const showParisIris   = !irisLoading && (zoom >= 15 || hasSelectedIris)
  // Quartier: visible at zoom 14–15, AND stays visible at lower zoom if quartiers are selected
  const showQuartier    = (zoom >= 14 && zoom <= 15) || (zoom < 14 && hasSelectedQuartiers)
  // Communes have no intermediate quartier level, so they stay visible at all
  // zooms — at zoom 14 they bridge the gap; at zoom 15+ they outline IRIS zones.
  const showCommunes    = true

  // Clickable: each layer is only interactive in its natural zoom range.
  // Outside that range (sticky-visible), pointer-events:none lets clicks fall through.
  const irisZoomHi       = zoom >= 15                        // IRIS natural range
  const quartierNatural  = zoom >= 14 && zoom <= 15          // Quartier natural range

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

  useGeoLayer(map, {
    zones: communes,
    getPathStyle: (z) => topLevelStyle(computeCommuneState(z.id, communeIris, comSel)),
    getLabelState: (z) => computeCommuneState(z.id, communeIris, comSel),
    fontSize: 10,
    onClick: onClickCommune,
    visible: showCommunes,
    styleKey: communeStyleKey,
    showLabels: zoom >= 11,
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
    showLabels: zoom >= 14 && zoom <= 15,
    // Non-interactive when sticky-shown outside natural range (lets arr clicks through)
    clickable: quartierNatural,
  })

  useGeoLayer(map, {
    zones: communeIris,
    // Low zoom: merged style (no borders, unselected invisible) — high zoom: detail style
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
    // Low zoom: merged style (no borders, unselected invisible) — high zoom: detail style
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

  return null
}

// ─── MapController — only handles center flyTo, never touches zoom ─────────

function MapController({ center }: { center: [number, number] }) {
  const map = useMap()
  const prevCenter = useRef<string | null>(null)

  useEffect(() => {
    const key = `${center[0].toFixed(4)},${center[1].toFixed(4)}`
    if (prevCenter.current === null) {
      prevCenter.current = key
      return
    }
    if (prevCenter.current === key) return
    prevCenter.current = key
    map.flyTo(center, map.getZoom(), { duration: 0.8 })
  }, [center, map])

  return null
}

// ─── Public component ──────────────────────────────────────────────────────

export interface ZoneMapProps {
  center: [number, number]
  zoom: number
  arrondissements: GeoZone[]
  quartiers: GeoZone[]
  iris: GeoZone[]
  communes: GeoZone[]
  selectedArrIds: string[]
  selectedQuartierIds: string[]
  selectedIrisIds: string[]
  selectedCommuneIds: string[]
  irisLoading: boolean
  onClickArr: (z: GeoZone) => void
  onClickQuartier: (z: GeoZone) => void
  onClickIris: (z: GeoZone) => void
  onClickCommune: (z: GeoZone) => void
  onClickCommuneIris: (z: GeoZone) => void
  onZoomChange: (z: number) => void
}

export default function ZoneMap({ center, zoom, arrondissements, quartiers, iris, communes, selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds, irisLoading, onClickArr, onClickQuartier, onClickIris, onClickCommune, onClickCommuneIris, onZoomChange }: ZoneMapProps) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
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
        onZoomChange={onZoomChange}
      />
      <MapController center={center} />
    </MapContainer>
  )
}
