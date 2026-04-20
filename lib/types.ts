export interface Property {
  id: string
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
}
