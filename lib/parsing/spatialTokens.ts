export interface SpatialEntity {
  rawText: string
  normalizedText: string
  type: 'city' | 'district' | 'quartier' | 'transport_station' | 'poi' | 'street' | 'unknown'
  resolvedId?: string
  label?: string
  confidence: number
}

export interface SpatialRelation {
  type: 'inside' | 'near' | 'adjacent_to' | 'edge_of' | 'between' | 'exclude' | 'directional_bias'
  targetText?: string
  targetType?: string
  direction?: 'north' | 'south' | 'east' | 'west'
  radiusM?: number
  confidence: number
  neighborhoodId?: string  // static zone reference (e.g. 'zone-periph')
}

export interface SpatialIntent {
  rawQuery: string
  normalizedQuery: string
  primaryEntities: SpatialEntity[]
  spatialRelations: SpatialRelation[]
  exclusions: SpatialEntity[]
  requiresLLM: boolean
  confidence: number
}
