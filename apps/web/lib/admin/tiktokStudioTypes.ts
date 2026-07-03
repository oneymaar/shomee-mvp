/**
 * Shomee — TikTok Studio (back-office démo) — types & constantes PURS.
 *
 * ⚠️ Ce fichier ne doit importer AUCUN module serveur (@anthropic-ai/sdk,
 * cloudinary, node:*, @prisma/client). Il est importé à la fois par les
 * routes API (serveur) et par le composant client de la page — donc rien
 * qui alourdisse ou casse le bundle navigateur.
 *
 * `DpeRating` est un union string local (structurellement identique à
 * l'enum Prisma DpeRating) pour éviter d'embarquer @prisma/client côté client.
 */

export type DpeRating = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
export type Orientation = 'north' | 'south' | 'east' | 'west'

export const VALID_DPE: ReadonlyArray<DpeRating> = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
export const VALID_ORIENT: ReadonlyArray<Orientation> = ['north', 'south', 'east', 'west']

/** Communes de proche banlieue autorisées (miroir de seed/video-tagger). */
export const COMMUNES: ReadonlyArray<string> = [
  'Neuilly-sur-Seine',
  'Levallois-Perret',
  'Boulogne-Billancourt',
  'Issy-les-Moulineaux',
  'Vincennes',
  'Saint-Mandé',
  'Saint-Cloud',
  'Sèvres',
  'Montrouge',
  'Charenton-le-Pont',
]

/**
 * Infos extraites de la CAPTION TikTok (miroir de `ExtractedInfo` de
 * scrape-and-seed.ts — étape ③, Claude Sonnet).
 */
export interface ExtractedInfo {
  title: string
  arrondissement: string
  district: string
  price: number | null
  surface: number | null
  rooms: number | null
  bedrooms: number | null
  description: string
  dpe: DpeRating | null
  hasElevator: boolean | null
  hasTerrace: boolean | null
  hasBalcony: boolean | null
  hasParking: boolean | null
  floor: number | null
  tags: string[]
}

/**
 * Réponse du Jalon 1 (`POST /api/admin/ingest-tiktok`) — la vidéo est sur
 * Cloudinary, la caption est extraite. AUCUN bien créé.
 */
export interface IngestResult {
  videoUrl: string
  thumbnailUrl: string
  caption: string
  extracted: ExtractedInfo
  source: {
    videoId: string
    handle: string | null
    webpageUrl: string
  }
}

/**
 * Bien riche généré (miroir EXACT de `GeneratedProperty` de
 * seed-synthetic-properties.ts — ~35 champs). C'est ce que le Jalon 2 propose
 * et ce que le Jalon 3 écrira en base (via les mêmes gardes de cohérence).
 */
export interface GeneratedProperty {
  title: string
  arrondissement: string
  district: string
  subtitle: string
  location: string
  price: number
  surface: number
  rooms: number
  bedrooms: number
  description: string
  dpe: DpeRating
  ges: DpeRating
  floor: number
  totalFloors: number
  hasElevator: boolean
  hasTerrace: boolean
  terraceSurfaceM2: number | null
  hasBalcony: boolean
  balconySurfaceM2: number | null
  hasGarden: boolean
  hasCellar: boolean
  hasParking: boolean
  hasConcierge: boolean
  isGroundFloor: boolean
  isQuietStreet: boolean
  orientationStructured: Orientation[]
  yearBuilt: number
  monthlyCharges: number
  propertyTax: number
  luminosity: number
  quietness: number
  charm: number
  spaciousness: number
  livingQuality: number
  outdoorUsability: number
  tags: string[]
  features: string[]
  neighborhoodVibe: string
}
