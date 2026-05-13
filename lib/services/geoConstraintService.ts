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
import { polygonCentroid } from './geoDataService'
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
  if (!n) return null
  return { lat: n.center.lat, lng: n.center.lng, id: n.id, confidenceRadiusMeters: n.confidenceRadiusMeters, maxSelectedIris: n.maxSelectedIris, label: n.label }
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
    if (!n) return []
    const radius = c.radiusM ?? n.confidenceRadiusMeters
    let nearIris = filterIrisByCoords(iris, n.lat, n.lng, radius)
    if (n.maxSelectedIris) {
      nearIris = capIrisByDistance(nearIris, n.lat, n.lng, n.maxSelectedIris)
    }
    return nearIris
  }

  if (c.type === 'transport_station') {
    const name = c.stationName ?? c.label
    const station = name ? findStation(name) : null
    if (!station) return []
    const radius = c.radiusM ?? DEFAULT_TRANSPORT_RADIUS_M
    return filterIrisByCoords(iris, station.lat, station.lng, radius)
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

  if (c.type === 'semantic_neighborhood') {
    const n = resolveNeighborhoodCoords(c)
    if (!n) return []
    const radius = c.radiusM ?? n.confidenceRadiusMeters
    return filterIrisByCoords(candidates, n.lat, n.lng, radius)
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
    if (!isNbhd && !isStation) return c  // transport_line: always a filter

    let entityLat: number, entityLng: number, entityRadius: number
    if (isNbhd) {
      const n = resolveNeighborhoodCoords(c)
      if (!n) return c
      entityLat = n.lat; entityLng = n.lng; entityRadius = c.radiusM ?? n.confidenceRadiusMeters
    } else {
      const name = c.stationName ?? c.label
      const station = name ? findStation(name) : null
      if (!station) return c
      entityLat = station.lat; entityLng = station.lng; entityRadius = c.radiusM ?? DEFAULT_TRANSPORT_RADIUS_M
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
