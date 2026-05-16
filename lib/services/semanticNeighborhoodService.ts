/**
 * SemanticNeighborhoodService -- matches a free-text query to a known Parisian neighborhood
 * and converts it to GeoConstraints for IRIS-level resolution.
 *
 * Data source: src/data/semanticNeighborhoods.json
 * Matching strategy (in order):
 *   1. Exact normalized match on label or alias
 *   2. Query fully contains a normalized label/alias (min 6 chars)
 */

import type { GeoConstraint } from './geoConstraintService'
import rawNeighborhoods from '@/src/data/semanticNeighborhoods.json'
import { matchQuartier, findQuartierById } from './quartierMatchingService'

export interface SemanticNeighborhood {
  id: string
  label: string
  aliases: string[]
  city: string
  arrondissement: string // "Paris 13"
  type: 'semantic_neighborhood'
  center: { lat: number; lng: number }
  relatedStations: string[]
  confidenceRadiusMeters: number
  /** Hard cap on the number of pre-selected IRIS. Sorted by distance from center. */
  maxSelectedIris?: number
  description: string
  vibeTags: string[]
}

const NEIGHBORHOODS = rawNeighborhoods as SemanticNeighborhood[]

// --- Normalization ---------------------------------------------------------

/** Strip accents, hyphens, apostrophes, spaces -> compact lowercase ASCII */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[‘’ʼ'-\s]+/g, '') // strip apostrophes, hyphens, spaces
}

// --- Public API ------------------------------------------------------------

/**
 * Match a user query against the neighborhood database.
 * Tries semanticNeighborhoods.json first (richer metadata), then quartiers.json (larger coverage).
 * Returns the best match or null if nothing found.
 */
export function matchNeighborhood(query: string): SemanticNeighborhood | null {
  const q = normalize(query.trim())
  if (q.length < 4) return null

  // Pass 1: exact normalized match on label or any alias
  for (const n of NEIGHBORHOODS) {
    if (normalize(n.label) === q) return n
    if (n.aliases.some((a) => normalize(a) === q)) return n
  }

  // Pass 2: query fully contains a neighborhood identifier (min 6 chars to avoid noise)
  for (const n of NEIGHBORHOODS) {
    const nl = normalize(n.label)
    if (nl.length >= 6 && q.includes(nl)) return n
    if (n.aliases.some((a) => {
      const na = normalize(a)
      return na.length >= 6 && q.includes(na)
    })) return n
  }

  // Pass 3: fuzzy match in quartiers.json (handles typos, new quartiers)
  const qtMatch = matchQuartier(query)
  if (qtMatch && qtMatch.confidence >= 0.65) {
    // Wrap the quartier as a synthetic SemanticNeighborhood so existing callers work unchanged.
    return {
      id: qtMatch.quartier.id,
      label: qtMatch.quartier.name,
      aliases: qtMatch.quartier.aliases,
      city: qtMatch.quartier.city,
      arrondissement: '',
      type: 'semantic_neighborhood',
      // Placeholder center — geoConstraintService will use irisNames instead when available
      center: { lat: 48.8566, lng: 2.3522 },
      relatedStations: [],
      confidenceRadiusMeters: 500,
      vibeTags: [],
      description: qtMatch.quartier.name,
    }
  }

  return null
}

/** Look up a neighborhood by its id field. */
export function findNeighborhoodById(id: string): SemanticNeighborhood | null {
  return NEIGHBORHOODS.find((n) => n.id === id) ?? null
}

/**
 * Build the GeoConstraint for a matched neighborhood.
 *
 * Only emits semantic_neighborhood — NO administrative_area.
 * resolveConstraints uses the no-primary-zone path which scans all loaded
 * IRIS by radius from the center. This correctly handles neighborhoods that
 * span multiple arrondissements (e.g. Le Marais: Paris 3 / Paris 4).
 */
export function neighborhoodToConstraints(n: SemanticNeighborhood): GeoConstraint[] {
  // Include irisNames from quartiers.json when available — enables direct IRIS lookup
  // in resolveInsideToIris instead of falling back to radius-based selection.
  const qtData = findQuartierById(n.id)
  return [{
    type: 'semantic_neighborhood',
    label: n.label,
    operator: 'near',
    confidence: 0.95,
    neighborhoodId: n.id,
    radiusM: n.confidenceRadiusMeters,
    irisNames: qtData?.irisNames,
  }]
}
