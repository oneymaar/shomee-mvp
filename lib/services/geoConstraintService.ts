/**
 * GeoConstraintService — resolves structured geographic constraints to IRIS zone IDs.
 *
 * Architecture:
 *   User query → LLM extracts GeoConstraint[] → resolveConstraints() → IRIS zone IDs
 *
 * Constraint types (extensible):
 *   - administrative_area   inside/exclude   Paris 9, Vincennes, ...
 *   - transport_line        near             ligne 2, RER A, ...
 *   - transport_station     near/around      station Nation, station Pigalle, ...
 *   - poi                   near/around      Bois de Boulogne, parc, ...  (future)
 *   - relative_position     —                entre X et Y, au nord de X, ... (future)
 *   - lifestyle             prefer           calme, animé, ...              (future)
 */

import type { GeoZone } from './geoDataService'
import { polygonCentroid } from './geoDataService'
import { getStationsByLine, findStation, normalizeLineId } from './metroStationsDb'
import { findNeighborhoodById } from './semanticNeighborhoodService'

// ─── Types ─────────────────────────────────────────────────────────────────

export type ConstraintType =
  | 'administrative_area'
  | 'transport_line'
  | 'transport_station'
  | 'semantic_neighborhood'  // client-side: matched via semanticNeighborhoods.json
  | 'poi'
  | 'relative_position'
  | 'lifestyle'

export type ConstraintOperator =
  | 'inside'    // zone is entirely within
  | 'near'      // within proximity radius
  | 'around'    // centered on the target
  | 'between'   // between two targets (future)
  | 'exclude'   // must not be in/near
  | 'prefer'    // soft preference (lifestyle)

export interface GeoConstraint {
  type: ConstraintType
  label: string                // human-readable, e.g. "Paris 9e", "ligne 2"
  operator: ConstraintOperator
  confidence: number           // 0–1, from LLM

  // type-specific fields (only the relevant one is set)
  zoneId?: string              // administrative_area → "arr-9", "com-92050"
  line?: string                // transport_line → "2", "A", "13"
  stationName?: string         // transport_station → "Nation", "Pigalle"
  neighborhoodId?: string      // semantic_neighborhood → "butte_aux_cailles"
  poiType?: string             // poi → "parc", "gare", "marché"
  radiusM?: number             // override default proximity radius (metres)
  /** Directional slice applied to the zone's IRIS pool before secondary constraints.
   *  "north" | "south" | "east" | "west" | "central" | "not_too_peripheral" */
  direction?: string
}

export interface ConstraintResolutionResult {
  /** IRIS zone IDs to pre-select when IRIS is available */
  irisIds: string[]
  /** Fallback zone IDs (arr/commune) when IRIS not yet loaded or no IRIS match */
  fallbackZoneIds: string[]
  /** Human-readable summary of what was matched */
  matchSummary: string[]
  /** True if at least one constraining (non-admin) constraint narrowed the selection */
  wasNarrowed: boolean
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

// ─── IRIS hierarchy helpers ─────────────────────────────────────────────────

/** Get all IRIS zones that are descendants of a given arrondissement or commune zone ID */
function getIrisInZone(zoneId: string, iris: GeoZone[], quartiers: GeoZone[]): GeoZone[] {
  if (zoneId.startsWith('arr-')) {
    // Paris: arr → quartiers → IRIS
    const quartierIds = new Set(
      quartiers.filter((q) => q.parentId === zoneId).map((q) => q.id)
    )
    return iris.filter(
      (i) => i.parentId && (i.parentId === zoneId || quartierIds.has(i.parentId))
    )
  }
  if (zoneId.startsWith('com-')) {
    // Suburb commune: direct parent
    return iris.filter((i) => i.parentId === zoneId)
  }
  return []
}

/** Compute [lat, lng] centroid of an IRIS zone polygon */
function irisCentroid(zone: GeoZone): [number, number] | null {
  try {
    const [lng, lat] = polygonCentroid(zone.feature.geometry)
    return [lat, lng]
  } catch {
    return null
  }
}

// ─── Constraint resolvers ───────────────────────────────────────────────────

const DEFAULT_TRANSPORT_RADIUS_M = 650  // typical walking distance to a metro station

/**
 * Given a set of candidate IRIS zones, keep only those within radiusM of any station
 * on the specified metro/RER line.
 */
function filterIrisByTransportLine(
  candidates: GeoZone[],
  line: string,
  radiusM = DEFAULT_TRANSPORT_RADIUS_M
): GeoZone[] {
  const normalizedLine = normalizeLineId(line)
  const stations = getStationsByLine(normalizedLine)
  if (!stations.length) return candidates // unknown line — don't filter

  return candidates.filter((zone) => {
    const centroid = irisCentroid(zone)
    if (!centroid) return false
    const [lat, lng] = centroid
    return stations.some((s) => haversineM(lat, lng, s.lat, s.lng) <= radiusM)
  })
}

/**
 * Given a set of candidate IRIS zones, keep only those within radiusM of a named station.
 */
function filterIrisByStation(
  candidates: GeoZone[],
  stationName: string,
  radiusM = DEFAULT_TRANSPORT_RADIUS_M
): GeoZone[] {
  const station = findStation(stationName)
  if (!station) return candidates // unknown station — don't filter

  return candidates.filter((zone) => {
    const centroid = irisCentroid(zone)
    if (!centroid) return false
    const [lat, lng] = centroid
    return haversineM(lat, lng, station.lat, station.lng) <= radiusM
  })
}

/**
 * Filter IRIS zones to the directional half (or subset) of their bounding box.
 * Used for "Paris 16 nord", "17e pas trop excentré", etc.
 *
 * Strategy: compute the mid-point (or mean centroid) of all candidates, then keep
 * only the zones on the requested side.  "central" / "not_too_peripheral" keep the
 * innermost 50% / 65% by distance from the mean centroid.
 */
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

/**
 * Given a set of candidate IRIS zones, keep only those within radiusM of explicit coordinates.
 * Used for semantic neighborhoods where the center is defined in the JSON.
 */
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

/**
 * Sort IRIS by ascending distance from a point and cap to maxCount.
 * Ensures the most central zones are kept when too many match.
 */
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

// ─── Main resolver ─────────────────────────────────────────────────────────

/**
 * Resolve structured GeoConstraints to concrete IRIS zone IDs.
 *
 * Algorithm:
 * 1. Find the primary administrative area constraint(s) → candidate IRIS pool
 * 2. Apply each secondary constraint (transport, poi, …) to narrow the pool
 * 3. If result is empty (over-constrained), keep the full primary pool as fallback
 *
 * @param constraints  Structured constraints from LLM analysis
 * @param iris         All loaded IRIS zones (may be empty → returns fallback only)
 * @param quartiers    Paris quartiers (needed for parent resolution)
 * @param communes     Suburban communes
 */
export function resolveConstraints(
  constraints: GeoConstraint[],
  iris: GeoZone[],
  quartiers: GeoZone[],
  communes: GeoZone[]
): ConstraintResolutionResult {
  const summary: string[] = []

  // ── Step 1: primary zones (administrative_area + inside) ─────────────────
  const primaryConstraints = constraints.filter(
    (c) => c.type === 'administrative_area' && c.operator !== 'exclude'
  )
  const excludeConstraints = constraints.filter(
    (c) => c.type === 'administrative_area' && c.operator === 'exclude'
  )
  const secondaryConstraints = constraints.filter(
    (c) => c.type !== 'administrative_area' && c.operator !== 'exclude'
  )

  const fallbackZoneIds = primaryConstraints
    .map((c) => c.zoneId)
    .filter((id): id is string => !!id)

  if (!iris.length) {
    return { irisIds: [], fallbackZoneIds, matchSummary: [], wasNarrowed: false }
  }

  // No-primary-zone paths: station-only or neighborhood-only.
  // Directly select IRIS by coordinates without a zone pool.
  if (!fallbackZoneIds.length) {
    // Semantic neighborhood
    const neighborhoodC = secondaryConstraints.find((c) => c.type === 'semantic_neighborhood' && c.neighborhoodId)
    if (neighborhoodC?.neighborhoodId) {
      const n = findNeighborhoodById(neighborhoodC.neighborhoodId)
      if (n) {
        const radius = neighborhoodC.radiusM ?? n.confidenceRadiusMeters
        let nearIris = filterIrisByCoords(iris, n.center.lat, n.center.lng, radius)
        if (n.maxSelectedIris) {
          nearIris = capIrisByDistance(nearIris, n.center.lat, n.center.lng, n.maxSelectedIris)
        }
        if (nearIris.length > 0) {
          return {
            irisIds: nearIris.map((z) => z.id),
            fallbackZoneIds: [],
            matchSummary: [n.label],
            wasNarrowed: true,
          }
        }
      }
    }

    // Transport station
    const stationC = secondaryConstraints.find((c) => c.type === 'transport_station' && c.stationName)
    if (stationC?.stationName) {
      const station = findStation(stationC.stationName)
      if (station) {
        const radius = stationC.radiusM ?? DEFAULT_TRANSPORT_RADIUS_M
        const nearIris = filterIrisByCoords(iris, station.lat, station.lng, radius)
        if (nearIris.length > 0) {
          return {
            irisIds: nearIris.map((z) => z.id),
            fallbackZoneIds: [],
            matchSummary: [`proche ${stationC.stationName}`],
            wasNarrowed: true,
          }
        }
      }
    }

    return { irisIds: [], fallbackZoneIds: [], matchSummary: [], wasNarrowed: false }
  }

  // ── Step 2: build candidate IRIS pool from primary zones ──────────────────
  // Apply directional filter per zone if specified (e.g. "Paris 16 nord").
  let candidates: GeoZone[] = primaryConstraints.flatMap((c) => {
    if (!c.zoneId) return []
    const zoneIris = getIrisInZone(c.zoneId, iris, quartiers)
    return c.direction ? filterIrisByDirection(zoneIris, c.direction) : zoneIris
  })
  // Deduplicate
  const seen = new Set<string>()
  candidates = candidates.filter((z) => (seen.has(z.id) ? false : (seen.add(z.id), true)))

  if (primaryConstraints.length) {
    summary.push(primaryConstraints.map((c) => c.label).join(' + '))
  }

  // ── Step 3: apply secondary constraints ───────────────────────────────────
  let narrowed = [...candidates]

  for (const c of secondaryConstraints) {
    if (c.confidence < 0.6) continue // low-confidence constraint — skip

    let filtered: GeoZone[] = narrowed

    if (c.type === 'transport_line' && c.line) {
      filtered = filterIrisByTransportLine(narrowed, c.line, c.radiusM)
      if (filtered.length > 0) summary.push(`proche ligne ${c.line}`)
    } else if (c.type === 'transport_station' && c.stationName) {
      filtered = filterIrisByStation(narrowed, c.stationName, c.radiusM)
      if (filtered.length > 0) summary.push(`proche ${c.stationName}`)
    } else if (c.type === 'semantic_neighborhood' && c.neighborhoodId) {
      const n = findNeighborhoodById(c.neighborhoodId)
      if (n) {
        const radius = c.radiusM ?? n.confidenceRadiusMeters
        let nbFiltered = filterIrisByCoords(narrowed, n.center.lat, n.center.lng, radius)
        if (n.maxSelectedIris) {
          nbFiltered = capIrisByDistance(nbFiltered, n.center.lat, n.center.lng, n.maxSelectedIris)
        }
        filtered = nbFiltered
        if (filtered.length > 0) summary.push(n.label)
      }
    }
    // Future: poi, relative_position, lifestyle

    // Only apply constraint if it keeps at least one zone
    if (filtered.length > 0) narrowed = filtered
  }

  // ── Step 4: apply exclude constraints ─────────────────────────────────────
  for (const c of excludeConstraints) {
    if (c.zoneId) {
      const excludedIris = new Set(
        getIrisInZone(c.zoneId, iris, quartiers).map((z) => z.id)
      )
      narrowed = narrowed.filter((z) => !excludedIris.has(z.id))
    }
  }

  const wasNarrowed = narrowed.length > 0 && narrowed.length < candidates.length

  return {
    irisIds: narrowed.length > 0 ? narrowed.map((z) => z.id) : [],
    fallbackZoneIds,
    matchSummary: summary,
    wasNarrowed,
  }
}
