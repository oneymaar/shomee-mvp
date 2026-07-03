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

/** Communes directement limitrophes de Paris (proche banlieue). */
export const COMMUNES: ReadonlyArray<string> = [
  'Neuilly-sur-Seine',
  'Levallois-Perret',
  'Clichy',
  'Saint-Ouen-sur-Seine',
  'Saint-Denis',
  'Aubervilliers',
  'Pantin',
  'Le Pré-Saint-Gervais',
  'Les Lilas',
  'Bagnolet',
  'Montreuil',
  'Vincennes',
  'Saint-Mandé',
  'Charenton-le-Pont',
  'Ivry-sur-Seine',
  'Le Kremlin-Bicêtre',
  'Gentilly',
  'Montrouge',
  'Malakoff',
  'Vanves',
  'Issy-les-Moulineaux',
  'Boulogne-Billancourt',
]

/** Les 20 arrondissements en libellé canonique ("Paris 1er", "Paris 2ème"…). */
export const ARRONDISSEMENT_LABELS: ReadonlyArray<string> = Array.from(
  { length: 20 },
  (_, i) => (i === 0 ? 'Paris 1er' : `Paris ${i + 1}ème`),
)

/** Toutes les zones cochables : 20 arrondissements + communes limitrophes. */
export const ALL_ZONES: ReadonlyArray<string> = [...ARRONDISSEMENT_LABELS, ...COMMUNES]

function arrLabelFromNumber(n: number): string {
  return n === 1 ? 'Paris 1er' : `Paris ${n}ème`
}

/**
 * Rapproche le champ `arrondissement` extrait de la caption (ex: "Paris 7ème",
 * "Paris 8", "Boulogne-Billancourt") d'un libellé canonique de ALL_ZONES.
 * Sert à pré-cocher la zone réelle de la vidéo. null si aucun match.
 */
export function matchZoneLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.match(/(\d{1,2})/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= 20) return arrLabelFromNumber(n)
  }
  const low = raw.trim().toLowerCase()
  const commune = COMMUNES.find(
    (c) => low.includes(c.toLowerCase()) || c.toLowerCase().includes(low),
  )
  return commune ?? null
}

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
  /** Adresse exacte (back-office). Numéro + rue + code postal + ville. */
  address: string
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
