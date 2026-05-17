export interface ExplicitLocation {
  label: string
  type: 'arrondissement' | 'commune' | 'neighborhood' | 'transport_line' | 'poi' | 'unknown'
  confidence: number
}

export interface InferredConstraint {
  type: 'near_transport' | 'near_poi' | 'lifestyle' | 'exclude_area'
  value: string
  confidence: number
}

export interface ClarificationOption {
  label: string
  description: string
  query: string            // human-readable fallback
  preselectZones: string[] // explicit zone names: ["Paris 1", "Paris 4", "Vincennes"]
  centerQuery: string      // geocoding target for map centering: "Châtelet, Paris"
}

export interface LocationIntentAnalysis {
  status: 'clear' | 'ambiguous' | 'too_vague' | 'not_found' | 'contradictory'
  explicitLocations: ExplicitLocation[]
  inferredConstraints: InferredConstraint[]
  clarificationQuestion: string | null
  clarificationOptions: ClarificationOption[] | null
  /** Structured constraints for fine-grained IRIS-level resolution */
  geoConstraints?: import('./geoConstraintService').GeoConstraint[]
  /** Which resolution algorithm the map layer should apply */
  resolutionStrategy?: 'direct_area_selection' | 'semantic_neighborhood_selection'
    | 'point_radius_intersection' | 'transport_line_intersection'
    | 'directional_area_slice' | 'exclude_from_area' | 'between_entities'
    | 'ask_clarification'
  /** DEBUG — which path resolved this query. Remove after validation. */
  parserSource?: 'spatial_intent_parser' | 'llm_fallback'
  mapAction: {
    type: 'open_map' | 'ask_clarification'
    centerQuery: string | null
    preselectQueries: string[]
  }
}

export async function analyzeLocationIntent(input: string): Promise<LocationIntentAnalysis | null> {
  try {
    const res = await fetch('/api/location/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
    })
    if (!res.ok) return null
    const analysis = await res.json() as LocationIntentAnalysis
    // DEBUG — log raw analyze response. Remove after validation.
    const src = analysis.parserSource ?? 'unknown'
    const icon = src === 'spatial_intent_parser' ? '⚡' : '🤖'
    console.group(`${icon} GEO [${src}] "${input}"`)
    console.log('strategy :', analysis.resolutionStrategy)
    console.log('constraints:', analysis.geoConstraints ?? [])
    console.log('mapAction :', analysis.mapAction)
    console.groupEnd()
    return analysis
  } catch {
    return null
  }
}
