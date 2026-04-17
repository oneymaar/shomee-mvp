export interface Property {
  id: string
  // Feed display
  arrondissement: string   // e.g. "PARIS 4e"
  subtitle: string         // e.g. "Appartement haussmannien"
  agentName: string        // e.g. "Sophie & Marc Dubois"
  agentAvatar?: string     // URL
  // Core data
  title: string
  price: number
  pricePerSqm?: number
  surface: number
  rooms: number
  bedrooms?: number
  location: string
  district: string         // e.g. "Le Marais"
  description: string
  tags: string[]
  features?: string[]      // e.g. ["Ascenseur", "Gardien", "Cave"]
  dpe: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  ges?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  // Media
  videoUrl?: string
  imageUrlFallback: string
  gallery: string[]
  // Video chapters for progress bar
  chapters?: Array<{
    label: string
    fraction: number  // 0–1 : position de début dans la vidéo
  }>
  // Social
  likeCount?: number
  shareCount?: number
  promising?: boolean
}
