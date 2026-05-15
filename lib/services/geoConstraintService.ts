/**
 * GeoConstraintService — resolves structured geographic constraints to IRIS zone IDs.
 *
 * Architecture:
 *   User query → LLM extracts GeoConstraint[] → resolveConstraints() → IRIS zone IDs
 *
 * Operator semantics (applies to ALL constraint types):
 *   - "inside"   → include in the union pool (admin area, neighborhood, station)
 *   - "near"     → filter/intersection applied to the union pool
 *   - "around"   → alias of "near"
 *   - "exclude"  → subtract from the pool (admin area, neighborhood, station)
 *   - "between"  → build intermediate zone between two entities
 *   - "prefer"   → soft lifestyle hint (future)
 */

import type { GeoZone } from './geoDataService'
import { polygonCentroid, polygonContainsPoint, matchQuartiersByName } from './geoDataService'
import { getStationsByLine, findStation, normalizeLineId } from './metroStationsDb'
import { findNeighborhoodById, matchNeighborhood } from './semanticNeighborhoodService'

// ─── Types ─────────────────────────────────────────────────────────────────

export type ConstraintType =
  | 'administrative_area'
  | 'transport_line'
  | 'transport_station'
  | 'semantic_neighborhood'
  | 'poi'
  | 'relative_position'
  | 'lifestyle'

export type ConstraintOperator =
  | 'inside'    // include in union pool
  | 'near'      // proximity filter (intersection)
  | 'around'    // alias of near
  | 'between'   // midpoint zone between two entities
  | 'exclude'   // subtract from result
  | 'prefer'    // soft preference (lifestyle)

export interface GeoConstraint {
  type: ConstraintType
  label: string
  operator: ConstraintOperator
  confidence: number

  zoneId?: string
  line?: string
  stationName?: string
  neighborhoodId?: string
  poiType?: string
  radiusM?: number
  direction?: string
  lat?: number    // geocoded coordinates — injected before resolver for type "poi"
  lng?: number
  geometry?: GeoJSON.Geometry  // full OSM geometry (LineString, Polygon…) for geometry-based IRIS intersection
  bbox?: [number, number, number, number]  // [minLat, maxLat, minLng, maxLng] from Nominatim — always reliable
  parentArrIds?: string[]  // arr-N IDs the POI belongs to — restricts IRIS selection to those arrondissements
}

// ─── POI radius defaults by sub-type ───────────────────────────────────────

export const POI_TYPE_RADII: Record<string, number> = {
  park: 700, garden: 600, landmark: 600, monument: 500,
  street: 400, avenue: 500, boulevard: 600,
  market: 400, mairie: 450, school: 400, hospital: 700, museum: 500,
}

export function poiRadius(poiType?: string | null): number {
  return (poiType && POI_TYPE_RADII[poiType]) || 500
}

export interface ConstraintResolutionResult {
  irisIds: string[]
  fallbackZoneIds: string[]
  matchSummary: string[]
  wasNarrowed: boolean
  suggestedCenter?: [number, number]
}

// ─── Haversine distance (metres) ───────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Geometry sampling & intersection ─────────────────────────────────────

/**
 * Sample points along a GeoJSON geometry at ~stepM metre intervals.
 * Returns [lat, lng] pairs (note: GeoJSON coords are [lng, lat]).
 * Used to find which IRIS zones a street, avenue or polygon intersects.
 */
function sampleGeometryPoints(geometry: GeoJSON.Geometry, stepM = 80): [number, number][] {
  type Pos = [number, number]
  const lines: Pos[][] = []

  if (geometry.type === 'LineString') {
    lines.push(geometry.coordinates as Pos[])
  } else if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates as Pos[][]) lines.push(line)
  } else if (geometry.type === 'Polygon') {
    lines.push(geometry.coordinates[0] as Pos[])
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates as Pos[][][]) lines.push(poly[0])
  } else if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates as [number, number]
    return [[lat, lng]]
  } else {
    return []
  }

  const points: [number, number][] = []

  for (const line of lines) {
    if (!line.length) continue
    points.push([line[0][1], line[0][0]])
    let leftover = 0
    for (let i = 0; i < line.length - 1; i++) {
      const [lng1, lat1] = line[i]
      const [lng2, lat2] = line[i + 1]
      const seg = haversineM(lat1, lng1, lat2, lng2)
      let d = stepM - leftover
      while (d <= seg) {
        const t = d / seg
        points.push([lat1 + t * (lat2 - lat1), lng1 + t * (lng2 - lng1)])
        d += stepM
      }
      leftover = (leftover + seg) % stepM
    }
    const last = line[line.length - 1]
    points.push([last[1], last[0]])
  }

  return points
}

/**
 * Select IRIS whose centroid falls within the bounding box + a buffer in metres.
 * Used as a reliable fallback when geometry is unavailable or a Point.
 * Covers the full extent of a street/avenue even without a precise LineString.
 */
function filterIrisByBbox(
  candidates: GeoZone[],
  bbox: [number, number, number, number],
  bufferM = 100,
): GeoZone[] {
  const [minLat, maxLat, minLng, maxLng] = bbox
  const midLat = (minLat + maxLat) / 2
  const bufLat = bufferM / 111_000
  const bufLng = bufferM / (111_000 * Math.cos(midLat * Math.PI / 180))
  return candidates.filter(z => {
    const c = irisCentroid(z)
    if (!c) return false
    return c[0] >= minLat - bufLat && c[0] <= maxLat + bufLat
      && c[1] >= minLng - bufLng && c[1] <= maxLng + bufLng
  })
}

const STREET_POI_TYPES = new Set(['street', 'avenue', 'boulevard', 'rue', 'quai', 'passage', 'impasse', 'voie', 'route'])

/**
 * Select IRIS that intersect a given GeoJSON geometry.
 *
 * Strategy for linear features (LineString, MultiLineString):
 *   For each segment between consecutive nodes, sample every 20m and apply
 *   two offsets at ±8m perpendicular to the segment's actual travel direction.
 *
 * Why segment-perpendicular offsets instead of 4 cardinal offsets:
 *   Cardinal offsets (N/S/E/W) applied at every sample point — including the first
 *   and last nodes of each OSM way — generate "escape" points in the street's own
 *   travel direction. For a N-S street the ±S offsets at the southern terminus land
 *   8m beyond the street end, inside an IRIS the street does not border (false positive).
 *   Perpendicular offsets are geometrically correct: they stay on the sides of the
 *   street at every point, including endpoints.
 *
 * Strategy for area features (Polygon, MultiPolygon):
 *   Sample the boundary every 20m with 4 cardinal offsets (any orientation).
 *
 * Falls back to radius-based selection for Point geometries.
 */
function filterIrisByGeometry(
  candidates: GeoZone[],
  geometry: GeoJSON.Geometry,
  fallbackRadius = 500,
): GeoZone[] {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates as [number, number]
    return filterIrisByCoords(candidates, lat, lng, fallbackRadius)
  }

  type Pos = [number, number]

  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
    const lines: Pos[][] = geometry.type === 'LineString'
      ? [geometry.coordinates as Pos[]]
      : geometry.coordinates as Pos[][]

    const STEP_M = 20
    const OFFSET_M = 8
    const selected = new Set<string>()

    const checkPoint = (la: number, lo: number) => {
      for (const z of candidates) {
        if (polygonContainsPoint(z.feature.geometry, lo, la)) selected.add(z.id)
      }
    }

    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const [lng1, lat1] = line[i]
        const [lng2, lat2] = line[i + 1]
        const segLen = haversineM(lat1, lng1, lat2, lng2)
        if (segLen < 0.01) continue

        const dLat = lat2 - lat1
        const dLng = lng2 - lng1
        const cosLat = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)

        // Right-perpendicular offset (90° CW from travel direction), in degrees,
        // scaled to OFFSET_M metres. Derived by rotating (dLng*cosLat, dLat) 90° CW
        // in metric space then converting back to geographic degrees.
        // Left perpendicular is the negation of both components.
        const pLat = -dLng * cosLat * OFFSET_M / segLen
        const pLng =  dLat          * OFFSET_M / (segLen * cosLat)

        for (let d = 0; d <= segLen; d += STEP_M) {
          const t = Math.min(d / segLen, 1)
          const lat = lat1 + t * dLat
          const lng = lng1 + t * dLng
          checkPoint(lat, lng)
          checkPoint(lat + pLat, lng + pLng)  // right of street
          checkPoint(lat - pLat, lng - pLng)  // left of street
        }
      }
    }

    return candidates.filter(z => selected.has(z.id))
  }

  // Polygon / MultiPolygon: sample boundary with 4 cardinal offsets
  const pts = sampleGeometryPoints(geometry, 20)
  if (!pts.length) return []

  const selected = new Set<string>()
  for (const [lat, lng] of pts) {
    const dLat = 8 / 111_000
    const dLng = 8 / (111_000 * Math.cos(lat * Math.PI / 180))
    const toCheck: [number, number][] = [
      [lat, lng],
      [lat + dLat, lng], [lat - dLat, lng],
      [lat, lng + dLng], [lat, lng - dLng],
    ]
    for (const [la, lo] of toCheck) {
      for (const z of candidates) {
        if (polygonContainsPoint(z.feature.geometry, lo, la)) selected.add(z.id)
      }
    }
  }
  return candidates.filter(z => selected.has(z.id))
}

// ─── IRIS hierarchy helpers ─────────────────────────────────────────────────

function getIrisInZone(zoneId: string, iris: GeoZone[], quartiers: GeoZone[]): GeoZone[] {
  if (zoneId.startsWith('arr-')) {
    const quartierIds = new Set(
      quartiers.filter((q) => q.parentId === zoneId).map((q) => q.id)
    )
    return iris.filter(
      (i) => i.parentId && (i.parentId === zoneId || quartierIds.has(i.parentId))
    )
  }
  if (zoneId.startsWith('com-')) {
    return iris.filter((i) => i.parentId === zoneId)
  }
  return []
}

function irisCentroid(zone: GeoZone): [number, number] | null {
  try {
    const [lng, lat] = polygonCentroid(zone.feature.geometry)
    return [lat, lng]
  } catch {
    return null
  }
}

// ─── Proximity and direction filters ───────────────────────────────────────

const DEFAULT_TRANSPORT_RADIUS_M = 650

function filterIrisByTransportLine(
  candidates: GeoZone[],
  line: string,
  radiusM = DEFAULT_TRANSPORT_RADIUS_M
): GeoZone[] {
  const normalizedLine = normalizeLineId(line)
  const stations = getStationsByLine(normalizedLine)
  if (!stations.length) return candidates

  return candidates.filter((zone) => {
    const centroid = irisCentroid(zone)
    if (!centroid) return false
    const [lat, lng] = centroid
    return stations.some((s) => haversineM(lat, lng, s.lat, s.lng) <= radiusM)
  })
}

function filterIrisByStation(
  candidates: GeoZone[],
  stationName: string,
  radiusM = DEFAULT_TRANSPORT_RADIUS_M
): GeoZone[] {
  const station = findStation(stationName)
  if (!station) return candidates

  return candidates.filter((zone) => {
    const centroid = irisCentroid(zone)
    if (!centroid) return false
    const [lat, lng] = centroid
    return haversineM(lat, lng, station.lat, station.lng) <= radiusM
  })
}

function filterIrisByDirection(candidates: GeoZone[], direction: string): GeoZone[] {
  if (!direction || candidates.length === 0) return candidates

  const entries = candidates
    .map(z => ({ zone: z, c: irisCentroid(z) }))
    .filter(e => e.c !== null) as { zone: GeoZone; c: [number, number] }[]
  if (entries.length === 0) return candidates

  const lats = entries.map(e => e.c[0])
  const lngs = entries.map(e => e.c[1])
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2

  switch (direction) {
    case 'north': return entries.filter(e => e.c[0] >= midLat).map(e => e.zone)
    case 'south': return entries.filter(e => e.c[0] <= midLat).map(e => e.zone)
    case 'east':  return entries.filter(e => e.c[1] >= midLng).map(e => e.zone)
    case 'west':  return entries.filter(e => e.c[1] <= midLng).map(e => e.zone)
    case 'central':
    case 'not_too_peripheral': {
      const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length
      const meanLng = lngs.reduce((a, b) => a + b, 0) / lngs.length
      const dists = entries.map(e => haversineM(e.c[0], e.c[1], meanLat, meanLng))
      const maxDist = Math.max(...dists)
      const threshold = maxDist * (direction === 'central' ? 0.50 : 0.65)
      return entries.filter((_, i) => dists[i] <= threshold).map(e => e.zone)
    }
    default: return candidates
  }
}

function filterIrisByCoords(
  candidates: GeoZone[],
  lat: number,
  lng: number,
  radiusM: number
): GeoZone[] {
  return candidates.filter((zone) => {
    const centroid = irisCentroid(zone)
    if (!centroid) return false
    return haversineM(centroid[0], centroid[1], lat, lng) <= radiusM
  })
}

function capIrisByDistance(
  zones: GeoZone[],
  lat: number,
  lng: number,
  maxCount: number
): GeoZone[] {
  if (zones.length <= maxCount) return zones
  return zones
    .map((zone) => {
      const c = irisCentroid(zone)
      return { zone, dist: c ? haversineM(c[0], c[1], lat, lng) : Infinity }
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxCount)
    .map(({ zone }) => zone)
}

// ─── Entity resolution helpers ──────────────────────────────────────────────

/**
 * Resolve a neighborhood constraint to its coordinates.
 * Tries neighborhoodId first, then falls back to label-based matching.
 */
function resolveNeighborhoodCoords(c: GeoConstraint): { lat: number; lng: number; id: string; confidenceRadiusMeters: number; maxSelectedIris?: number; label: string } | null {
  const n = c.neighborhoodId
    ? findNeighborhoodById(c.neighborhoodId)
    : c.label ? matchNeighborhood(c.label) : null
  if (n) return { lat: n.center.lat, lng: n.center.lng, id: n.id, confidenceRadiusMeters: n.confidenceRadiusMeters, maxSelectedIris: n.maxSelectedIris, label: n.label }

  // Fallback: name might be in the station DB but absent from semanticNeighborhoods.json
  // (e.g. Daumesnil, Bastille, Nation, République — listed in the prompt but not yet in the JSON).
  const stationName = c.stationName ?? c.label
  if (stationName) {
    const station = findStation(stationName)
    if (station) return { lat: station.lat, lng: station.lng, id: stationName, confidenceRadiusMeters: DEFAULT_TRANSPORT_RADIUS_M, label: station.name }
  }
  return null
}

/**
 * Resolve any "inside" constraint to IRIS zones — supports all entity types.
 * Returns empty array if the constraint can't be resolved.
 */
function resolveInsideToIris(
  c: GeoConstraint,
  iris: GeoZone[],
  quartiers: GeoZone[],
): GeoZone[] {
  if (c.type === 'administrative_area' && c.zoneId) {
    const zoneIris = getIrisInZone(c.zoneId, iris, quartiers)
    return c.direction ? filterIrisByDirection(zoneIris, c.direction) : zoneIris
  }

  if (c.type === 'semantic_neighborhood' || c.type === ('neighborhood' as ConstraintType)) {
    const n = resolveNeighborhoodCoords(c)
    if (n) {
      const radius = c.radiusM ?? n.confidenceRadiusMeters
      let nearIris = filterIrisByCoords(iris, n.lat, n.lng, radius)
      if (n.maxSelectedIris) {
        nearIris = capIrisByDistance(nearIris, n.lat, n.lng, n.maxSelectedIris)
      }
      return nearIris
    }
    // Fallback: match against quartiers administratifs (GeoJSON).
    // Covers names absent from semanticNeighborhoods.json: Épinettes, Gros-Caillou,
    // Plaine-de-Monceaux, Folie-Méricourt, Saint-Fargeau, Javel, etc.
    const qaLabel = c.stationName ?? c.label
    const matchedQAs = matchQuartiersByName(qaLabel, quartiers)
    if (matchedQAs.length > 0 && matchedQAs.length <= 4) {
      const qaIds = new Set(matchedQAs.map(q => q.id))
      return iris.filter(z => z.parentId && qaIds.has(z.parentId))
    }
    return []
  }

  if (c.type === 'transport_station') {
    const name = c.stationName ?? c.label
    const station = name ? findStation(name) : null
    if (!station) return []
    const radius = c.radiusM ?? DEFAULT_TRANSPORT_RADIUS_M
    return filterIrisByCoords(iris, station.lat, station.lng, radius)
  }

  if (c.type === 'poi') {
    const r = c.radiusM ?? poiRadius(c.poiType)

    // When parentArrIds is set, restrict results to those arrondissements.
    // Prevents endpoint-overshoot false positives when a street runs along
    // an arr boundary (e.g. Avenue des Ternes / Faubourg du Roule at 17e/8e).
    const filterByArr = (zones: GeoZone[]): GeoZone[] => {
      if (!c.parentArrIds?.length) return zones
      const allowed = new Set(c.parentArrIds)
      return zones.filter(z => {
        if (z.parentId?.startsWith('arr-')) return allowed.has(z.parentId)
        if (z.parentId?.startsWith('qu-')) {
          const q = quartiers.find(q => q.id === z.parentId)
          return q?.parentId ? allowed.has(q.parentId) : false
        }
        return false
      })
    }

    // 1. Geometry: precise coverage (LineString/Polygon) — preferred for non-point features
    if (c.geometry && c.geometry.type !== 'Point') {
      const g = filterByArr(filterIrisByGeometry(iris, c.geometry, r))
      if (g.length > 0) return g
    }
    // 2. Bounding box: reliable coverage of the full spatial extent of a street/POI
    if (c.bbox) {
      const buf = STREET_POI_TYPES.has(c.poiType ?? '') ? 120 : 80
      const b = filterByArr(filterIrisByBbox(iris, c.bbox, buf))
      if (b.length > 0) return b
    }
    // 3. Point + radius fallback
    if (c.lat !== undefined && c.lng !== undefined) {
      return filterByArr(filterIrisByCoords(iris, c.lat, c.lng, r))
    }
  }

  return []
}

/**
 * Resolve an "exclude" constraint to the IRIS zones that should be removed.
 * Searches within `candidates` for neighborhood/station excludes (to avoid
 * removing IRIS from a different zone entirely).
 */
function resolveExcludeToIris(
  c: GeoConstraint,
  candidates: GeoZone[],
  allIris: GeoZone[],
  quartiers: GeoZone[],
): GeoZone[] {
  if (c.type === 'administrative_area' && c.zoneId) {
    return getIrisInZone(c.zoneId, allIris, quartiers)
  }

  if (c.type === 'semantic_neighborhood' || c.type === ('neighborhood' as ConstraintType)) {
    const n = resolveNeighborhoodCoords(c)
    if (n) {
      const radius = c.radiusM ?? n.confidenceRadiusMeters
      return filterIrisByCoords(candidates, n.lat, n.lng, radius)
    }
    // Fallback: match against quartiers administratifs.
    // Critical for exclusions like "Paris 17 mais pas les Épinettes":
    // Épinettes is a QA of arr-17, not in semanticNeighborhoods.json.
    // Radius-based exclusion would be imprecise; parentId-based is exact.
    const qaLabel = c.stationName ?? c.label
    const matchedQAs = matchQuartiersByName(qaLabel, quartiers)
    if (matchedQAs.length > 0 && matchedQAs.length <= 4) {
      const qaIds = new Set(matchedQAs.map(q => q.id))
      // Exclude IRIS by exact parentId — not by radius, which would be imprecise
      return allIris.filter(z => z.parentId && qaIds.has(z.parentId))
    }
    return []
  }

  if (c.type === 'transport_station') {
    const name = c.stationName ?? c.label
    const station = name ? findStation(name) : null
    if (!station) return []
    const radius = c.radiusM ?? DEFAULT_TRANSPORT_RADIUS_M
    return filterIrisByCoords(candidates, station.lat, station.lng, radius)
  }

  return []
}

// ─── Between-entities helpers ──────────────────────────────────────────────

function getEntityCoordinates(
  c: GeoConstraint,
  iris: GeoZone[],
  quartiers: GeoZone[],
): [number, number] | null {
  if (c.type === 'semantic_neighborhood') {
    const n = resolveNeighborhoodCoords(c)
    if (n) return [n.lat, n.lng]
  }

  if (c.type === 'transport_station') {
    const name = c.stationName ?? c.label
    if (name) {
      const s = findStation(name)
      if (s) return [s.lat, s.lng]
    }
  }

  if (c.type === 'administrative_area' && c.zoneId) {
    const zoneIris = getIrisInZone(c.zoneId, iris, quartiers)
    const centroids = zoneIris.map(irisCentroid).filter(Boolean) as [number, number][]
    if (centroids.length) {
      return [
        centroids.reduce((s, ci) => s + ci[0], 0) / centroids.length,
        centroids.reduce((s, ci) => s + ci[1], 0) / centroids.length,
      ]
    }
  }

  return null
}

function selectIntermediateArea(
  betweenCs: GeoConstraint[],
  iris: GeoZone[],
  quartiers: GeoZone[],
): ConstraintResolutionResult {
  const coords = betweenCs.map(c => getEntityCoordinates(c, iris, quartiers))
  if (coords.some(c => c === null)) {
    return { irisIds: [], fallbackZoneIds: [], matchSummary: [], wasNarrowed: false }
  }

  const [c1, c2] = coords as [number, number][]
  const distance = haversineM(c1[0], c1[1], c2[0], c2[1])

  if (distance > 5000) {
    return { irisIds: [], fallbackZoneIds: [], matchSummary: [], wasNarrowed: false }
  }

  const midLat = (c1[0] + c2[0]) / 2
  const midLng = (c1[1] + c2[1]) / 2
  const radius = Math.min(Math.max(distance * 0.60, 400), 1500)

  let nearIris = filterIrisByCoords(iris, midLat, midLng, radius)
  if (nearIris.length > 20) {
    nearIris = capIrisByDistance(nearIris, midLat, midLng, 20)
  }
  if (nearIris.length === 0) {
    return { irisIds: [], fallbackZoneIds: [], matchSummary: [], wasNarrowed: false }
  }

  const label1 = betweenCs[0].stationName ?? betweenCs[0].label
  const label2 = betweenCs[1].stationName ?? betweenCs[1].label

  return {
    irisIds: nearIris.map(z => z.id),
    fallbackZoneIds: [],
    matchSummary: [`entre ${label1} et ${label2}`],
    wasNarrowed: true,
    suggestedCenter: [midLat, midLng],
  }
}

// ─── Operator normalization ────────────────────────────────────────────────

/**
 * Convert "near" → "inside" for neighborhoods AND transport stations when the
 * entity doesn't spatially overlap with the pool built from all "inside" constraints.
 *
 * Why: the LLM often generates operator:"near" for neighborhoods and stations
 * even in addition context. When the entity is geographically outside the existing
 * union pool, treating it as a filter yields zero intersection and silently drops
 * it. Converting to "inside" restores the intended union semantics.
 *
 * Examples that benefit:
 *   "métro Nation et Batignolles"     → Nation (near) far from Batignolles → inside
 *   "Batignolles et Paris 18e"        → Batignolles (near) outside arr-18 → inside
 *   "Paris 12 proche métro Nation"    → Nation overlaps arr-12 → stays near (filter ✓)
 *
 * transport_line is never converted — lines are always proximity filters.
 */
function normalizeNearToInside(
  constraints: GeoConstraint[],
  iris: GeoZone[],
  quartiers: GeoZone[],
): GeoConstraint[] {
  if (!iris.length) return constraints

  // Build reference pool from all "inside" constraints (admin + neighborhood + station)
  const insideConstraints = constraints.filter(c => c.operator === 'inside')
  if (insideConstraints.length === 0) return constraints // all "near" → standalone path handles union

  const refIds = new Set<string>()
  const refIris: GeoZone[] = []

  for (const c of insideConstraints) {
    let zoneIris: GeoZone[] = []
    if (c.type === 'administrative_area' && c.zoneId) {
      zoneIris = getIrisInZone(c.zoneId, iris, quartiers)
    } else if (c.type === 'semantic_neighborhood' || c.type === ('neighborhood' as ConstraintType)) {
      const n = resolveNeighborhoodCoords(c)
      if (n) zoneIris = filterIrisByCoords(iris, n.lat, n.lng, c.radiusM ?? n.confidenceRadiusMeters)
    } else if (c.type === 'transport_station') {
      const name = c.stationName ?? c.label
      const station = name ? findStation(name) : null
      if (station) zoneIris = filterIrisByCoords(iris, station.lat, station.lng, c.radiusM ?? DEFAULT_TRANSPORT_RADIUS_M)
    } else if (c.type === 'poi') {
      zoneIris = c.geometry
        ? filterIrisByGeometry(iris, c.geometry, c.radiusM ?? poiRadius(c.poiType))
        : (c.lat !== undefined && c.lng !== undefined)
          ? filterIrisByCoords(iris, c.lat, c.lng, c.radiusM ?? poiRadius(c.poiType))
          : []
    }
    for (const z of zoneIris) if (!refIds.has(z.id)) { refIds.add(z.id); refIris.push(z) }
  }

  if (refIris.length === 0) return constraints

  return constraints.map(c => {
    if (c.operator !== 'near') return c

    // administrative_area "near" is semantically invalid (you can't be "near" an arrondissement).
    // The LLM sometimes generates it when a station name is mapped to its arrondissement context.
    // Always convert to "inside" so the zone contributes to the union pool.
    if (c.type === 'administrative_area' && c.zoneId) {
      return { ...c, operator: 'inside' as ConstraintOperator }
    }

    const isNbhd = c.type === 'semantic_neighborhood' || c.type === ('neighborhood' as ConstraintType)
    const isStation = c.type === 'transport_station'
    const isPoi = c.type === 'poi' && (c.geometry != null || c.lat !== undefined)
    if (!isNbhd && !isStation && !isPoi) return c  // transport_line: always a filter

    // For poi: check overlap using geometry then bbox
    if (isPoi) {
      const r = c.radiusM ?? poiRadius(c.poiType)
      let overlap = 0
      if (c.geometry && c.geometry.type !== 'Point') overlap = filterIrisByGeometry(refIris, c.geometry, r).length
      else if (c.bbox) overlap = filterIrisByBbox(refIris, c.bbox, 120).length
      else if (c.lat !== undefined && c.lng !== undefined) overlap = filterIrisByCoords(refIris, c.lat, c.lng, r).length
      return overlap > 0 ? c : { ...c, operator: 'inside' as ConstraintOperator }
    }

    let entityLat: number, entityLng: number, entityRadius: number
    if (isPoi) {
      entityLat = c.lat!; entityLng = c.lng!; entityRadius = c.radiusM ?? poiRadius(c.poiType)
    } else if (isNbhd) {
      const n = resolveNeighborhoodCoords(c)
      if (!n) return c
      entityLat = n.lat; entityLng = n.lng; entityRadius = c.radiusM ?? n.confidenceRadiusMeters
    } else if (isStation) {
      const name = c.stationName ?? c.label
      const station = name ? findStation(name) : null
      if (!station) return c
      entityLat = station.lat; entityLng = station.lng; entityRadius = c.radiusM ?? DEFAULT_TRANSPORT_RADIUS_M
    } else {
      return c
    }

    const overlaps = filterIrisByCoords(refIris, entityLat, entityLng, entityRadius).length > 0
    return overlaps ? c : { ...c, operator: 'inside' as ConstraintOperator }
  })
}

// ─── Main resolver ─────────────────────────────────────────────────────────

/**
 * Resolve structured GeoConstraints to concrete IRIS zone IDs.
 *
 * Operator semantics (ALL entity types):
 *   "inside"  → add this entity's IRIS to the union pool
 *   "near"    → filter the union pool by proximity (intersection)
 *   "exclude" → subtract this entity's IRIS from the result
 *   "between" → build an intermediate zone between two entities
 *
 * This correctly handles mixed-type additions like "Paris 12 et Batignolles":
 *   → arr-12 IRIS  ∪  Batignolles IRIS  (not arr-12 filtered by Batignolles)
 *
 * And exclusions of non-admin zones like "Paris 17 mais pas les Épinettes":
 *   → arr-17 IRIS  minus  Épinettes IRIS
 */
export function resolveConstraints(
  constraints: GeoConstraint[],
  iris: GeoZone[],
  quartiers: GeoZone[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _communes: GeoZone[]
): ConstraintResolutionResult {
  const summary: string[] = []

  // ── Between path ───────────────────────────────────────────────────────────
  const betweenConstraints = constraints.filter(c => c.operator === 'between')
  if (betweenConstraints.length >= 2 && iris.length > 0) {
    const result = selectIntermediateArea(betweenConstraints.slice(0, 2), iris, quartiers)
    if (result.wasNarrowed) return result
  }

  // ── Normalize: "near" entity outside the existing union pool → "inside" ────
  // Handles LLM defaulting to "near" for neighborhoods/stations in addition context.
  const normalized = normalizeNearToInside(constraints, iris, quartiers)

  // ── Partition by operation ─────────────────────────────────────────────────
  const includeConstraints = normalized.filter(c => c.operator === 'inside')
  const filterConstraints  = normalized.filter(c => c.operator === 'near' || c.operator === 'around')
  const excludeConstraints = normalized.filter(c => c.operator === 'exclude')

  // Fallback zone IDs for map centering / zoom (admin areas only)
  const fallbackZoneIds = includeConstraints
    .filter(c => c.type === 'administrative_area' && c.zoneId)
    .map(c => c.zoneId as string)

  if (!iris.length) {
    return { irisIds: [], fallbackZoneIds, matchSummary: [], wasNarrowed: false }
  }

  // ── Step 1: Build union pool from all "inside" constraints ─────────────────
  const seen = new Set<string>()
  const unionIris: GeoZone[] = []
  const hasDirectional = includeConstraints.some(c => c.direction)

  for (const c of includeConstraints) {
    const zoneIris = resolveInsideToIris(c, iris, quartiers)
    for (const z of zoneIris) {
      if (!seen.has(z.id)) {
        seen.add(z.id)
        unionIris.push(z)
      }
    }
    if (zoneIris.length > 0) summary.push(c.label)
  }

  // No "inside" constraints: union ALL "near" neighborhoods and stations independently.
  // Multiple entities (e.g. "Batignolles et Aligre" both with operator:"near") are
  // all resolved and unioned — not returned on first match.
  if (unionIris.length === 0) {
    const standaloneIds = new Set<string>()
    const standaloneIris: GeoZone[] = []
    const standaloneLabels: string[] = []

    for (const c of filterConstraints) {
      if (c.type === 'semantic_neighborhood' || c.type === ('neighborhood' as ConstraintType)) {
        const n = resolveNeighborhoodCoords(c)
        if (n) {
          const radius = c.radiusM ?? n.confidenceRadiusMeters
          let nearIris = filterIrisByCoords(iris, n.lat, n.lng, radius)
          if (n.maxSelectedIris) nearIris = capIrisByDistance(nearIris, n.lat, n.lng, n.maxSelectedIris)
          for (const z of nearIris) if (!standaloneIds.has(z.id)) { standaloneIds.add(z.id); standaloneIris.push(z) }
          if (nearIris.length > 0) standaloneLabels.push(n.label)
        }
      }
      if (c.type === 'transport_station') {
        const name = c.stationName ?? c.label
        const station = name ? findStation(name) : null
        if (station) {
          const radius = c.radiusM ?? DEFAULT_TRANSPORT_RADIUS_M
          for (const z of filterIrisByCoords(iris, station.lat, station.lng, radius)) {
            if (!standaloneIds.has(z.id)) { standaloneIds.add(z.id); standaloneIris.push(z) }
          }
          standaloneLabels.push(name)
        }
      }
      if (c.type === 'poi') {
        const r = c.radiusM ?? poiRadius(c.poiType)
        let poiZones: GeoZone[] = []
        if (c.geometry && c.geometry.type !== 'Point') poiZones = filterIrisByGeometry(iris, c.geometry, r)
        if (!poiZones.length && c.bbox) poiZones = filterIrisByBbox(iris, c.bbox, STREET_POI_TYPES.has(c.poiType ?? '') ? 120 : 80)
        if (!poiZones.length && c.lat !== undefined && c.lng !== undefined) poiZones = filterIrisByCoords(iris, c.lat, c.lng, r)
        for (const z of poiZones) {
          if (!standaloneIds.has(z.id)) { standaloneIds.add(z.id); standaloneIris.push(z) }
        }
        if (poiZones.length > 0) standaloneLabels.push(c.label)
      }
    }

    if (standaloneIris.length > 0) {
      return { irisIds: standaloneIris.map(z => z.id), fallbackZoneIds: [], matchSummary: standaloneLabels, wasNarrowed: true }
    }
    return { irisIds: [], fallbackZoneIds, matchSummary: [], wasNarrowed: false }
  }

  // ── Step 2: Apply filter constraints (intersection) ────────────────────────
  let narrowed = [...unionIris]

  for (const c of filterConstraints) {
    if (c.confidence < 0.6) continue
    let filtered = narrowed

    if (c.type === 'transport_line' && c.line) {
      filtered = filterIrisByTransportLine(narrowed, c.line, c.radiusM)
      if (filtered.length > 0) summary.push(`proche ligne ${c.line}`)
    } else if (c.type === 'transport_station') {
      const name = c.stationName ?? c.label
      if (name) {
        filtered = filterIrisByStation(narrowed, name, c.radiusM)
        if (filtered.length > 0) summary.push(`proche ${name}`)
      }
    } else if (c.type === 'semantic_neighborhood' || c.type === ('neighborhood' as ConstraintType)) {
      const n = resolveNeighborhoodCoords(c)
      if (n) {
        const radius = c.radiusM ?? n.confidenceRadiusMeters
        let nbFiltered = filterIrisByCoords(narrowed, n.lat, n.lng, radius)
        if (n.maxSelectedIris) nbFiltered = capIrisByDistance(nbFiltered, n.lat, n.lng, n.maxSelectedIris)
        filtered = nbFiltered
        if (filtered.length > 0) summary.push(n.label)
      }
    } else if (c.type === 'poi') {
      const r = c.radiusM ?? poiRadius(c.poiType)
      if (c.geometry && c.geometry.type !== 'Point') filtered = filterIrisByGeometry(narrowed, c.geometry, r)
      else if (c.bbox) filtered = filterIrisByBbox(narrowed, c.bbox, STREET_POI_TYPES.has(c.poiType ?? '') ? 120 : 80)
      else if (c.lat !== undefined && c.lng !== undefined) filtered = filterIrisByCoords(narrowed, c.lat, c.lng, r)
      if (filtered.length > 0) summary.push(c.label)
    }

    if (filtered.length > 0) narrowed = filtered
  }

  // ── Step 3: Apply exclude constraints (subtraction) ───────────────────────
  for (const c of excludeConstraints) {
    const toExclude = resolveExcludeToIris(c, narrowed, iris, quartiers)
    if (toExclude.length > 0) {
      const excludedIds = new Set(toExclude.map(z => z.id))
      narrowed = narrowed.filter(z => !excludedIds.has(z.id))
    }
  }

  // Non-admin includes (neighborhood, station) always produce a fine-grained
  // coordinate-based IRIS selection — treat as narrowed even without filtering.
  const hasNonAdminInclude = includeConstraints.some(c => c.type !== 'administrative_area')

  const wasNarrowed =
    narrowed.length > 0 &&
    (hasDirectional ||
      hasNonAdminInclude ||
      filterConstraints.length > 0 ||
      excludeConstraints.length > 0 ||
      narrowed.length < unionIris.length)

  return {
    irisIds: narrowed.length > 0 ? narrowed.map(z => z.id) : [],
    fallbackZoneIds,
    matchSummary: summary,
    wasNarrowed,
  }
}
