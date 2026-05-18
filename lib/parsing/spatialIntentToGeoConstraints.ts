/**
 * Adapter: SpatialIntent → GeoConstraint[] + full analyze-route response shape.
 *
 * Used by the fast-path in app/api/location/analyze/route.ts when the
 * SpatialIntentParser resolves the query without LLM (requiresLLM=false).
 *
 * Mapping rules (V1):
 *   city / district    → administrative_area (operator: inside)
 *   quartier           → semantic_neighborhood (operator: inside)
 *   transport_station  → transport_station (operator: near — standalone)
 *   street / poi       → poi (operator: near, needs geocoding downstream)
 *   proximity near     → inherited operator from entity type + radiusM
 *   edge_of            → primary entity (inside) + poi (near, radiusM)
 *                        TODO: replace poi+near with geometry-based edge proximity
 *                              (filterIrisByGeometryProximity) once the
 *                              geo engine exposes a native edge_of primitive.
 *   exclusions         → operator: exclude on each excluded entity
 *   between            → operator: between on each primary entity
 */

import type { SpatialEntity, SpatialIntent, SpatialRelation } from './spatialTokens'
import type { GeoConstraint } from '@/lib/services/geoConstraintService'

// ─── Entity-type helpers ──────────────────────────────────────────────────────

function entityLabel(e: SpatialEntity): string {
  return e.label ?? e.rawText
}

function poiTypeFromEntity(e: SpatialEntity): string {
  return e.type === 'street' ? 'street' : 'poi'
}

// ─── Single-entity → GeoConstraint ───────────────────────────────────────────

function entityToConstraint(
  e: SpatialEntity,
  operator: GeoConstraint['operator'],
): GeoConstraint | null {
  switch (e.type) {
    case 'city':
    case 'district':
      return {
        type: 'administrative_area',
        label: entityLabel(e),
        operator,
        confidence: e.confidence,
        zoneId: e.resolvedId,
      }

    case 'quartier':
      return {
        type: 'semantic_neighborhood',
        label: entityLabel(e),
        operator,
        confidence: e.confidence,
        neighborhoodId: e.resolvedId,
      }

    case 'transport_station':
      return {
        type: 'transport_station',
        label: entityLabel(e),
        operator,
        confidence: e.confidence,
        stationName: entityLabel(e),
      }

    case 'street':
    case 'poi':
      return {
        type: 'poi',
        label: entityLabel(e),
        operator,
        confidence: e.confidence,
        poiType: poiTypeFromEntity(e),
      }

    default:
      return null
  }
}

// ─── Resolution strategy ──────────────────────────────────────────────────────

type ResolutionStrategy =
  | 'direct_area_selection'
  | 'semantic_neighborhood_selection'
  | 'point_radius_intersection'
  | 'transport_line_intersection'
  | 'directional_area_slice'
  | 'exclude_from_area'
  | 'between_entities'
  | 'ask_clarification'

function pickStrategy(intent: SpatialIntent): ResolutionStrategy {
  const hasBetween = intent.spatialRelations.some(r => r.type === 'between')
  if (hasBetween) return 'between_entities'

  const hasExclusion = intent.exclusions.length > 0
  if (hasExclusion) return 'exclude_from_area'

  const hasProximity = intent.spatialRelations.some(r => r.type === 'near' || r.type === 'edge_of')
  if (hasProximity) return 'point_radius_intersection'

  const primary = intent.primaryEntities[0]
  if (!primary) return 'ask_clarification'
  if (primary.type === 'quartier') return 'semantic_neighborhood_selection'
  if (primary.type === 'transport_station') return 'point_radius_intersection'
  return 'direct_area_selection'
}

// ─── explicitLocations entry ──────────────────────────────────────────────────

const ENTITY_TYPE_TO_EXPLICIT: Record<SpatialEntity['type'], string> = {
  city: 'commune',
  district: 'arrondissement',
  quartier: 'neighborhood',
  transport_station: 'transport_station',
  poi: 'poi',
  street: 'poi',
  unknown: 'unknown',
}

function entityToExplicitLocation(e: SpatialEntity) {
  return { label: entityLabel(e), type: ENTITY_TYPE_TO_EXPLICIT[e.type], confidence: e.confidence }
}

// ─── preselectQueries ─────────────────────────────────────────────────────────
// Format: "Paris N" or commune name. Only cities and districts qualify.

function buildPreselectQueries(intent: SpatialIntent): string[] {
  const result: string[] = []
  for (const e of intent.primaryEntities) {
    if (e.type === 'district') {
      // arr-11 → "Paris 11"
      const num = e.resolvedId?.replace('arr-', '')
      if (num) result.push(`Paris ${num}`)
    } else if (e.type === 'city') {
      result.push(entityLabel(e))
    }
  }
  return result
}

// ─── centerQuery ──────────────────────────────────────────────────────────────

function buildCenterQuery(intent: SpatialIntent): string {
  const primary = intent.primaryEntities[0]
  if (!primary) return ''
  if (primary.type === 'district') {
    const num = primary.resolvedId?.replace('arr-', '')
    return num ? `Paris ${num}` : entityLabel(primary)
  }
  return entityLabel(primary)
}

// ─── Main converter ───────────────────────────────────────────────────────────

export interface AnalysisResponse {
  status: string
  explicitLocations: ReturnType<typeof entityToExplicitLocation>[]
  inferredConstraints: unknown[]
  geoConstraints: GeoConstraint[]
  resolutionStrategy: ResolutionStrategy
  clarificationQuestion: null
  clarificationOptions: null
  mapAction: { type: string; centerQuery: string; preselectQueries: string[] }
  parserSource: 'spatial_intent_parser'
}

export function intentToAnalysisResponse(intent: SpatialIntent): AnalysisResponse {
  const geoConstraints = intentToGeoConstraints(intent)
  const strategy = pickStrategy(intent)

  return {
    status: 'clear',
    explicitLocations: [
      ...intent.primaryEntities.map(entityToExplicitLocation),
      ...intent.exclusions.map(entityToExplicitLocation),
    ],
    inferredConstraints: [],
    geoConstraints,
    resolutionStrategy: strategy,
    clarificationQuestion: null,
    clarificationOptions: null,
    mapAction: {
      type: 'open_map',
      centerQuery: buildCenterQuery(intent),
      preselectQueries: buildPreselectQueries(intent),
    },
    parserSource: 'spatial_intent_parser',
  }
}

// ─── GeoConstraint[] builder ──────────────────────────────────────────────────

export function intentToGeoConstraints(intent: SpatialIntent): GeoConstraint[] {
  const constraints: GeoConstraint[] = []
  const relation = intent.spatialRelations[0] as SpatialRelation | undefined

  // ── BETWEEN: all entities get operator:"between" ───────────────────────────
  if (relation?.type === 'between') {
    for (const e of intent.primaryEntities) {
      const c = entityToConstraint(e, 'between')
      if (c) constraints.push(c)
    }
    return constraints
  }

  // ── EDGE_OF (côté): primary inside + poi near ──────────────────────────────
  // TODO: once geoConstraintService exposes a native edge_of primitive
  //       (geometry-based bord-à-bord proximity via filterIrisByGeometryProximity),
  //       replace the poi+near fallback here with a proper edge_of constraint.
  if (relation?.type === 'edge_of') {
    for (const e of intent.primaryEntities) {
      const c = entityToConstraint(e, 'inside')
      if (c) constraints.push(c)
    }
    if (relation.targetText) {
      if (relation.targetType === 'neighborhood' && relation.neighborhoodId) {
        constraints.push({
          type: 'semantic_neighborhood',
          label: relation.targetText,
          operator: 'near',
          confidence: relation.confidence,
          neighborhoodId: relation.neighborhoodId,
        })
      } else {
        constraints.push({
          type: 'poi',
          label: relation.targetText,
          operator: 'near',
          confidence: relation.confidence,
          poiType: relation.targetType === 'poi' ? 'park' : 'poi',
          radiusM: relation.radiusM,
        })
      }
    }
    for (const e of intent.exclusions) {
      const c = entityToConstraint(e, 'exclude')
      if (c) constraints.push(c)
    }
    return constraints
  }

  // ── NEAR / PROXIMITY: entity gets its natural operator + radiusM ───────────
  if (relation?.type === 'near') {
    for (const e of intent.primaryEntities) {
      let operator: GeoConstraint['operator'] = 'near'
      // Administrative areas must always use 'inside' (never 'near' per geoConstraintService rule)
      if (e.type === 'city' || e.type === 'district') operator = 'inside'
      const c = entityToConstraint(e, operator)
      if (c) {
        if (relation.radiusM) c.radiusM = relation.radiusM
        constraints.push(c)
      }
    }
    for (const e of intent.exclusions) {
      const c = entityToConstraint(e, 'exclude')
      if (c) constraints.push(c)
    }
    return constraints
  }

  // ── DEFAULT: direct entity resolution ─────────────────────────────────────
  for (const e of intent.primaryEntities) {
    // Standalone transport_station uses 'near' (geoConstraintService standalone path)
    const op: GeoConstraint['operator'] =
      e.type === 'transport_station' ? 'near' : 'inside'
    const c = entityToConstraint(e, op)
    if (c) constraints.push(c)
  }
  for (const e of intent.exclusions) {
    const c = entityToConstraint(e, 'exclude')
    if (c) constraints.push(c)
  }

  return constraints
}
