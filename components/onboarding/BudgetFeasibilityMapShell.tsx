'use client'

import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Loader2 } from 'lucide-react'
import type { GeoZone } from '@/lib/services/geoDataService'
import { computeFeasibility, NO_DATA_FILL } from '@/lib/services/budgetFeasibility'

const PARIS_CENTER: [number, number] = [48.8566, 2.3522]

interface BudgetFeasibilityMapShellProps {
  irisZones: GeoZone[]
  loading: boolean
  budgetMax: number
  surface: number
}

function fillStyleFor(color: string): L.PathOptions {
  return {
    fillColor: color,
    fillOpacity: 0.70,
    // Same-colour stroke at the same opacity as the fill. Seals the
    // sub-pixel gaps SVG anti-aliasing leaves between adjacent polygons:
    //   - on an isolated edge → stroke = fill = invisible
    //   - on a shared edge → two strokes overlap, effective opacity
    //     ≈ 1 − (1−0.7)² ≈ 0.91 → seam covered by the gradient's own
    //     colour, never a white pixel showing through.
    // The deliberate white outer outline is still drawn by the separate
    // edge-counting line layer.
    color: color,
    weight: 2,
    opacity: 0.70,
    stroke: true,
    lineJoin: 'round',
  }
}

const OUTLINE_STYLE: L.PathOptions = {
  color: '#ffffff',
  weight: 1.5,
  opacity: 0.4,
  fill: false,
}

// ─── Geometry helpers ──────────────────────────────────────────────────────

function zonesToBounds(
  zones: GeoZone[],
  coverage = 1,
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

/** Simple polygon centroid (average of outer-ring vertices). MultiPolygon: largest ring. */
function polygonCentroid(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const outerRings: GeoJSON.Position[][] =
    geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.type === 'MultiPolygon' ? geom.coordinates.map(p => p[0])
    : []
  // Pick the longest outer ring for MultiPolygon — typically the main body.
  let best: GeoJSON.Position[] = outerRings[0] ?? []
  for (const r of outerRings) if (r.length > best.length) best = r
  if (best.length === 0) return [0, 0]
  let sx = 0, sy = 0, n = 0
  for (const p of best) { sx += p[0]; sy += p[1]; n++ }
  return [sx / n, sy / n]
}

/**
 * Group outline via edge counting.
 *
 * Every outer-ring edge that appears EXACTLY ONCE across all selected IRIS
 * is on the group boundary. Edges shared by two adjacent IRIS appear TWICE
 * and are discarded — that's how we remove internal seams without computing
 * a real polygon union.
 *
 * Works because Paris IRIS data shares exact vertex coordinates between
 * neighbours (no float drift), since they come from a single coherent source.
 */
function computeGroupOutline(zones: GeoZone[]): GeoJSON.FeatureCollection {
  const edges = new Map<string, { a: GeoJSON.Position; b: GeoJSON.Position; count: number }>()
  const key = (a: GeoJSON.Position, b: GeoJSON.Position): string => {
    // Canonicalize so [a,b] and [b,a] map to the same key
    const [a0, a1, b0, b1] = [a[0], a[1], b[0], b[1]]
    if (a0 < b0 || (a0 === b0 && a1 < b1)) return `${a0},${a1}|${b0},${b1}`
    return `${b0},${b1}|${a0},${a1}`
  }
  for (const z of zones) {
    const geom = z.feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
    const polygons: GeoJSON.Position[][][] =
      geom.type === 'Polygon' ? [geom.coordinates]
      : geom.type === 'MultiPolygon' ? geom.coordinates
      : []
    for (const poly of polygons) {
      const outer = poly[0]  // outer ring only — ignore holes
      if (!outer || outer.length < 2) continue
      for (let i = 0; i < outer.length - 1; i++) {
        const a = outer[i], b = outer[i + 1]
        const k = key(a, b)
        const existing = edges.get(k)
        if (existing) existing.count++
        else edges.set(k, { a, b, count: 1 })
      }
    }
  }
  const lineSegments: GeoJSON.Feature[] = []
  for (const e of edges.values()) {
    if (e.count === 1) {
      lineSegments.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [e.a, e.b] },
      })
    }
  }
  return { type: 'FeatureCollection', features: lineSegments }
}

// ─── Inner controller — owns the L.geoJSON layers ──────────────────────────

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
  const fillLayerRef = useRef<L.GeoJSON | null>(null)
  const outlineLayerRef = useRef<L.GeoJSON | null>(null)
  const pathByIdRef = useRef<Map<string, L.Path>>(new Map())

  // Precompute centroids once per zones change — used by the noise function.
  const irisInputs = useMemo(
    () => irisZones.map(z => ({
      id: z.id,
      centroid: polygonCentroid(z.feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon),
    })),
    [irisZones],
  )

  // Outline: static for a given selection — recompute only when zones change.
  const outlineGeoJson = useMemo(() => computeGroupOutline(irisZones), [irisZones])

  // ── (Re)build layers when zones change ───────────────────────────────────
  useEffect(() => {
    fillLayerRef.current?.remove()
    outlineLayerRef.current?.remove()
    pathByIdRef.current.clear()
    if (!irisZones.length) return

    const fillLayer = L.geoJSON(
      { type: 'FeatureCollection', features: irisZones.map(z => z.feature) } as GeoJSON.FeatureCollection,
      { style: () => fillStyleFor(NO_DATA_FILL), interactive: false },
    )
    fillLayer.eachLayer(l => {
      if (l instanceof L.Path) {
        const f = (l as unknown as { feature?: GeoJSON.Feature }).feature
        const id = f?.properties?._zoneId as string | undefined
        if (id) pathByIdRef.current.set(id, l)
      }
    })
    fillLayer.addTo(map)
    fillLayerRef.current = fillLayer

    const outlineLayer = L.geoJSON(outlineGeoJson, {
      style: () => OUTLINE_STYLE,
      interactive: false,
    })
    outlineLayer.addTo(map)
    outlineLayerRef.current = outlineLayer

    // Auto-fit: ~90% coverage with ~5% margin per side. Combined with
    // zoomSnap=0 on the MapContainer, Leaflet picks the exact fractional
    // zoom that places the selection bounding box at (container - 2*padding).
    // 16px padding on a 343px-usable iPhone X frame ≈ 4.7% per side.
    // invalidateSize() is paranoia — guarantees Leaflet measures the
    // container before computing the fit, in case the dynamic-import shell
    // mounts before the parent flex layout has settled.
    const bounds = zonesToBounds(irisZones)
    if (bounds) {
      map.invalidateSize()
      map.fitBounds(bounds, { padding: [16, 16], maxZoom: 15, animate: false })
    }

    return () => {
      fillLayer.remove()
      outlineLayer.remove()
      pathByIdRef.current.clear()
    }
  }, [irisZones, outlineGeoJson, map])

  // ── Imperative restyle on budget / surface change ────────────────────────
  // No React rerender, no layer rebuild. Pure setStyle per path — paired with
  // a CSS transition on the `fill` attribute for a smooth interpolated effect.
  useEffect(() => {
    if (!fillLayerRef.current || pathByIdRef.current.size === 0) return
    const feas = computeFeasibility(irisInputs, budgetMax, surface)
    for (const f of feas) {
      const path = pathByIdRef.current.get(f.irisId)
      // Keep stroke colour in lockstep with fill colour so the seam-
      // sealing trick (see fillStyleFor) keeps working on every restyle.
      if (path) path.setStyle({ fillColor: f.color, color: f.color })
    }
  }, [budgetMax, surface, irisInputs])

  return null
}

// ─── Public shell ───────────────────────────────────────────────────────────

export default function BudgetFeasibilityMapShell({
  irisZones,
  loading,
  budgetMax,
  surface,
}: BudgetFeasibilityMapShellProps) {
  return (
    <div className="shomee-feasibility-map w-full h-full relative">
      <MapContainer
        center={PARIS_CENTER}
        zoom={12}
        // Continuous zoom: fitBounds picks the exact fractional level that
        // makes the IRIS bounds fill ~80% of the container. With the default
        // zoomSnap=1, Leaflet floors to the nearest integer zoom and Paris-
        // wide selections end up with a huge halo of surrounding map.
        zoomSnap={0}
        zoomDelta={0.25}
        style={{ height: '100%', width: '100%' }}
        // Strictly non-interactive — this is a visualisation, not a tool.
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
    </div>
  )
}
