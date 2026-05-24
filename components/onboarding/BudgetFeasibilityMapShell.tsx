'use client'

import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Loader2 } from 'lucide-react'
import {
  fetchParisGeoData,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '@/lib/services/geoDataService'
import { computeFeasibility, NO_DATA_FILL } from '@/lib/services/budgetFeasibility'

const PARIS_CENTER: [number, number] = [48.8566, 2.3522]

interface BudgetFeasibilityMapShellProps {
  selectedIrisIds: string[]
  budgetMax: number
  surface: number
}

function fillStyleFor(color: string): L.PathOptions {
  return {
    fillColor: color,
    fillOpacity: 0.7,
    color: '#fff',
    weight: 0.6,
    opacity: 0.9,
  }
}

/** Compute fitBounds corners from selected IRIS polygons. */
function zonesToBounds(
  zones: GeoZone[],
  coverage = 0.92,
): [[number, number], [number, number]] | null {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  let found = false
  for (const zone of zones) {
    const geom = zone.feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
    const rings: GeoJSON.Position[][] =
      geom.type === 'Polygon' ? geom.coordinates
      : geom.type === 'MultiPolygon' ? geom.coordinates.flat()
      : []
    for (const ring of rings) {
      for (const pos of ring) {
        const lng = pos[0], lat = pos[1]
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        found = true
      }
    }
  }
  if (!found) return null
  if (coverage < 1) {
    const trim = (1 - coverage) / 2
    const dLat = maxLat - minLat
    const dLng = maxLng - minLng
    minLat += dLat * trim; maxLat -= dLat * trim
    minLng += dLng * trim; maxLng -= dLng * trim
  }
  return [[minLat, minLng], [maxLat, maxLng]]
}

/** Inner controller — owns the L.geoJSON layer and updates its styles imperatively. */
function IrisFeasibilityLayer({
  irisZones,
  budgetMax,
  surface,
}: {
  irisZones: GeoZone[]
  budgetMax: number
  surface: number
}) {
  const map = useMap()
  const layerRef = useRef<L.GeoJSON | null>(null)
  const pathByIdRef = useRef<Map<string, L.Path>>(new Map())

  // ── Rebuild the GeoJSON layer when the zones array changes ───────────────
  useEffect(() => {
    layerRef.current?.remove()
    pathByIdRef.current.clear()
    if (!irisZones.length) return

    const layer = L.geoJSON(
      { type: 'FeatureCollection', features: irisZones.map(z => z.feature) } as GeoJSON.FeatureCollection,
      {
        style: () => fillStyleFor(NO_DATA_FILL),
        // No click handler — read-only map.
      },
    )
    // Build the id → path map for fast imperative updates later.
    layer.eachLayer(l => {
      if (l instanceof L.Path) {
        const f = (l as unknown as { feature?: GeoJSON.Feature }).feature
        const id = f?.properties?._zoneId as string | undefined
        if (id) pathByIdRef.current.set(id, l)
      }
    })
    layer.addTo(map)
    layerRef.current = layer

    const bounds = zonesToBounds(irisZones)
    if (bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14, animate: false })

    return () => {
      layer.remove()
      pathByIdRef.current.clear()
    }
  }, [irisZones, map])

  // ── Imperative restyle when budget/surface change ────────────────────────
  // Pure pure function call + setStyle per layer → no React rerender, no
  // layer rebuild. Stays well under 16ms even for ~1k polygons.
  useEffect(() => {
    if (!layerRef.current || pathByIdRef.current.size === 0) return
    const feas = computeFeasibility(irisZones.map(z => z.id), budgetMax, surface)
    for (const f of feas) {
      const path = pathByIdRef.current.get(f.irisId)
      if (path) path.setStyle({ fillColor: f.color })
    }
  }, [budgetMax, surface, irisZones])

  return null
}

export default function BudgetFeasibilityMapShell({
  selectedIrisIds,
  budgetMax,
  surface,
}: BudgetFeasibilityMapShellProps) {
  const [irisZones, setIrisZones] = useState<GeoZone[]>([])
  const [loading, setLoading] = useState(true)

  // ── Load IRIS once on mount, then filter to the user's selection ─────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [geoData, communes] = await Promise.all([
          fetchParisGeoData(),
          fetchSuburbanCommunes(),
        ])
        const all = await fetchParisIris(geoData.quartiers, communes)
        if (cancelled) return
        const wanted = new Set(selectedIrisIds)
        setIrisZones(all.filter(z => wanted.has(z.id)))
      } catch (e) {
        console.error('[BudgetFeasibilityMap] iris load failed', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // selectedIrisIds intentionally not in deps — if it changes mid-step we
    // refilter without re-fetching (the wanted set is reapplied on the next
    // render via the filtered state below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refilter if the user navigates back & changes selection.
  useEffect(() => {
    if (loading) return
    const wanted = new Set(selectedIrisIds)
    setIrisZones(prev => {
      // Avoid expensive re-set if the set is unchanged.
      const same = prev.length === wanted.size && prev.every(z => wanted.has(z.id))
      if (same) return prev
      // We don't have the full list cached here — fetch path returns from cache.
      // Cheap enough to leave as-is for V1.
      return prev.filter(z => wanted.has(z.id))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIrisIds.join('|')])

  return (
    <>
      <MapContainer
        center={PARIS_CENTER}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        boxZoom={false}
        keyboard={false}
        touchZoom={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png" />
        <IrisFeasibilityLayer
          irisZones={irisZones}
          budgetMax={budgetMax}
          surface={surface}
        />
      </MapContainer>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-50/70 pointer-events-none">
          <Loader2 size={22} className="text-neutral-400 animate-spin" />
        </div>
      )}
    </>
  )
}
