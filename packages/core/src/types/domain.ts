/**
 * Shomee — shared view-model types (platform-agnostic).
 *
 * The `Property` interface below is the view model consumed by the feed and
 * detail UI (web + mobile). It is intentionally kept backward-compatible with
 * existing components and `mockData`; new fields aligned with the Prisma model
 * are all optional.
 *
 * NOTE: Prisma-generated persistence entities + enums are NOT here — they are
 * server-only and re-exported from `apps/web/lib/types.ts`.
 */

export interface ChatMessage {
  id: string
  text: string
  from: 'user' | 'agent'
  timestamp: number  // Date.now()
  read: boolean
  /** Message structuré (demande de visite, disponibilités…) — TEXT si absent. */
  kind?: 'text' | 'visit_request' | 'availabilities' | 'visit_confirmed' | 'system'
  /** Charge structurée selon kind (brief, créneaux, visite…). */
  payload?: Record<string, unknown>
}

export interface Conversation {
  propertyId: string
  messages: ChatMessage[]
  lastSeenAt: number  // timestamp of last user view; agent msgs after this are "unread"
  /** Id serveur du fil (présent après synchronisation). */
  serverId?: string
  /** Résumé du bien fourni par le serveur — sert quand le bien n'est pas (plus)
   *  dans le feed local. Le résolveur local reste prioritaire. */
  propertySummary?: {
    title?: string
    arrondissement?: string
    district?: string
    price?: number
    agencyName?: string
    agencyLogo?: string | null
  }
}

export interface MatchCriterionRef {
  label: string
  importance: 'desired' | 'mandatory' | 'dealbreaker'
}

/** Détail de match transporté par /api/properties — alimente la modale du
 *  badge (matchés / non-matchés / doutes) et la fiche ✓/✗. */
export interface MatchDetail {
  /** Score AFFICHÉ calibré 0..100 (plancher 60, 90+ réservé — D5). */
  score100: number
  /** Score brut du moteur (traçabilité). */
  raw: number
  matched: MatchCriterionRef[]
  unmatched: MatchCriterionRef[]
  doubts: MatchCriterionRef[]
}

export interface Property {
  id: string
  // Matching engine — attached by /api/properties when buyerProfileId is set.
  // Score is in 0..1 (engine produces 0..100 → normalised in the route).
  matchScore?: number
  isExcluded?: boolean
  matchDetail?: MatchDetail
  /** Voie découverte : libellé du dépassement (« Budget +5 % ») — présent
   *  UNIQUEMENT sur les biens servis hors critères, toujours annoncés. */
  discoveryDelta?: string
  // For LLM-generated biens (feed dynamique) — chips activés dans le brief
  // dont l'attribut correspondant est effectivement vrai sur le bien.
  // Source de vérité pour le bandeau "critères validés" du PropertyOverlay.
  matchedCriteria?: string[]
  // Agency identity — projected by /api/properties via the Agency relation.
  // Falls back to the agent's first letter when null, used as the primary
  // brand badge in the feed (the agent name is reserved for the detail
  // sheet and messaging flows).
  agencyName?: string
  agencyLogo?: string | null
  // Feed display
  arrondissement: string   // e.g. "PARIS 4e"
  subtitle: string         // e.g. "Appartement haussmannien"
  agentName: string
  agentAvatar?: string
  // Core data
  title: string
  price: number
  pricePerSqm?: number
  surface: number
  rooms: number
  bedrooms?: number
  location: string
  district: string
  description: string
  tags: string[]
  features?: string[]
  dpe: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  ges?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  // Detail — physical
  floor?: number
  totalFloors?: number
  orientation?: string
  exteriorType?: string        // e.g. "Terrasse", "Balcon", "Jardin"
  heatingType?: string
  hotWaterType?: string
  yearBuilt?: number
  lotCount?: number
  proceduresEnCours?: boolean
  monthlyCharges?: number
  propertyTax?: number
  // Detail — composition
  composition?: Array<{ label: string; surface: number }>
  // Detail — localisation IRIS
  irisZone?: string            // micro-quartier IRIS sans adresse exacte
  irisDescription?: string
  irisPolygon?: [number, number][]
  mapLat?: number
  mapLng?: number
  transports?: string[]
  nearbyPlaces?: string[]
  neighborhoodVibe?: string
  mapTransports?: Array<{ name: string; line: string; lat: number; lng: number; walkMin?: number }>
  mapPois?: Array<{ name: string; lat: number; lng: number }>
  // Detail — marché
  marketAvgPricePerSqm?: number
  marketEvolution10y?: string  // e.g. "+27%"
  marketHighPrice?: number
  marketLowPrice?: number
  // Media
  videoUrl?: string
  matterportUrl?: string
  imageUrlFallback: string
  gallery: string[]
  chapters?: Array<{ label: string; fraction: number }>
  // Social
  likeCount?: number
  shareCount?: number
  promising?: boolean
  badges?: Array<'avant-premiere' | 'exclusivite'>

  // ─── Sprint fields (synced with Prisma Property) ────────────────────────
  mandatType?: 'EXCLUSIF' | 'SIMPLE' | 'COEXCLUSIF'
  avantPremiere?: boolean
  refInterneAgence?: string
  statut?: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED'
  completionRate?: number
  agencyId?: string
  createdByAgentId?: string
  collaborateurIds?: string[]

  // ─── Structured attributes (matching engine, PropertyStructuredAttributes) ─
  hasElevator?: boolean
  hasTerrace?: boolean
  terraceSurfaceM2?: number
  hasBalcony?: boolean
  balconySurfaceM2?: number
  hasGarden?: boolean
  gardenSurfaceM2?: number
  hasCellar?: boolean
  hasParking?: boolean
  hasConcierge?: boolean
  isGroundFloor?: boolean
  bedroomStreetSide?: boolean
  isQuietStreet?: boolean
  orientationStructured?: Array<'north' | 'south' | 'east' | 'west'>

  // ─── Semantic scores 0..1 (PropertySemanticScores) ──────────────────────
  luminosity?: number
  quietness?: number
  charm?: number
  spaciousness?: number
  livingQuality?: number
  outdoorUsability?: number

  // ─── LLM-filled marker (list of Property-side field keys) ───────────────
  llmFilledFields?: string[]

  // ─── Source markers (populated by the LLM importer) ─────────────────────
  locationSource?: string | null
  titleSource?: string | null
  priceSource?: string | null
  surfaceSource?: string | null
  roomsSource?: string | null
  bedroomsSource?: string | null
  descriptionSource?: string | null
  floorSource?: string | null
  yearBuiltSource?: string | null
  dpeSource?: string | null
  gesSource?: string | null
  mandatTypeSource?: string | null
  refInterneAgenceSource?: string | null
  monthlyChargesSource?: string | null
  propertyTaxSource?: string | null
  compositionSource?: string | null
}
