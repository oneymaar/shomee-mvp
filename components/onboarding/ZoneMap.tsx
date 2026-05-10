'use client'

import { useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { GeoZone } from '@/lib/services/geoDataService'

// Visual states
type ZoneState = 'unselected' | 'selected' | 'partial'

function getArrStyle(state: ZoneState): L.PathOptions {
  switch (state) {
    case 'selected':
      return { color: '#914E3C', fillColor: '#914E3C', fillOpacity: 0.18, weight: 2.5, opacity: 0.9 }
    case 'partial':
      return { color: '#914E3C', fillColor: '#914E3C', fillOpacity: 0.06, weight: 2, opacity: 0.6, dashArray: '6 4' }
    case 'unselected':
      return { color: '#1a1a1a', fillColor: 'transparent', fillOpacity: 0, weight: 1, opacity: 0.2 }
  }
}

function getQuartierStyle(selected: boolean): L.PathOptions {
  return selected
    ? { color: '#914E3C', fillColor: '#914E3C', fillOpacity: 0.28, weight: 1.5, opacity: 0.85 }
    : { color: '#1a1a1a', fillColor: 'transparent', fillOpacity: 0, weight: 0.8, opacity: 0.25 }
}

function makeLabelIcon(text: string, state: ZoneState | 'q-selected' | 'q-unselected'): L.DivIcon {
  const isSelected = state === 'selected' || state === 'q-selected'
  const isPartial = state === 'partial'
  const bg = isSelected ? '#914E3C' : isPartial ? 'rgba(145,78,60,0.12)' : 'rgba(255,255,255,0.9)'
  const color = isSelected ? 'white' : '#1a1a1a'
  const border = isSelected ? '#914E3C' : isPartial ? '#914E3C' : 'rgba(0,0,0,0.15)'
  const fontSize = state === 'q-selected' || state === 'q-unselected' ? '10px' : '11px'

  return L.divIcon({
    html: `<div style="background:${bg};color:${color};border:1.5px solid ${border};border-radius:20px;padding:2px 7px;font-size:${fontSize};font-weight:600;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,0.1);pointer-events:none;user-select:none;line-height:1.5;">${text}</div>`,
    className: '',
    iconAnchor: [0, 0],
  })
}

// --- Imperative Leaflet layer management ---

interface LayerState {
  selectedArrIds: string[]
  selectedQuartierIds: string[]
}

function computeArrState(zone: GeoZone, state: LayerState, childQuartierIds: string[]): ZoneState {
  const fullySelected = state.selectedArrIds.includes(zone.id)
  if (fullySelected && childQuartierIds.length === 0) return 'selected'
  if (fullySelected) return 'selected'

  // Partial: some children selected but not all
  const selectedChildren = childQuartierIds.filter((id) => state.selectedQuartierIds.includes(id))
  if (selectedChildren.length > 0 && selectedChildren.length < childQuartierIds.length) return 'partial'
  if (selectedChildren.length === childQuartierIds.length && childQuartierIds.length > 0) return 'selected'

  return 'unselected'
}

interface GeoLayersProps {
  arrondissements: GeoZone[]
  quartiers: GeoZone[]
  state: LayerState
  onClickArr: (zone: GeoZone) => void
  onClickQuartier: (zone: GeoZone) => void
}

function GeoLayers({ arrondissements, quartiers, state, onClickArr, onClickQuartier }: GeoLayersProps) {
  const map = useMap()
  const arrLayerRef = useRef<L.GeoJSON | null>(null)
  const arrLabelsRef = useRef<L.Marker[]>([])
  const quLayerRef = useRef<L.GeoJSON | null>(null)
  const quLabelsRef = useRef<L.Marker[]>([])
  const zoomRef = useRef(map.getZoom())
  const stateRef = useRef(state)

  // Keep stateRef in sync so event handlers always see latest state
  useEffect(() => { stateRef.current = state }, [state])

  // Helper: get all child quartier IDs for an arrondissement
  const getChildIds = useCallback((arrId: string) =>
    quartiers.filter((q) => q.parentId === arrId).map((q) => q.id),
  [quartiers])

  // Build arrondissement layer (once, on data change)
  useEffect(() => {
    if (!arrondissements.length) return

    // Clear previous
    arrLayerRef.current?.remove()
    arrLabelsRef.current.forEach((m) => m.remove())
    arrLabelsRef.current = []

    const layer = L.geoJSON(
      { type: 'FeatureCollection', features: arrondissements.map((z) => z.feature) } as GeoJSON.FeatureCollection,
      {
        style: (feature) => {
          const zone = arrondissements.find((z) => z.id === feature?.properties?._zoneId)
          if (!zone) return {}
          const childIds = getChildIds(zone.id)
          return getArrStyle(computeArrState(zone, stateRef.current, childIds))
        },
        onEachFeature: (feature, l) => {
          l.on('click', (e) => {
            L.DomEvent.stopPropagation(e)
            const zone = arrondissements.find((z) => z.id === feature.properties?._zoneId)
            if (zone) onClickArr(zone)
          })
          // Hover effect
          l.on('mouseover', () => { if (l instanceof L.Path) l.setStyle({ fillOpacity: Math.min((l.options.fillOpacity ?? 0) + 0.06, 0.35) }) })
          l.on('mouseout', () => { layer.resetStyle(l) })
        },
        interactive: true,
      }
    ).addTo(map)

    arrLayerRef.current = layer
    updateArrLabels()

    return () => {
      layer.remove()
      arrLabelsRef.current.forEach((m) => m.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrondissements, map])

  // Build quartier layer (once, on data change) — only shown when zoom ≥ 13
  useEffect(() => {
    if (!quartiers.length) return

    quLayerRef.current?.remove()
    quLabelsRef.current.forEach((m) => m.remove())
    quLabelsRef.current = []

    const layer = L.geoJSON(
      { type: 'FeatureCollection', features: quartiers.map((z) => z.feature) } as GeoJSON.FeatureCollection,
      {
        style: (feature) => {
          const zone = quartiers.find((z) => z.id === feature?.properties?._zoneId)
          if (!zone) return {}
          return getQuartierStyle(stateRef.current.selectedQuartierIds.includes(zone.id))
        },
        onEachFeature: (feature, l) => {
          l.on('click', (e) => {
            L.DomEvent.stopPropagation(e)
            const zone = quartiers.find((z) => z.id === feature.properties?._zoneId)
            if (zone) onClickQuartier(zone)
          })
          l.on('mouseover', () => { if (l instanceof L.Path) l.setStyle({ fillOpacity: 0.18 }) })
          l.on('mouseout', () => { layer.resetStyle(l) })
        },
        interactive: true,
      }
    ).addTo(map)

    quLayerRef.current = layer
    syncZoomVisibility(map.getZoom())

    return () => {
      layer.remove()
      quLabelsRef.current.forEach((m) => m.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quartiers, map])

  // Update arr styles when selection state changes
  useEffect(() => {
    if (!arrLayerRef.current) return
    arrLayerRef.current.eachLayer((l) => {
      if (!(l instanceof L.Path)) return
      const feature = (l as any).feature as GeoJSON.Feature | undefined
      const zone = arrondissements.find((z) => z.id === feature?.properties?._zoneId)
      if (!zone) return
      const childIds = getChildIds(zone.id)
      l.setStyle(getArrStyle(computeArrState(zone, state, childIds)))
    })
    updateArrLabels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedArrIds, state.selectedQuartierIds])

  // Update quartier styles when selection state changes
  useEffect(() => {
    if (!quLayerRef.current) return
    quLayerRef.current.eachLayer((l) => {
      if (!(l instanceof L.Path)) return
      const feature = (l as any).feature as GeoJSON.Feature | undefined
      const zone = quartiers.find((z) => z.id === feature?.properties?._zoneId)
      if (!zone) return
      l.setStyle(getQuartierStyle(state.selectedQuartierIds.includes(zone.id)))
    })
    updateQuartierLabels(map.getZoom())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedQuartierIds])

  function updateArrLabels() {
    arrLabelsRef.current.forEach((m) => m.remove())
    arrLabelsRef.current = []
    if (zoomRef.current >= 13) return // labels hidden at high zoom, quartier labels take over

    arrondissements.forEach((zone) => {
      try {
        const childIds = getChildIds(zone.id)
        const zState = computeArrState(zone, stateRef.current, childIds)
        const layer = arrLayerRef.current
        if (!layer) return
        // Find the layer for this zone and get its center
        let center: L.LatLng | null = null
        layer.eachLayer((l) => {
          if (!(l instanceof L.Path)) return
          const f = (l as any).feature as GeoJSON.Feature | undefined
          if (f?.properties?._zoneId === zone.id) {
            center = (l as L.Polygon).getBounds().getCenter()
          }
        })
        if (!center) return
        const marker = L.marker(center, {
          icon: makeLabelIcon(zone.shortName, zState),
          interactive: false,
          zIndexOffset: 100,
        }).addTo(map)
        arrLabelsRef.current.push(marker)
      } catch { /* skip */ }
    })
  }

  function updateQuartierLabels(zoom: number) {
    quLabelsRef.current.forEach((m) => m.remove())
    quLabelsRef.current = []
    if (zoom < 13 || !quartiers.length) return

    quartiers.forEach((zone) => {
      try {
        const isSelected = stateRef.current.selectedQuartierIds.includes(zone.id)
        let center: L.LatLng | null = null
        quLayerRef.current?.eachLayer((l) => {
          if (!(l instanceof L.Path)) return
          const f = (l as any).feature as GeoJSON.Feature | undefined
          if (f?.properties?._zoneId === zone.id) center = (l as L.Polygon).getBounds().getCenter()
        })
        if (!center) return
        const marker = L.marker(center, {
          icon: makeLabelIcon(zone.shortName, isSelected ? 'q-selected' : 'q-unselected'),
          interactive: false,
          zIndexOffset: 200,
        }).addTo(map)
        quLabelsRef.current.push(marker)
      } catch { /* skip */ }
    })
  }

  function syncZoomVisibility(zoom: number) {
    zoomRef.current = zoom
    const showQuartiers = zoom >= 13

    // Toggle quartier layer
    if (quLayerRef.current) {
      if (showQuartiers) {
        if (!map.hasLayer(quLayerRef.current)) map.addLayer(quLayerRef.current)
      } else {
        if (map.hasLayer(quLayerRef.current)) map.removeLayer(quLayerRef.current)
      }
    }

    // Refresh labels on zoom change
    updateArrLabels()
    updateQuartierLabels(zoom)
  }

  // Listen to zoom changes
  useMapEvents({
    zoomend: () => syncZoomVisibility(map.getZoom()),
    moveend: () => {
      updateArrLabels()
      updateQuartierLabels(map.getZoom())
    },
  })

  return null
}

// --- Map container ---

export interface ZoneMapProps {
  center: [number, number]
  zoom: number
  arrondissements: GeoZone[]
  quartiers: GeoZone[]
  selectedArrIds: string[]
  selectedQuartierIds: string[]
  onClickArr: (zone: GeoZone) => void
  onClickQuartier: (zone: GeoZone) => void
}

function FlyTo({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap()
  const prev = useRef('')
  useEffect(() => {
    const key = `${center[0].toFixed(4)},${center[1].toFixed(4)},${zoom}`
    if (prev.current === key) return
    prev.current = key
    map.flyTo(center, zoom, { duration: 0.8 })
  }, [center, zoom, map])
  return null
}

export default function ZoneMap({ center, zoom, arrondissements, quartiers, selectedArrIds, selectedQuartierIds, onClickArr, onClickQuartier }: ZoneMapProps) {
  const state: LayerState = { selectedArrIds, selectedQuartierIds }

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
        state={state}
        onClickArr={onClickArr}
        onClickQuartier={onClickQuartier}
      />
      <FlyTo center={center} zoom={zoom} />
    </MapContainer>
  )
}
