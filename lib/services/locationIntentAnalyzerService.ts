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
  query: string
}

export interface LocationIntentAnalysis {
  status: 'clear' | 'ambiguous' | 'too_vague' | 'not_found'
  explicitLocations: ExplicitLocation[]
  inferredConstraints: InferredConstraint[]
  clarificationQuestion: string | null
  clarificationOptions: ClarificationOption[] | null
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
    return await res.json() as LocationIntentAnalysis
  } catch {
    return null
  }
}
