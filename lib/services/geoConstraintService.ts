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
import { findQuartierById, normalizeIrisName } from './quartierMatchingService'

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
  irisNames?: string[]     // explicit IRIS names from quartiers.json — used for direct name-based lookup
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
 * Select IRIS whose polygon is within radiusM of the given POI geometry.
 *
 * Algorithm:
 *   1. Sample the POI geometry boundary every 20m.
 *   2. For each sample point P, compute the minimum distance from P to each
 *      IRIS polygon (using distanceStationToIris — polygon-edge distance).
 *   3. Select IRIS where any sample point is within radiusM.
 *
 * Differences from filterIrisByGeometry:
 *   filterIrisByGeometry: finds IRIS whose polygon CONTAINS a sample±8m offset.
 *     → only selects IRIS immediately adjacent (≤8m). Correct for streets.
 *   filterIrisByGeometryProximity: finds IRIS within radiusM of the boundary.
 *     → selects all IRIS within radiusM. Correct for "proche de X" POI queries.
 */
function filterIrisByGeometryProximity(
  candidates: GeoZone[],
  geometry: GeoJSON.Geometry,
  radiusM: number,
): GeoZone[] {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates as [number, number]
    return candidates.filter(z => distanceStationToIris(lat, lng, z) <= radiusM)
  }

  const samples = sampleGeometryPoints(geometry, 20)
  if (!samples.length) return []

  const selected = new Set<string>()
  for (const [sLat, sLng] of samples) {
    for (const zone of candidates) {
      if (!selected.has(zone.id) && distanceStationToIris(sLat, sLng, zone) <= radiusM) {
        selected.add(zone.id)
      }
    }
    if (selected.size === candidates.length) break  // all selected — early exit
  }
  return candidates.filter(z => selected.has(z.id))
}

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

// Polygon-edge distance from station to IRIS boundary.
// 350m ≈ 4-5 min walk — matches transportStations.json defaultRadiusMeters.
// Was 650 when coordinates were hand-entered (~200-1000m off); now that coords
// are GPS-accurate from transportStations.json, 350 gives a tight correct selection.
const DEFAULT_TRANSPORT_RADIUS_M = 350

// Smaller radius for exclusions: targets the immediate micro-sector around a
// station/place (e.g. "Boulogne sauf Marcel Sembat"), not the full inclusion zone.
const EXCLUDE_STATION_RADIUS_M = 200

// Radius used when selecting/excluding IRIS around a GPS point via polygon-edge
// distance. An IRIS whose boundary intersects a circle of this radius is included.
const GPS_POINT_RADIUS_M = 200

// All metro line IDs (used when line:"metro" = any metro station)
const METRO_LINE_IDS = ['1','2','3','3b','4','5','6','7','7b','8','9','10','11','12','13','14']
const RER_LINE_IDS   = ['A','B','C','D','E']

/**
 * Minimum distance (metres) from a station point to the nearest point ON an IRIS polygon.
 *
 * Rules:
 *   • Station inside the IRIS polygon → distance 0 (always select).
 *   • Otherwise → nearest point on any polygon edge (flat-earth projection, valid < 5 km).
 *
 * Using polygon-edge distance rather than centroid distance ensures that IRIS zones
 * which contain a station entrance are always selected, and that the threshold applies
 * to the actual boundary rather than a potentially-far centroid.
 */
function distanceStationToIris(sLat: number, sLng: number, zone: GeoZone): number {
  const geom = zone.feature.geometry
  // Station inside → always zero distance
  if (polygonContainsPoint(geom, sLng, sLat)) return 0

  const rings: GeoJSON.Position[][] =
    geom.type === 'Polygon' ? (geom as GeoJSON.Polygon).coordinates :
    geom.type === 'MultiPolygon' ? (geom as GeoJSON.MultiPolygon).coordinates.flat() : []

  const cosLat = Math.cos(sLat * Math.PI / 180)
  let minDist = Infinity

  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      // Segment endpoints in metres relative to station (flat-earth)
      const ax = (ring[i][0] - sLng) * 111_320 * cosLat
      const ay = (ring[i][1] - sLat) * 111_320
      const bx = (ring[i + 1][0] - sLng) * 111_320 * cosLat
      const by = (ring[i + 1][1] - sLat) * 111_320
      const dx = bx - ax, dy = by - ay
      const lenSq = dx * dx + dy * dy
      const t = lenSq < 1e-6 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq))
      const nx = ax + t * dx, ny = ay + t * dy
      const d = Math.sqrt(nx * nx + ny * ny)
      if (d < minDist) minDist = d
      if (minDist === 0) return 0  // can't improve
    }
  }
  return minDist
}

/**
 * Select IRIS whose polygon boundary intersects a circle of radiusM around a GPS point.
 * An IRIS that contains the point has distance 0 — always selected.
 *
 * More precise than filterIrisByCoords (centroid-based): a large IRIS polygon may have
 * its centroid far from the point while its edge is very close, and vice-versa.
 * This matches the user expectation: "IRIS touching a 150m circle around Marcel Sembat."
 */
function filterIrisByPoint(
  candidates: GeoZone[],
  lat: number,
  lng: number,
  radiusM: number,
): GeoZone[] {
  return candidates.filter(z => distanceStationToIris(lat, lng, z) <= radiusM)
}

function filterIrisByTransportLine(
  candidates: GeoZone[],
  line: string,
  radiusM = DEFAULT_TRANSPORT_RADIUS_M
): GeoZone[] {
  const normalizedLine = normalizeLineId(line)

  // Special values: "metro" or "rer" = any station on that network.
  // normalizeLineId returns uppercase ("METRO", "RER") for bare network names.
  // Uses polygon-edge distance: IRIS containing a station → always selected;
  // IRIS outside → selected if nearest polygon point is within radiusM.
  if (normalizedLine === 'METRO' || normalizedLine === 'RER') {
    const lineIds = normalizedLine === 'METRO' ? METRO_LINE_IDS : RER_LINE_IDS
    const seen = new Map<string, { lat: number; lng: number }>()
    for (const l of lineIds) {
      for (const s of getStationsByLine(l)) {
        if (!seen.has(s.name)) seen.set(s.name, { lat: s.lat, lng: s.lng })
      }
    }
    const allStations = [...seen.values()]
    return candidates.filter((zone) =>
      allStations.some((s) => distanceStationToIris(s.lat, s.lng, zone) <= radiusM)
    )
  }

  const stations = getStationsByLine(normalizedLine)
  if (!stations.length) return candidates

  // Use polygon-edge distance (distanceStationToIris) — same method as the generic
  // METRO/RER path above. Centroid-to-point (haversineM) was used before and caused
  // both false positives (centroid close but edge far) and false negatives (edge close
  // but centroid beyond the threshold).
  return candidates.filter((zone) =>
    stations.some((s) => distanceStationToIris(s.lat, s.lng, zone) <= radiusM)
  )
}

function filterIrisByStation(
  candidates: GeoZone[],
  stationName: string,
  radiusM = DEFAULT_TRANSPORT_RADIUS_M
): GeoZone[] {
  const station = findStation(stationName)
  if (!station) return candidates

  // Polygon-edge distance: selects IRIS whose nearest boundary point is within radiusM.
  // Previously used haversineM(centroid, station) which missed IRIS where the edge is
  // close but the centroid is beyond the threshold.
  return candidates.filter((zone) =>
    distanceStationToIris(station.lat, station.lng, zone) <= radiusM
  )
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
    // 1a. Explicit IRIS ID list (globally unique — used for curated zones like zone-periph).
    const quartier = c.neighborhoodId ? findQuartierById(c.neighborhoodId) : null
    const irisIdList = quartier?.irisIds
    if (irisIdList?.length) {
      const idSet = new Set(irisIdList)
      const matched = iris.filter(z => idSet.has(z.id))
      if (matched.length > 0) return matched
    }

    // 1b. Explicit IRIS name list from quartiers.json — most precise resolution
    //    Try irisNames on the constraint first, then look up by neighborhoodId.
    const irisNamesToResolve = c.irisNames
      ?? quartier?.irisNames
    if (irisNamesToResolve?.length) {
      const nameSet = new Set(irisNamesToResolve.map(normalizeIrisName))
      const matched = iris.filter(z =>
        nameSet.has(normalizeIrisName(z.name)) ||
        nameSet.has(normalizeIrisName(z.shortName))
      )
      if (matched.length > 0) return matched
      // Fall through if no IRIS found by name (data mismatch) — try radius below
    }

    // 2. Radius-based resolution from semanticNeighborhoods.json
    const n = resolveNeighborhoodCoords(c)
    if (n) {
      const radius = c.radiusM ?? n.confidenceRadiusMeters
      let nearIris = filterIrisByPoint(iris, n.lat, n.lng, radius)
      if (n.maxSelectedIris) {
        nearIris = capIrisByDistance(nearIris, n.lat, n.lng, n.maxSelectedIris)
      }
      return nearIris
    }

    // 3. Fallback: match against quartiers administratifs (GeoJSON names).
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
    const radius = c.radiusM ?? GPS_POINT_RADIUS_M
    return filterIrisByPoint(iris, station.lat, station.lng, radius)
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

    // 1. Non-point geometry — two strategies depending on POI type:
    //    • Streets (rue, avenue, boulevard…): filterIrisByGeometry captures IRIS on
    //      both sides of the centerline via perpendicular ±8m offsets.
    //    • Place/landmark POIs: filterIrisByGeometryProximity selects all IRIS whose
    //      polygon is within radiusM of any sampled point on the POI boundary.
    //      This correctly handles "proche République" (radius=100m): IRIS that
    //      border the place are at distance 0; IRIS 50-100m away are also included.
    if (c.geometry && c.geometry.type !== 'Point') {
      if (STREET_POI_TYPES.has(c.poiType ?? '')) {
        const g = filterByArr(filterIrisByGeometry(iris, c.geometry, r))
        if (g.length > 0) return g
      } else {
        const g = filterByArr(filterIrisByGeometryProximity(iris, c.geometry, r))
        if (g.length > 0) return g
      }
    }
    // 2. Bounding box: centroid-based fallback for when only bbox is available
    if (c.bbox) {
      const buf = STREET_POI_TYPES.has(c.poiType ?? '') ? 120 : 80
      const b = filterByArr(filterIrisByBbox(iris, c.bbox, buf))
      if (b.length > 0) return b
    }
    // 3. Point POI: polygon-edge distance from the geocoded center point
    if (c.lat !== undefined && c.lng !== undefined) {
      const byEdge = filterByArr(iris.filter(z => distanceStationToIris(c.lat!, c.lng!, z) <= r))
      if (byEdge.length > 0) return byEdge
      return filterByArr(filterIrisByCoords(iris, c.lat, c.lng, r))
    }
  }

  return []
}

/**
 * Resolve an "exclude" constraint to the IRIS zones that should be removed.
 *
 * Resolution hierarchy (mirrors resolveInsideToIris for semantic neighborhoods):
 *   1. explicit irisNames from quartiers.json        — most precise, polygon-free
 *   2. radius from semanticNeighborhoods.json        — center + confidenceRadius
 *   3. quartier administratif (parentId)             — exact administrative boundary
 *   4. transport station with EXCLUDE_STATION_RADIUS  — micro-sector only
 *   5. POI geometry or point (supports poi type)      — previously silently ignored
 *
 * Logs a warning to console when an exclusion cannot be resolved, so missing
 * database entries are visible rather than silently dropping the constraint.
 *
 * Searches within `candidates` (current narrowed pool) for proximity-based excludes
 * to avoid removing IRIS from a different zone. Uses `allIris` for irisNames lookups
 * (consistent with resolveInsideToIris).
 */
function resolveExcludeToIris(
  c: GeoConstraint,
  candidates: GeoZone[],
  allIris: GeoZone[],
  quartiers: GeoZone[],
): GeoZone[] {
  const warn = (reason: string) => {
    if (typeof window !== 'undefined') {
      console.warn('[geo] exclusion unresolved — label:', c.label, '| type:', c.type, '| reason:', reason)
    }
  }

  if (c.type === 'administrative_area' && c.zoneId) {
    return getIrisInZone(c.zoneId, allIris, quartiers)
  }

  if (c.type === 'semantic_neighborhood' || c.type === ('neighborhood' as ConstraintType)) {
    // 1a. Explicit IRIS ID list (globally unique — curated zones like zone-periph).
    const quartierForExcl = c.neighborhoodId ? findQuartierById(c.neighborhoodId) : null
    const irisIdListForExcl = quartierForExcl?.irisIds
    if (irisIdListForExcl?.length) {
      const idSet = new Set(irisIdListForExcl)
      const matched = allIris.filter(z => idSet.has(z.id))
      if (matched.length > 0) return matched
    }

    // 1b. Explicit IRIS name list from quartiers.json — most precise.
    //    Fixes "Paris 12 mais pas Bercy", "Paris 9 hors Pigalle" etc. where the
    //    excluded entity has a known IRIS list. Previously skipped, causing the
    //    fallback to use a radial zone that excluded too few or too many IRIS.
    const irisNamesToResolve = c.irisNames
      ?? quartierForExcl?.irisNames
    if (irisNamesToResolve?.length) {
      const nameSet = new Set(irisNamesToResolve.map(normalizeIrisName))
      const matched = allIris.filter(z =>
        nameSet.has(normalizeIrisName(z.name)) ||
        nameSet.has(normalizeIrisName(z.shortName))
      )
      if (matched.length > 0) return matched
      // Fall through: irisNames present but no IRIS found (data mismatch) — try radius
    }

    // 2. Radius-based from semanticNeighborhoods.json (or station fallback via resolveNeighborhoodCoords).
    //    When resolveNeighborhoodCoords falls back to a station (e.g. "Marcel Sembat" resolved via
    //    the station DB), use EXCLUDE_STATION_RADIUS_M instead of confidenceRadiusMeters (350m) to
    //    target only the micro-sector around the station.
    const n = resolveNeighborhoodCoords(c)
    if (n) {
      const resolvedViaStation = !c.neighborhoodId && !!findStation(c.label)
      const radius = c.radiusM ?? (resolvedViaStation ? GPS_POINT_RADIUS_M : n.confidenceRadiusMeters)
      return filterIrisByPoint(candidates, n.lat, n.lng, radius)
    }

    // 3. Quartier administratif — exact parentId boundary (most precise for QA exclusions)
    //    e.g. "17e sauf Épinettes": Épinettes is a QA of arr-17, not in semanticNeighborhoods.
    const qaLabel = c.stationName ?? c.label
    const matchedQAs = matchQuartiersByName(qaLabel, quartiers)
    if (matchedQAs.length > 0 && matchedQAs.length <= 4) {
      const qaIds = new Set(matchedQAs.map(q => q.id))
      return allIris.filter(z => z.parentId && qaIds.has(z.parentId))
    }

    warn('no irisNames, no semanticNeighborhood coords, no QA match')
    return []
  }

  if (c.type === 'transport_station') {
    const name = c.stationName ?? c.label
    const station = name ? findStation(name) : null
    // Use EXCLUDE_STATION_RADIUS_M (200m): exclusions target the micro-sector around the
    // station, not the full inclusion zone.
    const radius = c.radiusM ?? GPS_POINT_RADIUS_M
    if (station) {
      return filterIrisByPoint(candidates, station.lat, station.lng, radius)
    }
    // Station not in DB (e.g. Transilien, tram, lesser-known stops) — fall back to
    // geocoded coordinates if injected by the front-end pipeline.
    if (c.lat !== undefined && c.lng !== undefined) {
      return filterIrisByPoint(candidates, c.lat, c.lng, radius)
    }
    warn('station not found in DB and no coordinates — geocoding may not have run')
    return []
  }

  if (c.type === 'poi') {
    // POI exclusions were previously silently ignored (no poi branch existed).
    // Supports geometry-based exclusion (polygon/line) and point-based.
    // Uses a reduced default radius: exclusions target the local area, not the
    // full POI influence zone used for inclusions.
    const r = c.radiusM ?? GPS_POINT_RADIUS_M
    if (c.geometry && c.geometry.type !== 'Point') {
      const g = STREET_POI_TYPES.has(c.poiType ?? '')
        ? filterIrisByGeometry(candidates, c.geometry, r)
        : filterIrisByGeometryProximity(candidates, c.geometry, r)
      if (g.length > 0) return g
    }
    if (c.lat !== undefined && c.lng !== undefined) {
      return filterIrisByPoint(candidates, c.lat, c.lng, r)
    }
    warn('poi has no geometry and no lat/lng — geocoding may not have run or failed')
    return []
  }

  warn('unhandled constraint type')
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

    // POI 'near' constraints must always remain as filters when an 'inside' constraint
    // already defines the pool. Promoting a poi to 'inside' would add all IRIS near the
    // poi (from any commune or arrondissement) to the result — the opposite of the
    // intended "inside A AND near B" semantics.
    //
    // Example: "Neuilly proche Bois de Boulogne"
    //   Pool = Neuilly IRIS. Bois boundary is 700-1000m from Neuilly (Paris 16e is between).
    //   overlap check → 0 (no Neuilly IRIS within radiusM of Bois boundary).
    //   OLD: poi promoted to 'inside' → adds Paris 16, Boulogne, Suresnes IRIS.
    //   NEW: poi stays 'near' → filter returns 0 → pool unchanged = Neuilly IRIS only. ✓
    //
    // If the proximity filter returns 0 results, resolveConstraints correctly falls back
    // to the full pool (all Neuilly IRIS) — better than polluting with unrelated zones.
    if (isPoi) return c

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
  //
  // CRITICAL: only enter the standalone path when there are NO inside constraints.
  // If inside constraints exist but resolved to an empty pool (e.g. IRIS cache not
  // yet populated, wrong zoneId, race condition on first mount), we must NOT use the
  // filter constraints as standalone entities — that would select all their IRIS from
  // the entire IDF dataset regardless of the intended geographic scope.
  if (unionIris.length === 0 && includeConstraints.length > 0) {
    return { irisIds: [], fallbackZoneIds, matchSummary: [], wasNarrowed: false }
  }
  if (unionIris.length === 0) {
    const standaloneIds = new Set<string>()
    const standaloneIris: GeoZone[] = []
    const standaloneLabels: string[] = []

    for (const c of filterConstraints) {
      if (c.type === 'semantic_neighborhood' || c.type === ('neighborhood' as ConstraintType)) {
        const saQ = c.neighborhoodId ? findQuartierById(c.neighborhoodId) : null
        let nearIris: GeoZone[] = []
        // IRIS IDs (globally unique — curated zones like zone-periph)
        if (saQ?.irisIds?.length) {
          const idSet = new Set(saQ.irisIds)
          nearIris = iris.filter(z => idSet.has(z.id))
        } else {
          // irisNames lookup
          const irisNamesToResolve = c.irisNames ?? saQ?.irisNames
          if (irisNamesToResolve?.length) {
            const nameSet = new Set(irisNamesToResolve.map(normalizeIrisName))
            nearIris = iris.filter(z =>
              nameSet.has(normalizeIrisName(z.name)) || nameSet.has(normalizeIrisName(z.shortName))
            )
          }
          // Fallback: radius-based from semanticNeighborhoods.json
          if (!nearIris.length) {
            const n = resolveNeighborhoodCoords(c)
            if (n) {
              const radius = c.radiusM ?? n.confidenceRadiusMeters
              nearIris = filterIrisByPoint(iris, n.lat, n.lng, radius)
              if (n.maxSelectedIris) nearIris = capIrisByDistance(nearIris, n.lat, n.lng, n.maxSelectedIris)
            }
          }
        }
        for (const z of nearIris) if (!standaloneIds.has(z.id)) { standaloneIds.add(z.id); standaloneIris.push(z) }
        if (nearIris.length > 0) standaloneLabels.push(c.label)
      }
      if (c.type === 'transport_station') {
        const name = c.stationName ?? c.label
        const station = name ? findStation(name) : null
        if (station) {
          const radius = c.radiusM ?? GPS_POINT_RADIUS_M
          for (const z of filterIrisByPoint(iris, station.lat, station.lng, radius)) {
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
      const filterQ = c.neighborhoodId ? findQuartierById(c.neighborhoodId) : null
      // Static zone via IRIS IDs (globally unique — curated zones like zone-periph)
      const filterIrisIds = filterQ?.irisIds
      if (filterIrisIds?.length) {
        const idSet = new Set(filterIrisIds)
        const idFiltered = narrowed.filter(z => idSet.has(z.id))
        if (idFiltered.length > 0) {
          filtered = idFiltered
          summary.push(c.label)
        }
      } else {
        // Static zone via IRIS names, or radius-based from semanticNeighborhoods.json
        const irisNamesToResolve = c.irisNames ?? filterQ?.irisNames
        if (irisNamesToResolve?.length) {
          const nameSet = new Set(irisNamesToResolve.map(normalizeIrisName))
          const nameFiltered = narrowed.filter(z =>
            nameSet.has(normalizeIrisName(z.name)) || nameSet.has(normalizeIrisName(z.shortName))
          )
          if (nameFiltered.length > 0) {
            filtered = nameFiltered
            summary.push(c.label)
          }
        } else {
          const n = resolveNeighborhoodCoords(c)
          if (n) {
            const radius = c.radiusM ?? n.confidenceRadiusMeters
            let nbFiltered = filterIrisByCoords(narrowed, n.lat, n.lng, radius)
            if (n.maxSelectedIris) nbFiltered = capIrisByDistance(nbFiltered, n.lat, n.lng, n.maxSelectedIris)
            filtered = nbFiltered
            if (filtered.length > 0) summary.push(n.label)
          }
        }
      }
    } else if (c.type === 'poi') {
      const r = c.radiusM ?? poiRadius(c.poiType)
      if (c.geometry && c.geometry.type !== 'Point') {
        // Mirror resolveInsideToIris: streets use side-offset geometry check,
        // non-street POIs use proximity-based check that respects radiusM.
        filtered = STREET_POI_TYPES.has(c.poiType ?? '')
          ? filterIrisByGeometry(narrowed, c.geometry, r)
          : filterIrisByGeometryProximity(narrowed, c.geometry, r)
      }
      else if (c.bbox) filtered = filterIrisByBbox(narrowed, c.bbox, STREET_POI_TYPES.has(c.poiType ?? '') ? 120 : 80)
      else if (c.lat !== undefined && c.lng !== undefined) filtered = filterIrisByCoords(narrowed, c.lat, c.lng, r)
      if (filtered.length > 0) summary.push(c.label)
    }

    if (filtered.length > 0) narrowed = filtered
  }

  // ── DEBUG — structured trace for AREA_EXCLUSION queries ──────────────────
  const hasExcludes = excludeConstraints.length > 0
  if (hasExcludes && typeof window !== 'undefined') {
    const insideParents = [...new Set(unionIris.map(z => z.parentId ?? '').filter(Boolean))]
    console.group('%c[geo] AREA_EXCLUSION trace', 'color:#e67e22;font-weight:bold')
    console.log('insideConstraints :', includeConstraints.map(c => `${c.type}/${c.zoneId ?? c.neighborhoodId ?? c.label}`))
    console.log('insidePool        :', {
      count: unionIris.length,
      parents: insideParents,
      sample: unionIris.slice(0, 5).map(z => z.name),
    })
    if (unionIris.length === 0)
      console.error('⚠️  EMPTY inside pool — will fall through to standalone path (wrong communes risk)')
    console.log('excludeConstraints:', excludeConstraints.map(c => ({
      label: c.label, type: c.type,
      hasGeometry: !!c.geometry, hasLatLng: c.lat !== undefined,
      radiusM: c.radiusM ?? '(default)',
    })))
    console.groupEnd()
  }

  // ── Step 3: Apply exclude constraints (subtraction) ───────────────────────
  const excludeMatches: Array<{ label: string; count: number; sampleIris: string[]; parents: string[] }> = []
  for (const c of excludeConstraints) {
    const toExclude = resolveExcludeToIris(c, narrowed, iris, quartiers)
    if (typeof window !== 'undefined') {
      const ep = [...new Set(toExclude.map(z => z.parentId ?? '').filter(Boolean))]
      excludeMatches.push({ label: c.label, count: toExclude.length, sampleIris: toExclude.slice(0,3).map(z=>z.name), parents: ep })
      if (toExclude.length === 0)
        console.warn('[geo] exclusion returned 0 IRIS — label:', c.label, '| type:', c.type, '| reason: check constraint data above')
    }
    if (toExclude.length > 0) {
      const excludedIds = new Set(toExclude.map(z => z.id))
      narrowed = narrowed.filter(z => !excludedIds.has(z.id))
    }
  }

  // ── DEBUG — final pool after exclusions ───────────────────────────────────
  if (hasExcludes && typeof window !== 'undefined') {
    const finalParents = [...new Set(narrowed.map(z => z.parentId ?? '').filter(Boolean))]
    const violations = narrowed.filter(z => !unionIris.some(u => u.id === z.id))
    console.group('%c[geo] AREA_EXCLUSION result', 'color:#27ae60;font-weight:bold')
    console.log('excludeMatches    :', excludeMatches)
    console.log('finalPool         :', { count: narrowed.length, parents: finalParents, sample: narrowed.slice(0,5).map(z=>z.name) })
    if (violations.length > 0)
      console.error('⚠️  INVARIANT VIOLATED — finalIris ⊄ insidePool. Extra IRIS:', violations.map(z => `${z.name} (parent:${z.parentId})`))
    else
      console.log('✓ invariant: finalIris ⊆ insidePool')
    console.groupEnd()
  }

  // Non-admin includes (neighborhood, station) always produce a fine-grained
  // coordinate-based IRIS selection — treat as narrowed even without filtering.
  const hasNonAdminInclude = includeConstraints.some(c => c.type !== 'administrative_area')

  // ── INVARIANT GUARD: final result must stay within admin-area inside boundaries ──
  // Defensive net against any code path that could leak IRIS outside the intended scope
  // (standalone path bugs, normalizeNearToInside promotions, filter step regressions, etc.).
  // If any administrative_area inside constraint exists, the result MUST be a subset of
  // those zones' IRIS. This is the final guarantee that "Paris 16 proche périph" can
  // never return IRIS from other arrondissements or communes.
  const adminInsideZoneIds = includeConstraints
    .filter(c => c.type === 'administrative_area' && c.zoneId)
    .map(c => c.zoneId as string)
  if (adminInsideZoneIds.length > 0) {
    const allowedIrisIds = new Set<string>()
    for (const zoneId of adminInsideZoneIds) {
      for (const z of getIrisInZone(zoneId, iris, quartiers)) {
        allowedIrisIds.add(z.id)
      }
    }
    const beforeGuard = narrowed.length
    narrowed = narrowed.filter(z => allowedIrisIds.has(z.id))
    if (typeof window !== 'undefined' && beforeGuard !== narrowed.length) {
      console.warn(
        `[geo] INVARIANT GUARD: dropped ${beforeGuard - narrowed.length} IRIS outside admin zones [${adminInsideZoneIds.join(', ')}] — `
        + `something in the resolver leaked out-of-scope IRIS into the result.`
      )
    }
  }

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
