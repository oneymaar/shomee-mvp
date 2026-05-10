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

  return null
}

/** Look up a neighborhood by its id field. */
export function findNeighborhoodById(id: string): SemanticNeighborhood | null {
  return NEIGHBORHOODS.find((n) => n.id === id) ?? null
}

/**
 * Build the GeoConstraints for a matched neighborhood:
 * - One administrative_area for the arrondissement (provides the IRIS pool)
 * - One semantic_neighborhood for the radius-based narrowing
 *
 * If the arrondissement cannot be parsed (suburban), only the
 * semantic_neighborhood constraint is returned and resolveConstraints handles it
 * via the no-primary-zone path.
 */
export function neighborhoodToConstraints(n: SemanticNeighborhood): GeoConstraint[] {
  const constraints: GeoConstraint[] = []

  const arrMatch = n.arrondissement.match(/Paris (\d{1,2})/)
  if (arrMatch) {
    constraints.push({
      type: 'administrative_area',
      label: n.arrondissement,
      operator: 'inside',
      confidence: 0.9,
      zoneId: `arr-${parseInt(arrMatch[1])}`,
    })
  }

  constraints.push({
    type: 'semantic_neighborhood',
    label: n.label,
    operator: 'near',
    confidence: 0.95,
    neighborhoodId: n.id,
    radiusM: n.confidenceRadiusMeters,
  })

  return constraints
}
