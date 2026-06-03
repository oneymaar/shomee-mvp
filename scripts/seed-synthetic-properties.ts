/**
 * Shomee — 200 synthetic Property rows for demo seeding.
 *
 * Pipeline:
 *  1. Snapshot the existing (videoUrl, imageUrlFallback) pairs already in
 *     DB. Each new property reuses one of those — we never upload to
 *     Cloudinary nor scrape anything.
 *  2. Snapshot all Agency rows with at least one Agent. New properties are
 *     distributed round-robin across that pool so the count is balanced.
 *  3. Ask Claude Haiku 4.5 for 4 batches of 50 properties; insert each
 *     batch as soon as it lands so partial failures still produce data.
 *
 * Idempotent? No — running twice doubles the row count. Truncate Property
 * first if you want a clean re-seed.
 *
 * Run: npx tsx scripts/seed-synthetic-properties.ts
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import Anthropic from '@anthropic-ai/sdk'
import {
  PrismaClient,
  PropertyStatus,
  MandatType,
  type Agency,
  type Agent,
  type DpeRating,
} from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const MODEL = 'claude-haiku-4-5-20251001'
// Defaults aim at ~200 properties in 4 × 50 batches. Both are tunable via
// env for top-up runs (Haiku tends to stop short of large batch sizes, so
// SHOMEE_SEED_BATCH_SIZE=30 + SHOMEE_SEED_BATCH_COUNT=2 is a good top-up
// preset).
const BATCH_SIZE = numFromEnv('SHOMEE_SEED_BATCH_SIZE', 50)
const BATCH_COUNT = numFromEnv('SHOMEE_SEED_BATCH_COUNT', 4)
const MAX_TOKENS = 40000

function numFromEnv(key: string, fallback: number): number {
  const v = process.env[key]
  if (!v) return fallback
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const VALID_DPE: ReadonlyArray<DpeRating> = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const VALID_ORIENT = new Set(['north', 'south', 'east', 'west'])

// ─── Generated property shape (what Claude is asked to produce) ────────────

interface GeneratedProperty {
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
  orientationStructured: Array<'north' | 'south' | 'east' | 'west'>
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

interface VideoEntry {
  videoUrl: string
  imageUrlFallback: string
}

interface AgencyWithAgent {
  agency: Agency
  agent: Agent
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

function buildPrompt(batchIndex: number, batchTotal: number): string {
  return `Génère ${BATCH_SIZE} biens immobiliers parisiens fictifs mais réalistes pour une app de démo.
Retourne UNIQUEMENT un JSON array valide, aucun texte autour, aucun markdown.

Chaque bien doit avoir exactement ces champs :
{
  "title": string,
  "arrondissement": string, // "Paris Xème" ou "Neuilly-sur-Seine" etc.
  "district": string,        // quartier précis
  "subtitle": string,        // ex: "Appartement haussmannien avec balcon"
  "location": string,        // même que district
  "price": number,           // entre 280000 et 4500000
  "surface": number,         // entre 28 et 280
  "rooms": number,           // entre 1 et 8
  "bedrooms": number,        // entre 0 et 5
  "description": string,     // 3-4 phrases réalistes
  "dpe": "A"|"B"|"C"|"D"|"E"|"F"|"G",
  "ges": "A"|"B"|"C"|"D"|"E"|"F"|"G",
  "floor": number,           // 0 à 8
  "totalFloors": number,
  "hasElevator": boolean,
  "hasTerrace": boolean,
  "terraceSurfaceM2": number|null,
  "hasBalcony": boolean,
  "balconySurfaceM2": number|null,
  "hasGarden": boolean,
  "hasCellar": boolean,
  "hasParking": boolean,
  "hasConcierge": boolean,
  "isGroundFloor": boolean,
  "isQuietStreet": boolean,
  "orientationStructured": ("north"|"south"|"east"|"west")[],
  "yearBuilt": number,       // entre 1850 et 2020
  "monthlyCharges": number,  // entre 100 et 1200
  "propertyTax": number,
  "luminosity": number,      // 0.1 à 1.0
  "quietness": number,
  "charm": number,
  "spaciousness": number,
  "livingQuality": number,
  "outdoorUsability": number,
  "tags": string[],          // 3-6 tags en anglais : outdoor/living/building/ambiance/structure/location
  "features": string[],      // 3-5 features en français
  "neighborhoodVibe": string
}

Couvre tous les arrondissements Paris 1-20 + Neuilly + Boulogne + Saint-Cloud + Vincennes.
Varie les prix, surfaces, styles (haussmannien, années 30, années 70, contemporain, loft).
Assure-toi que les attributs sont cohérents (hasTerrace:true ⇒ terraceSurfaceM2 non null,
isGroundFloor:true ⇒ floor:0, etc.).
Batch ${batchIndex + 1}/${batchTotal} — génère des biens variés, différents des batchs précédents.`
}

// ─── Validation / coercion ──────────────────────────────────────────────────

function coerceToProperty(raw: unknown): GeneratedProperty | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>

  const str = (k: string, fallback = ''): string =>
    typeof v[k] === 'string' && (v[k] as string).trim().length > 0 ? (v[k] as string).trim() : fallback
  const num = (k: string, fallback: number): number =>
    typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : fallback
  const bool = (k: string, fallback = false): boolean =>
    typeof v[k] === 'boolean' ? (v[k] as boolean) : fallback
  const numOrNull = (k: string): number | null =>
    typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : null
  const dpeOf = (k: string, fallback: DpeRating): DpeRating =>
    VALID_DPE.includes(v[k] as DpeRating) ? (v[k] as DpeRating) : fallback

  const orient = Array.isArray(v.orientationStructured)
    ? (v.orientationStructured as unknown[]).filter(
        (o): o is 'north' | 'south' | 'east' | 'west' => typeof o === 'string' && VALID_ORIENT.has(o),
      )
    : []

  const tags = Array.isArray(v.tags)
    ? (v.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : []
  const features = Array.isArray(v.features)
    ? (v.features as unknown[]).filter((t): t is string => typeof t === 'string')
    : []

  const title = str('title')
  const arrondissement = str('arrondissement')
  if (!title || !arrondissement) return null

  return {
    title,
    arrondissement,
    district: str('district', arrondissement),
    subtitle: str('subtitle', title),
    location: str('location', str('district', arrondissement)),
    price: Math.round(num('price', 500000)),
    surface: num('surface', 60),
    rooms: Math.round(num('rooms', 3)),
    bedrooms: Math.round(num('bedrooms', 1)),
    description: str('description', title),
    dpe: dpeOf('dpe', 'D'),
    ges: dpeOf('ges', 'D'),
    floor: Math.round(num('floor', 2)),
    totalFloors: Math.round(num('totalFloors', 6)),
    hasElevator: bool('hasElevator'),
    hasTerrace: bool('hasTerrace'),
    terraceSurfaceM2: numOrNull('terraceSurfaceM2'),
    hasBalcony: bool('hasBalcony'),
    balconySurfaceM2: numOrNull('balconySurfaceM2'),
    hasGarden: bool('hasGarden'),
    hasCellar: bool('hasCellar'),
    hasParking: bool('hasParking'),
    hasConcierge: bool('hasConcierge'),
    isGroundFloor: bool('isGroundFloor'),
    isQuietStreet: bool('isQuietStreet', true),
    orientationStructured: orient,
    yearBuilt: Math.round(num('yearBuilt', 1900)),
    monthlyCharges: Math.round(num('monthlyCharges', 250)),
    propertyTax: Math.round(num('propertyTax', 1500)),
    luminosity: clamp01(num('luminosity', 0.7)),
    quietness: clamp01(num('quietness', 0.7)),
    charm: clamp01(num('charm', 0.7)),
    spaciousness: clamp01(num('spaciousness', 0.7)),
    livingQuality: clamp01(num('livingQuality', 0.7)),
    outdoorUsability: clamp01(num('outdoorUsability', 0.5)),
    tags,
    features,
    neighborhoodVibe: str('neighborhoodVibe', ''),
  }
}

function clamp01(n: number): number {
  if (n < 0.1) return 0.1
  if (n > 1) return 1
  return n
}

// ─── LLM batch ──────────────────────────────────────────────────────────────

async function generateBatch(
  anthropic: Anthropic,
  batchIndex: number,
): Promise<GeneratedProperty[]> {
  // Streaming required by the SDK once max_tokens crosses the
  // non-streaming-timeout threshold (~10 min). `.finalMessage()` gives us
  // the full message at the end without any per-chunk handling.
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: buildPrompt(batchIndex, BATCH_COUNT) }],
  })
  const resp = await stream.finalMessage()

  const text = resp.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim()
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) {
    throw new Error('Claude n\'a pas retourné de tableau JSON')
  }
  const arr = JSON.parse(match[0]) as unknown[]
  if (!Array.isArray(arr)) {
    throw new Error('Sortie Claude n\'est pas un tableau')
  }
  const cleaned = arr.map(coerceToProperty).filter((p): p is GeneratedProperty => p !== null)
  return cleaned
}

// ─── Insert ─────────────────────────────────────────────────────────────────

async function insertOne(
  prisma: PrismaClient,
  gen: GeneratedProperty,
  video: VideoEntry,
  attrib: AgencyWithAgent,
): Promise<void> {
  // Coherence guards — keep boolean/surface pairs honest even if Claude slips.
  const terraceSurfaceM2 = gen.hasTerrace ? gen.terraceSurfaceM2 ?? 8 : null
  const balconySurfaceM2 = gen.hasBalcony ? gen.balconySurfaceM2 ?? 4 : null
  const floor = gen.isGroundFloor ? 0 : gen.floor

  await prisma.property.create({
    data: {
      title:            gen.title,
      arrondissement:   gen.arrondissement,
      district:         gen.district,
      subtitle:         gen.subtitle,
      location:         gen.location,
      price:            gen.price,
      pricePerSqm:      Math.round(gen.price / Math.max(gen.surface, 1)),
      surface:          gen.surface,
      rooms:            gen.rooms,
      bedrooms:         gen.bedrooms,
      description:      gen.description,
      tags:             gen.tags,
      features:         gen.features,
      dpe:              gen.dpe,
      ges:              gen.ges,
      floor,
      totalFloors:      gen.totalFloors,
      monthlyCharges:   gen.monthlyCharges,
      propertyTax:      gen.propertyTax,
      neighborhoodVibe: gen.neighborhoodVibe,
      yearBuilt:        gen.yearBuilt,
      // Structured attributes for matching engine
      hasElevator:           gen.hasElevator,
      hasTerrace:            gen.hasTerrace,
      terraceSurfaceM2,
      hasBalcony:            gen.hasBalcony,
      balconySurfaceM2,
      hasGarden:             gen.hasGarden,
      hasCellar:             gen.hasCellar,
      hasParking:            gen.hasParking,
      hasConcierge:          gen.hasConcierge,
      isGroundFloor:         gen.isGroundFloor,
      isQuietStreet:         gen.isQuietStreet,
      orientationStructured: gen.orientationStructured,
      // Semantic scores
      luminosity:       gen.luminosity,
      quietness:        gen.quietness,
      charm:            gen.charm,
      spaciousness:     gen.spaciousness,
      livingQuality:    gen.livingQuality,
      outdoorUsability: gen.outdoorUsability,
      // Media (reused from existing biens)
      videoUrl:         video.videoUrl,
      imageUrlFallback: video.imageUrlFallback,
      // Agency/agent assignment
      agencyId:         attrib.agency.id,
      createdByAgentId: attrib.agent.id,
      agentName:        attrib.agent.name,
      agentAvatar:      attrib.agent.avatar,
      // Status
      statut:           PropertyStatus.PUBLISHED,
      mandatType:       MandatType.SIMPLE,
      completionRate:   0.75,
    },
  })
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non défini')
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY non défini')

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter })
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const t0 = Date.now()

  try {
    // ── Pool des vidéos ────────────────────────────────────────────────────
    const existingProps = await prisma.property.findMany({
      where: { videoUrl: { not: null } },
      select: { videoUrl: true, imageUrlFallback: true },
    })
    const videoPool: VideoEntry[] = existingProps
      .filter((p) => p.videoUrl && p.imageUrlFallback)
      .map((p) => ({ videoUrl: p.videoUrl as string, imageUrlFallback: p.imageUrlFallback }))
    if (videoPool.length === 0) {
      throw new Error('Aucune vidéo en DB — lance scrape-and-seed d\'abord.')
    }
    console.log(`→ ${videoPool.length} vidéos disponibles dans le pool`)

    // ── Pool des agences ─────────────────────────────────────────────────
    const agencies = await prisma.agency.findMany({ include: { agents: true } })
    const agencyPool: AgencyWithAgent[] = agencies
      .filter((a) => a.agents.length > 0)
      .map((a) => ({ agency: a, agent: a.agents[0] }))
    if (agencyPool.length === 0) {
      throw new Error('Aucune agence avec agent en DB — lance seed-agencies d\'abord.')
    }
    console.log(`→ ${agencyPool.length} agences disponibles`)
    console.log('')

    // ── Boucle batchs ────────────────────────────────────────────────────
    let totalInserted = 0
    const insertedPerAgency: Record<string, number> = {}

    for (let b = 0; b < BATCH_COUNT; b++) {
      console.log(`Batch ${b + 1}/${BATCH_COUNT} — génération Claude…`)
      const batchStart = Date.now()
      const generated = await generateBatch(anthropic, b)
      console.log(
        `Batch ${b + 1}/${BATCH_COUNT} — ${generated.length} biens générés (${
          Math.round((Date.now() - batchStart) / 1000)
        }s), insertion en DB…`,
      )

      let inserted = 0
      for (let i = 0; i < generated.length; i++) {
        const gen = generated[i]
        const video = videoPool[Math.floor(Math.random() * videoPool.length)]
        // Round-robin balanced across agencies, indexed by global property count
        const attrib = agencyPool[(totalInserted + inserted) % agencyPool.length]
        try {
          await insertOne(prisma, gen, video, attrib)
          insertedPerAgency[attrib.agency.name] = (insertedPerAgency[attrib.agency.name] ?? 0) + 1
          inserted++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.log(`  ✗ insert #${i + 1}: ${msg}`)
        }
      }
      totalInserted += inserted
      console.log(`Batch ${b + 1}/${BATCH_COUNT} ✓ — ${inserted}/${generated.length} insérés`)
      console.log('')
    }

    console.log('───────────────────────────────────────────')
    console.log(`Total : ${totalInserted} biens créés en ${Math.round((Date.now() - t0) / 1000)}s`)
    console.log('Répartition par agence :')
    const sorted = Object.entries(insertedPerAgency).sort(([, a], [, b]) => b - a)
    for (const [name, count] of sorted) console.log(`  ${count}x ${name}`)
    console.log('───────────────────────────────────────────')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('[seed-synthetic-properties] erreur fatale:', err)
  process.exit(1)
})
