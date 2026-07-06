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

/** Fourchette [min, max] pour contraindre prix / surface / pièces. */
export interface NumRange {
  min: number
  max: number
}

// Bornes globales des curseurs (garde-fous — au-delà = irréaliste pour la démo).
export const PRICE_BOUNDS: NumRange = { min: 150000, max: 12000000 }
export const SURFACE_BOUNDS: NumRange = { min: 9, max: 500 }
export const ROOMS_BOUNDS: NumRange = { min: 1, max: 12 }

function clampRange(r: NumRange, b: NumRange): NumRange {
  const min = Math.max(b.min, Math.min(r.min, b.max))
  const max = Math.min(b.max, Math.max(r.max, b.min))
  return { min: Math.min(min, max), max: Math.max(min, max) }
}

// Prix au m² appliqué aux bornes de surface pour dériver la fourchette de prix.
const PRICE_PER_SQM_LOW = 10000
const PRICE_PER_SQM_HIGH = 16000
// Surface de repli quand l'analyse n'a pas détecté de surface.
const FALLBACK_SURFACE = 70

/** Barème métier surface (m²) → nombre de pièces. */
export function roomsForSurface(s: number): number {
  if (s < 30) return 1
  if (s < 50) return 2
  if (s < 80) return 3
  if (s < 120) return 4
  if (s < 160) return 5
  if (s <= 250) return 6
  return 7
}

/** Fourchette de surface : ±20 % autour de la surface détectée (repli 70 m²). */
export function defaultSurfaceRange(v: number | null | undefined): NumRange {
  const s = v && v > 0 ? v : FALLBACK_SURFACE
  return clampRange({ min: Math.round(s * 0.8), max: Math.round(s * 1.2) }, SURFACE_BOUNDS)
}

/**
 * Fourchettes par défaut ANCRÉES SUR LA SURFACE détectée (comme la zone
 * pré-cochée) :
 *  - surface = surface détectée ±20 %
 *  - pièces  = barème appliqué aux bornes de surface (basse←surface basse, haute←surface haute)
 *  - prix    = borne basse surface × 10 000 €/m²  →  borne haute surface × 16 000 €/m²
 * Olivier élargit/resserre ensuite. Surface inconnue → repli 70 m².
 */
export function defaultRangesFromSurface(surface: number | null | undefined): {
  price: NumRange
  surface: NumRange
  rooms: NumRange
} {
  const s = defaultSurfaceRange(surface)
  const rooms = clampRange(
    { min: roomsForSurface(s.min), max: roomsForSurface(s.max) },
    ROOMS_BOUNDS,
  )
  const price = clampRange(
    { min: s.min * PRICE_PER_SQM_LOW, max: s.max * PRICE_PER_SQM_HIGH },
    PRICE_BOUNDS,
  )
  return { price, surface: s, rooms }
}

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
  /** Biens déjà en base pour cette vidéo (dédup). 0 = jamais ingérée. */
  existingInDb?: number
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
