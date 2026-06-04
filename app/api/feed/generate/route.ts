/**
 * POST /api/feed/generate
 *
 * Génération dynamique d'un feed acquéreur :
 *  1. Lit `src/data/video-tags.json` (tags manuels par vidéo).
 *  2. Matche les vidéos compatibles avec le snapshot (géo, budget, surface)
 *     avec un widening progressif pour ne jamais renvoyer un feed vide.
 *  3. Demande à Claude Haiku une fiche immobilière fictive par vidéo
 *     (max 10 vidéos / fiches).
 *  4. Score chaque fiche avec le moteur de matching existant.
 *  5. Renvoie les biens triés par score desc, avec la vraie vidéo
 *     Cloudinary + chapitres IA + agence dérivée de l'arrondissement.
 *
 * Aucun bien n'est persisté en DB — le feed est éphémère, recalculé
 * à chaque arrivée sur `/feed` quand un brief est présent.
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import {
  buildBriefFromSnapshot,
  type BriefSnapshot,
} from '@/lib/matching/buyerBriefBuilder'
import { matchProperty } from '@/lib/matching/engine'
import type {
  PropertyProfile,
  PropertyTypeStructured,
  DpeRating,
} from '@/lib/matching/types'
import type { Property as ViewProperty } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_FICHES = 10
const MAX_TOKENS = 4000
const TAGS_FILE = path.join(process.cwd(), 'src', 'data', 'video-tags.json')

// ─── Tag file ────────────────────────────────────────────────────────────

type VideoTag = {
  videoId: string
  videoUrl: string
  arrondissements: number[]
  communes: string[]
  rooms?: number[]
  bedrooms?: number[]
  priceRange: [number, number]
  surfaceRange: [number, number]
}

function readTagsFile(): VideoTag[] {
  try {
    const raw = fs.readFileSync(TAGS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as VideoTag[]) : []
  } catch {
    return []
  }
}

// ─── Geo id → semantic mapping ───────────────────────────────────────────

const COMMUNE_ID_TO_NAME: Record<string, string> = {
  'com-92012': 'Boulogne-Billancourt',
  'com-92040': 'Issy-les-Moulineaux',
  'com-92044': 'Levallois-Perret',
  'com-92051': 'Neuilly-sur-Seine',
  'com-92064': 'Saint-Cloud',
  'com-92072': 'Sèvres',
  'com-94081': 'Vincennes',
}

function arrIdsToNumbers(ids?: string[] | null): number[] {
  if (!ids) return []
  return ids
    .map((id) => {
      const m = id.match(/^arr-(\d{1,2})$/)
      return m ? parseInt(m[1], 10) : NaN
    })
    .filter((n): n is number => Number.isFinite(n))
}

function communeIdsToNames(ids?: string[] | null): string[] {
  if (!ids) return []
  return ids
    .map((id) => COMMUNE_ID_TO_NAME[id])
    .filter((n): n is string => Boolean(n))
}

// ─── Agency map (spec) ───────────────────────────────────────────────────

const AGENCY_MAP: Record<number, string> = {
  7: 'Barnes Tour Eiffel',
  15: 'Barnes Tour Eiffel',
  16: 'Daniel Féau Passy',
  8: 'Laforêt Monceau',
  17: 'Laforêt Monceau',
  3: 'Engel & Völkers Marais',
  4: 'Engel & Völkers Marais',
  11: 'Century 21 Bastille',
  12: 'Century 21 Bastille',
  6: 'Morriss Montparnasse',
  14: 'Morriss Montparnasse',
  2: "L'Agence des Enfants Rouges",
  10: "L'Agence des Enfants Rouges",
}

function parseArrFromAddress(address: string): number {
  const m = address.match(/Paris\s+(\d{1,2})/i)
  return m ? parseInt(m[1], 10) : 0
}

function resolveAgencyName(address: string): string {
  const arr = parseArrFromAddress(address)
  return AGENCY_MAP[arr] ?? 'Kretz Real Estate'
}

// ─── Cloudinary ID extraction ────────────────────────────────────────────

function extractCloudinaryId(videoUrl: string): string {
  const match = videoUrl.match(/\/upload\/(?:v\d+\/)?(.+?)\.mp4/)
  return match?.[1] ?? videoUrl
}

// ─── Video matching with progressive widening ────────────────────────────

function matchVideos(
  snapshot: BriefSnapshot,
  tags: VideoTag[],
  flags: { byBudget: boolean; bySurface: boolean },
): VideoTag[] {
  const arrs = arrIdsToNumbers(snapshot.arrondissementIds)
  const communes = communeIdsToNames(snapshot.communeIds)
  const budget = snapshot.budgetMax ?? Infinity
  const surface = snapshot.minSurface ?? 0
  const geoUnspecified = arrs.length === 0 && communes.length === 0

  return tags.filter((tag) => {
    const arrMatch =
      arrs.length === 0 || tag.arrondissements.some((a) => arrs.includes(a))
    const communeMatch =
      communes.length === 0 || tag.communes.some((c) => communes.includes(c))
    // If both arr and commune are specified, accept either kind of match (OR).
    const geoMatch = geoUnspecified || arrMatch || communeMatch
    const budgetMatch = !flags.byBudget || tag.priceRange[0] <= budget
    const surfaceMatch = !flags.bySurface || tag.surfaceRange[1] >= surface
    return geoMatch && budgetMatch && surfaceMatch
  })
}

function pickMatchedVideos(snapshot: BriefSnapshot, tags: VideoTag[]): VideoTag[] {
  let res = matchVideos(snapshot, tags, { byBudget: true, bySurface: true })
  if (res.length === 0) {
    res = matchVideos(snapshot, tags, { byBudget: true, bySurface: false })
  }
  if (res.length === 0) {
    res = matchVideos(snapshot, tags, { byBudget: false, bySurface: false })
  }
  if (res.length === 0) res = tags
  return res.slice(0, MAX_FICHES)
}

// ─── LLM generation ──────────────────────────────────────────────────────

type Fiche = {
  title: string
  subtitle: string
  address: string
  price: number
  surface: number
  rooms: number
  bedrooms: number
  floor: number
  totalFloors: number
  propertyType: PropertyTypeStructured
  elevator: boolean
  terrace: boolean
  terraceSurface: number | null
  balcony: boolean
  cellar: boolean
  parking: boolean
  guardian: boolean
  dpe: DpeRating
  luminosity: number
  charm: number
  quietness: number
  outdoorUsability: number
  description: string
}

const SYSTEM_PROMPT = `Tu génères des fiches de biens immobiliers fictifs pour une démo.
Réponds UNIQUEMENT avec un tableau JSON valide, sans texte autour.
Chaque fiche doit être cohérente avec les contraintes fournies.
Les valeurs numériques doivent être réalistes pour le marché parisien.`

function buildUserPrompt(
  snapshot: BriefSnapshot,
  videos: VideoTag[],
  n: number,
): string {
  // Aggregate the zones covered by the matched videos so the LLM sticks to
  // plausible addresses.
  const arrsSet = new Set<number>()
  const commSet = new Set<string>()
  for (const v of videos) {
    for (const a of v.arrondissements) arrsSet.add(a)
    for (const c of v.communes) commSet.add(c)
  }
  const arrs = [...arrsSet].sort((a, b) => a - b)
  const communes = [...commSet]

  const zoneParts: string[] = []
  if (arrs.length > 0) {
    zoneParts.push(
      arrs.map((a) => (a === 1 ? 'Paris 1er' : `Paris ${a}e`)).join(', '),
    )
  }
  if (communes.length > 0) zoneParts.push(communes.join(', '))
  const zonesDescription = zoneParts.join(' ; ') || 'Paris intra-muros'

  const chipStates = snapshot.chipStates ?? {}
  const desired = Object.entries(chipStates)
    .filter(([, s]) => s === 1)
    .map(([l]) => l)
  const mandatory = Object.entries(chipStates)
    .filter(([, s]) => s === 2)
    .map(([l]) => l)
  for (const c of snapshot.customCriteria ?? []) {
    if (c.state === 1) desired.push(c.label)
    else if (c.state === 2) mandatory.push(c.label)
  }

  const types =
    snapshot.propertyTypes && snapshot.propertyTypes.length > 0
      ? snapshot.propertyTypes.join(', ')
      : 'appartement'

  const surfaceLine = `${snapshot.minSurface ?? 30} m² minimum${
    snapshot.maxSurface ? ` - ${snapshot.maxSurface} m² maximum` : ''
  }`
  const budgetLine = `${
    snapshot.budgetMin ? snapshot.budgetMin + ' € minimum, ' : ''
  }${snapshot.budgetMax ? snapshot.budgetMax + ' € maximum' : 'sans limite'}`

  return `Génère ${n} fiches de biens immobiliers fictifs correspondant à ces critères :

- Zones : ${zonesDescription}
- Type : ${types}
- Surface : ${surfaceLine}
- Pièces : ${snapshot.minRooms ?? 1} minimum
- Budget : ${budgetLine}
- Critères souhaités : ${desired.join(', ') || 'aucun'}
- Critères obligatoires : ${mandatory.join(', ') || 'aucun'}

Format JSON attendu pour chaque fiche :
{
  "title": "string — titre accrocheur",
  "subtitle": "string — type et caractéristique principale",
  "address": "string — adresse précise et réaliste (rue + arrondissement/commune)",
  "price": number,
  "surface": number,
  "rooms": number,
  "bedrooms": number,
  "floor": number,
  "totalFloors": number,
  "propertyType": "appartement|maison|loft|atelier",
  "elevator": boolean,
  "terrace": boolean,
  "terraceSurface": number|null,
  "balcony": boolean,
  "cellar": boolean,
  "parking": boolean,
  "guardian": boolean,
  "dpe": "A|B|C|D|E|F|G",
  "luminosity": number,
  "charm": number,
  "quietness": number,
  "outdoorUsability": number,
  "description": "string — 2-3 phrases de description"
}

Les scores luminosity/charm/quietness/outdoorUsability sont entre 0 et 1.
Chaque fiche doit être distincte (adresses différentes, prix variés dans la fourchette).`
}

function parseFiches(text: string): Fiche[] {
  // Try to extract the first JSON array in the response, tolerating prose
  // before/after — Haiku usually obeys but we shouldn't crash on stray text.
  const m = text.match(/\[\s*\{[\s\S]*\}\s*\]/)
  const body = m?.[0] ?? text
  try {
    const parsed = JSON.parse(body) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isFiche)
  } catch {
    return []
  }
}

function isFiche(x: unknown): x is Fiche {
  if (!x || typeof x !== 'object') return false
  const f = x as Record<string, unknown>
  return (
    typeof f.title === 'string' &&
    typeof f.address === 'string' &&
    typeof f.price === 'number' &&
    typeof f.surface === 'number' &&
    typeof f.rooms === 'number'
  )
}

async function callLlm(snapshot: BriefSnapshot, videos: VideoTag[]): Promise<Fiche[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[feed/generate] ANTHROPIC_API_KEY missing — returning [].')
    return []
  }
  const anthropic = new Anthropic({ apiKey })
  const userPrompt = buildUserPrompt(snapshot, videos, videos.length)
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = res.content[0]
  const text = block?.type === 'text' ? block.text : ''
  return parseFiches(text)
}

// ─── Profile / projection ────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

function ficheToProfile(fiche: Fiche, idx: number): PropertyProfile {
  return {
    property_id: `gen-${Date.now()}-${idx}`,
    structured: {
      price: fiche.price,
      property_type: fiche.propertyType,
      floor: fiche.floor,
      total_floors: fiche.totalFloors,
      has_elevator: fiche.elevator,
      has_terrace: fiche.terrace,
      terrace_surface_m2: fiche.terraceSurface,
      has_balcony: fiche.balcony,
      balcony_surface_m2: null,
      has_garden: false,
      garden_surface_m2: null,
      has_cellar: fiche.cellar,
      has_parking: fiche.parking,
      has_concierge: fiche.guardian,
      is_ground_floor: fiche.floor === 0,
      surface_m2: fiche.surface,
      room_count: fiche.rooms,
      bedroom_count: fiche.bedrooms,
      bedroom_street_side: null,
      orientation: [],
      is_quiet_street: null,
      building_year: null,
      dpe_rating: fiche.dpe,
    },
    semantic: {
      luminosity: clamp01(fiche.luminosity),
      quietness: clamp01(fiche.quietness),
      charm: clamp01(fiche.charm),
      spaciousness: null,
      living_quality: null,
      outdoor_usability: clamp01(fiche.outdoorUsability),
    },
    raw_description: fiche.description,
    enriched_at: new Date(),
  }
}

function arrondissementLabel(n: number): string {
  if (n <= 0) return ''
  return n === 1 ? 'Paris 1er' : `Paris ${n}ème`
}

type ChapterRow = { label: string; startSec?: number; fraction?: number }

function ficheToView(
  fiche: Fiche,
  video: VideoTag,
  chapters: ChapterRow[] | null,
  matchScore01: number,
  isExcluded: boolean,
  id: string,
): ViewProperty {
  const arrNum = parseArrFromAddress(fiche.address)
  const arrLabel = arrondissementLabel(arrNum) || fiche.address
  const agency = resolveAgencyName(fiche.address)

  return {
    id,
    title: fiche.title,
    subtitle: fiche.subtitle,
    arrondissement: arrLabel,
    agentName: agency,
    agencyName: agency,
    agencyLogo: null,
    price: fiche.price,
    surface: fiche.surface,
    rooms: fiche.rooms,
    bedrooms: fiche.bedrooms,
    location: fiche.address,
    district: arrLabel,
    description: fiche.description,
    tags: [],
    features: [],
    dpe: fiche.dpe,
    floor: fiche.floor,
    totalFloors: fiche.totalFloors,
    hasElevator: fiche.elevator,
    hasTerrace: fiche.terrace,
    terraceSurfaceM2: fiche.terraceSurface ?? undefined,
    hasBalcony: fiche.balcony,
    hasCellar: fiche.cellar,
    hasParking: fiche.parking,
    hasConcierge: fiche.guardian,
    luminosity: clamp01(fiche.luminosity),
    quietness: clamp01(fiche.quietness),
    charm: clamp01(fiche.charm),
    outdoorUsability: clamp01(fiche.outdoorUsability),
    videoUrl: video.videoUrl,
    chapters: chapters as ViewProperty['chapters'] | undefined,
    imageUrlFallback: '',
    gallery: [],
    matchScore: matchScore01,
    isExcluded,
  }
}

// ─── Route ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const snapshot = body as BriefSnapshot

  const tags = readTagsFile()
  if (tags.length === 0) {
    // Tag file vide / manquant — la page feed retombera sur /api/properties.
    return NextResponse.json([])
  }

  const matchedVideos = pickMatchedVideos(snapshot, tags)
  console.log(
    `[feed/generate] tags=${tags.length} matched=${matchedVideos.length} ` +
      `(arr=${(snapshot.arrondissementIds ?? []).join(',') || '-'}, ` +
      `com=${(snapshot.communeIds ?? []).join(',') || '-'}, ` +
      `budget≤${snapshot.budgetMax ?? '∞'}, surf≥${snapshot.minSurface ?? 0})`,
  )

  // Charge la map videoId → chapitres pour réinjecter le chapitrage IA
  // au moment de la projection. Un seul findMany pour les ~30 biens.
  const dbProps = await prisma.property.findMany({
    where: { videoAnalysis: { isNot: null }, videoUrl: { not: null } },
    select: { videoUrl: true, videoAnalysis: { select: { chapitres: true } } },
  })
  const chaptersByVideoId = new Map<string, ChapterRow[] | null>()
  for (const p of dbProps) {
    if (!p.videoUrl) continue
    const vid = extractCloudinaryId(p.videoUrl)
    const raw = p.videoAnalysis?.chapitres
    chaptersByVideoId.set(
      vid,
      Array.isArray(raw) && raw.length > 0 ? (raw as unknown as ChapterRow[]) : null,
    )
  }

  let fiches: Fiche[] = []
  try {
    fiches = await callLlm(snapshot, matchedVideos)
  } catch (error) {
    console.error('[feed/generate] LLM call failed:', error)
    return NextResponse.json({ error: 'llm_failed' }, { status: 500 })
  }

  if (fiches.length === 0) {
    console.warn('[feed/generate] LLM returned 0 fiches, falling back to empty.')
    return NextResponse.json([])
  }

  const brief = buildBriefFromSnapshot(snapshot)
  const scored: ViewProperty[] = fiches.map((fiche, i) => {
    const profile = ficheToProfile(fiche, i)
    const result = matchProperty(profile, brief)
    const video = matchedVideos[i % matchedVideos.length]
    const chapters = chaptersByVideoId.get(video.videoId) ?? null
    return ficheToView(
      fiche,
      video,
      chapters,
      result.global_score / 100,
      result.is_excluded,
      profile.property_id,
    )
  })

  const feed = scored
    .filter((p) => !p.isExcluded)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))

  console.log(
    `[feed/generate] fiches=${fiches.length} scored=${scored.length} ` +
      `kept=${feed.length} top=${feed[0]?.matchScore?.toFixed(2) ?? '-'}`,
  )

  return NextResponse.json(feed)
}
