export interface SpatialEntity {
  rawText: string
  normalizedText: string
  type: 'city' | 'district' | 'quartier' | 'transport_station' | 'transport_line' | 'poi' | 'street' | 'unknown'
  resolvedId?: string
  label?: string
  confidence: number
  /** Rayon spécifique (ex. « à 5 min du métro » → abaque marche) — porté jusqu'au GeoConstraint. */
  radiusM?: number
  /**
   * Indice d'opérateur posé par le parser quand l'entité est un FILTRE de
   * proximité et non une zone à inclure (« Paris 10 proche gare du Nord » →
   * la gare est operatorHint:'near'). Sans indice, le converter garde sa
   * logique historique (union → inside, station seule → near).
   */
  operatorHint?: 'inside' | 'near'
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
