'use client'

import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { GeoZone } from '@/lib/services/geoDataService'

// ─── Visual styles ─────────────────────────────────────────────────────────

type ZoneState = 'unselected' | 'selected' | 'partial'

function arrStyle(state: ZoneState): L.PathOptions {
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

function irisStyle(selected: boolean): L.PathOptions {
  return selected
    ? { color: '#914E3C', fillColor: '#914E3C', fillOpacity: 0.28, weight: 1.5, opacity: 0.9 }
    : { color: '#777', fillColor: 'transparent', fillOpacity: 0, weight: 0.6, opacity: 0.3 }
}

// ─── Label icons — centered, no dot, clean ────────────────────────────────

function makeLabel(text: string, state: ZoneState | 'selected' | 'unselected', fontSize = 11, bold = true): L.DivIcon {
  const isSelected = state === 'selected'
  const color = isSelected ? '#914E3C' : '#2a2a2a'
  const weight = bold ? 700 : 500
  return L.divIcon({
    html: `<div style="
      transform:translate(-50%,-50%);
      color:${color};
      font-size:${fontSize}px;
      font-weight:${weight};
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
  getState: (zone: GeoZone) => ZoneState | boolean
  getPathStyle: (zone: GeoZone) => L.PathOptions
  getLabelState: (zone: GeoZone) => ZoneState | 'selected' | 'unselected'
  fontSize: number
  onClick: (zone: GeoZone) => void
  visible: boolean
}

function useGeoLayer(map: L.Map, cfg: GeoLayerConfig) {
  const layerRef = useRef<L.GeoJSON | null>(null)
  const labelsRef = useRef<L.Marker[]>([])
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg

  // Build layer when zones change
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
    refreshLabels(layer, cfg.zones)

    return () => {
      layer.remove()
      labelsRef.current.forEach((m) => m.remove())
      labelsRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.zones, map])

  // Update styles + labels when selection state changes
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.eachLayer((l) => {
      if (!(l instanceof L.Path)) return
      const f = (l as any).feature as GeoJSON.Feature | undefined
      const zone = cfgRef.current.zones.find((z) => z.id === f?.properties?._zoneId)
      if (zone) l.setStyle(cfgRef.current.getPathStyle(zone))
    })
    refreshLabels(layer, cfgRef.current.zones)
  })

  // Toggle visibility
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    if (cfg.visible && !map.hasLayer(layer)) map.addLayer(layer)
    else if (!cfg.visible && map.hasLayer(layer)) map.removeLayer(layer)
    labelsRef.current.forEach((m) => {
      if (cfg.visible && !map.hasLayer(m)) map.addLayer(m)
      else if (!cfg.visible && map.hasLayer(m)) map.removeLayer(m)
    })
  }, [cfg.visible, map])

  function refreshLabels(layer: L.GeoJSON, zones: GeoZone[]) {
    labelsRef.current.forEach((m) => m.remove())
    labelsRef.current = []
    if (!cfgRef.current.visible) return
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
      if (cfgRef.current.visible) marker.addTo(map)
      labelsRef.current.push(marker)
    })
  }
}

// ─── Main layers component ─────────────────────────────────────────────────

interface GeoLayersProps {
  arrondissements: GeoZone[]
  quartiers: GeoZone[]
  iris: GeoZone[]
  selectedArrIds: string[]
  selectedQuartierIds: string[]
  selectedIrisIds: string[]
  onClickArr: (z: GeoZone) => void
  onClickQuartier: (z: GeoZone) => void
  onClickIris: (z: GeoZone) => void
  zoom: number
  irisLoading: boolean
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

function GeoLayers(props: GeoLayersProps) {
  const map = useMap()
  const { arrondissements, quartiers, iris, selectedArrIds, selectedQuartierIds, selectedIrisIds, onClickArr, onClickQuartier, onClickIris, zoom, irisLoading } = props
  const sel = { selectedArrIds, selectedQuartierIds, selectedIrisIds }

  const showArr = zoom <= 13
  const showQuartier = zoom >= 12 && zoom < 15
  const showIris = zoom >= 15 && !irisLoading

  useGeoLayer(map, {
    zones: arrondissements,
    getState: (z) => computeArrState(z.id, quartiers, iris, sel),
    getPathStyle: (z) => arrStyle(computeArrState(z.id, quartiers, iris, sel)),
    getLabelState: (z) => computeArrState(z.id, quartiers, iris, sel),
    fontSize: 11,
    onClick: onClickArr,
    visible: showArr,
  })

  useGeoLayer(map, {
    zones: quartiers,
    getState: (z) => computeQuartierState(z.id, iris, sel),
    getPathStyle: (z) => quartierStyle(computeQuartierState(z.id, iris, sel)),
    getLabelState: (z) => computeQuartierState(z.id, iris, sel),
    fontSize: 10,
    onClick: onClickQuartier,
    visible: showQuartier,
  })

  useGeoLayer(map, {
    zones: iris,
    getState: (z) => selectedIrisIds.includes(z.id),
    getPathStyle: (z) => irisStyle(selectedIrisIds.includes(z.id)),
    getLabelState: (z) => selectedIrisIds.includes(z.id) ? 'selected' : 'unselected',
    fontSize: 9,
    onClick: onClickIris,
    visible: showIris,
  })

  return null
}

// ─── Zoom watcher + flyTo ──────────────────────────────────────────────────

function MapController({ center, targetZoom, onZoomChange }: { center: [number, number]; targetZoom: number; onZoomChange: (z: number) => void }) {
  const map = useMap()
  const prevKey = useRef('')
  useMapEvents({ zoomend: () => onZoomChange(map.getZoom()), zoom: () => onZoomChange(map.getZoom()) })
  useEffect(() => {
    const key = `${center[0].toFixed(4)},${center[1].toFixed(4)},${targetZoom}`
    if (prevKey.current === key) return
    prevKey.current = key
    map.flyTo(center, targetZoom, { duration: 0.8 })
  }, [center, targetZoom, map])
  return null
}

// ─── Public component ──────────────────────────────────────────────────────

export interface ZoneMapProps {
  center: [number, number]
  zoom: number
  arrondissements: GeoZone[]
  quartiers: GeoZone[]
  iris: GeoZone[]
  selectedArrIds: string[]
  selectedQuartierIds: string[]
  selectedIrisIds: string[]
  irisLoading: boolean
  onClickArr: (z: GeoZone) => void
  onClickQuartier: (z: GeoZone) => void
  onClickIris: (z: GeoZone) => void
  onZoomChange: (z: number) => void
}

export default function ZoneMap({ center, zoom, arrondissements, quartiers, iris, selectedArrIds, selectedQuartierIds, selectedIrisIds, irisLoading, onClickArr, onClickQuartier, onClickIris, onZoomChange }: ZoneMapProps) {
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
        selectedArrIds={selectedArrIds}
        selectedQuartierIds={selectedQuartierIds}
        selectedIrisIds={selectedIrisIds}
        onClickArr={onClickArr}
        onClickQuartier={onClickQuartier}
        onClickIris={onClickIris}
        zoom={zoom}
        irisLoading={irisLoading}
      />
      <MapController center={center} targetZoom={zoom} onZoomChange={onZoomChange} />
    </MapContainer>
  )
}
