/**
 * Shomee — scrape TikTok / Instagram property videos → seed Property rows.
 *
 * Pipeline per URL:
 *   1. yt-dlp dumps the metadata (--skip-download --write-info-json) then the
 *      video itself (mp4 capped at 1080p). Output uses a per-URL MD5 prefix
 *      so the resulting filepaths are deterministic.
 *   2. Local mp4 → Cloudinary (folder shomee/videos, public_id = the prefix).
 *      Thumbnail URL derived deterministically from the public_id.
 *   3. Caption → Claude (sonnet-4) → strict JSON with title, price, surface,
 *      DPE, etc. JSON-only response; non-JSON gets dropped.
 *   4. Agency attribution: HANDLE_MAP → fallback random over agencies present
 *      in DB. Within the agency we pick the first available agent.
 *   5. prisma.property.create with defaults for any required column the LLM
 *      didn't fill (price 500k, surface 80, rooms 3, dpe D).
 *   6. With --analyze, persist tags + chapters via analyzeVideo() — same
 *      shape as /api/biens/[id]/analyze-video.
 *
 * Failure modes (yt-dlp blocked on IG, private video, Claude returns garbage,
 * Cloudinary timeout…) are caught per URL; the loop continues and the final
 * summary reports counts + reasons.
 *
 * URLs are read from scripts/urls-to-scrape.txt — one per line, # comments
 * and blank lines skipped.
 *
 * Run:
 *   npx tsx scripts/scrape-and-seed.ts
 *   npx tsx scripts/scrape-and-seed.ts --analyze
 */

// Load .env.local (Vercel-pulled prod secrets like ANTHROPIC_API_KEY) and
// then .env (which holds DATABASE_URL). First-loaded wins, mirroring Next's
// own cascading behaviour.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'

// execa v9 is ESM-only. Load it dynamically so tsx in default (CJS) mode
// can resolve it without tripping on the package's `exports` map.
type ExecaFn = (file: string, args: readonly string[], options?: { stdio?: 'pipe' | 'inherit' }) => Promise<{ stdout: string; stderr: string }>
let execaPromise: Promise<ExecaFn> | null = null
function getExeca(): Promise<ExecaFn> {
  if (!execaPromise) {
    execaPromise = import('execa').then((m) => m.execa as unknown as ExecaFn)
  }
  return execaPromise
}
import {
  PrismaClient,
  PropertyStatus,
  TagSource,
  VideoAnalysisStatus,
  type Agency,
  type Agent,
  type DpeRating,
} from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
// Direct import (bypassing lib/cloudinary which calls cloudinary.config at
// module load — too early in script context since ES imports are hoisted
// above our dotenv loadEnv calls). We config explicitly in main() once env
// is in process.env.
import { v2 as cloudinary } from 'cloudinary'
import { analyzeVideo } from '../lib/services/videoAnalysisService'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const TMP_DIR = '/tmp/shomee_scrape'
// Resolved against cwd — the script is meant to be invoked from the repo
// root (`npx tsx scripts/scrape-and-seed.ts`).
const URLS_FILE = join(process.cwd(), 'scripts', 'urls-to-scrape.txt')
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'
const VALID_DPE: ReadonlyArray<DpeRating> = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

/**
 * Mapping uploader handle → agency name. Empty mappings fall through to a
 * random pick. Names MUST match `Agency.name` exactly (case-sensitive) for
 * the lookup to land.
 */
const HANDLE_MAP: Record<string, string> = {
  deferlaimmobilier:       'Barnes Tour Eiffel',
  kretzrealestate:         'Kretz Real Estate',
  lucie_kretzrealestate:   'Kretz Real Estate',
  danielfeauimmobilier:    'Daniel Féau Passy',
  'emile.garcin':          'Varenne & Associés',
  garanceimmobilier:       'Century 21 Bastille',
  dans_le_12:              'Century 21 Bastille',
  gabriealestate:          "L'Agence des Enfants Rouges",
  'paris.luxuryhomes':     'Engel & Völkers Marais',
  adler_dan_deferla:       'Junot Immobilier',
  david_lagentimmo:        'Morriss Montparnasse',
  buildingpartners:        'Frédélion Trocadéro',
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface VideoInfo {
  id: string
  uploaderId: string | null
  description: string
  webpageUrl: string
  /** Where yt-dlp dropped the mp4. */
  localPath: string
}

interface ExtractedInfo {
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

interface UploadResult {
  videoUrl: string
  publicId: string
  thumbnailUrl: string
}

interface RunOutcome {
  ok: boolean
  error?: string
  propertyId?: string
  agencyName?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// I/O helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadUrls(): string[] {
  if (!existsSync(URLS_FILE)) {
    throw new Error(`URLs file missing: ${URLS_FILE}`)
  }
  return readFileSync(URLS_FILE, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true })
}

function urlHash(url: string): string {
  return createHash('md5').update(url).digest('hex').slice(0, 12)
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${s}s`
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — yt-dlp
// ─────────────────────────────────────────────────────────────────────────────

async function downloadVideo(url: string, prefix: string): Promise<VideoInfo> {
  const outputTemplate = join(TMP_DIR, `${prefix}.%(ext)s`)

  // First call — info JSON only.
  await (await getExeca())('yt-dlp', [
    '--no-playlist',
    '--write-info-json',
    '--skip-download',
    '-o', outputTemplate,
    url,
  ], { stdio: 'pipe' })

  const infoPath = join(TMP_DIR, `${prefix}.info.json`)
  if (!existsSync(infoPath)) {
    throw new Error(`yt-dlp ne produit pas ${prefix}.info.json`)
  }
  const info = JSON.parse(readFileSync(infoPath, 'utf-8')) as {
    id?: string
    description?: string
    uploader_id?: string
    uploader?: string
    webpage_url?: string
  }

  // Second call — video download.
  await (await getExeca())('yt-dlp', [
    '--no-playlist',
    '-f', 'mp4/best[height<=1080]',
    '-o', outputTemplate,
    url,
  ], { stdio: 'pipe' })

  // Find the actual local video file (extension chosen by yt-dlp).
  const candidates = readdirSync(TMP_DIR).filter(
    (n) => n.startsWith(`${prefix}.`) && !n.endsWith('.info.json') && !n.endsWith('.json'),
  )
  if (candidates.length === 0) {
    throw new Error(`fichier vidéo introuvable pour ${prefix}`)
  }
  const localPath = join(TMP_DIR, candidates[0])

  return {
    id: info.id ?? prefix,
    uploaderId: info.uploader_id ?? info.uploader ?? null,
    description: info.description ?? '',
    webpageUrl: info.webpage_url ?? url,
    localPath,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Cloudinary upload
// ─────────────────────────────────────────────────────────────────────────────

async function uploadToCloudinary(localPath: string, publicId: string): Promise<UploadResult> {
  const result = await cloudinary.uploader.upload(localPath, {
    resource_type: 'video',
    folder: 'shomee/videos',
    public_id: publicId,
    overwrite: true,
  })
  const fullPublicId = result.public_id
  const cloud = process.env.CLOUDINARY_CLOUD_NAME
  const thumbnailUrl = `https://res.cloudinary.com/${cloud}/video/upload/so_0,w_800,f_jpg/${fullPublicId}.jpg`
  return { videoUrl: result.secure_url, publicId: fullPublicId, thumbnailUrl }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Claude caption extraction
// ─────────────────────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `Tu es un expert immobilier parisien. Extrait les informations suivantes de cette caption de vidéo immobilière.
Retourne UNIQUEMENT un JSON valide :
{
  "title": "string — titre court du bien",
  "arrondissement": "string — ex: Paris 7ème",
  "district": "string — quartier précis ex: Champs-de-Mars",
  "price": number | null,
  "surface": number | null,
  "rooms": number | null,
  "bedrooms": number | null,
  "description": "string — description complète rédigée",
  "dpe": "A"|"B"|"C"|"D"|"E"|"F"|"G"|null,
  "hasElevator": boolean | null,
  "hasTerrace": boolean | null,
  "hasBalcony": boolean | null,
  "hasParking": boolean | null,
  "floor": number | null,
  "tags": string[] — 3 à 6 tags en anglais parmi: outdoor, living, building, ambiance, structure, location
}
Si une info n'est pas mentionnée, mets null.`

async function extractInfo(caption: string, anthropic: Anthropic): Promise<ExtractedInfo> {
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system: EXTRACTION_PROMPT,
    messages: [{ role: 'user', content: `Caption : ${caption}` }],
  })

  const text = resp.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('')
    .trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Claude n\'a pas retourné de JSON')
  const raw = JSON.parse(match[0]) as Partial<ExtractedInfo> & Record<string, unknown>

  return {
    title:          typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Bien immobilier',
    arrondissement: typeof raw.arrondissement === 'string' ? raw.arrondissement : 'Paris',
    district:       typeof raw.district === 'string' ? raw.district : '',
    price:          typeof raw.price === 'number' ? raw.price : null,
    surface:        typeof raw.surface === 'number' ? raw.surface : null,
    rooms:          typeof raw.rooms === 'number' ? raw.rooms : null,
    bedrooms:       typeof raw.bedrooms === 'number' ? raw.bedrooms : null,
    description:    typeof raw.description === 'string' ? raw.description : caption,
    dpe:            VALID_DPE.includes(raw.dpe as DpeRating) ? (raw.dpe as DpeRating) : null,
    hasElevator:    typeof raw.hasElevator === 'boolean' ? raw.hasElevator : null,
    hasTerrace:     typeof raw.hasTerrace === 'boolean' ? raw.hasTerrace : null,
    hasBalcony:     typeof raw.hasBalcony === 'boolean' ? raw.hasBalcony : null,
    hasParking:     typeof raw.hasParking === 'boolean' ? raw.hasParking : null,
    floor:          typeof raw.floor === 'number' ? raw.floor : null,
    tags:           Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — agency attribution
// ─────────────────────────────────────────────────────────────────────────────

interface AgencyWithAgent {
  agency: Agency
  agent: Agent
}

async function pickAgency(
  candidates: ReadonlyArray<string | null>,
  prisma: PrismaClient,
  pool: AgencyWithAgent[],
): Promise<AgencyWithAgent> {
  // Try every candidate identifier — yt-dlp's `uploader_id` is sometimes a
  // numeric id, sometimes the @handle, and the URL-extracted handle is a
  // reliable fallback. First hit wins.
  for (const raw of candidates) {
    if (!raw) continue
    const key = raw.trim().toLowerCase()
    const targetName = HANDLE_MAP[key]
    if (!targetName) continue
    const found = pool.find((p) => p.agency.name === targetName)
    if (found) return found
    console.warn(`  ⚠ handle "${key}" → "${targetName}" mais agence absente, fallback random`)
  }
  const idx = Math.floor(Math.random() * pool.length)
  return pool[idx]
}

async function loadAgencyPool(prisma: PrismaClient): Promise<AgencyWithAgent[]> {
  const agencies = await prisma.agency.findMany({ include: { agents: true } })
  return agencies
    .filter((a) => a.agents.length > 0)
    .map((a) => ({ agency: a, agent: a.agents[0] }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 — Property insert
// ─────────────────────────────────────────────────────────────────────────────

async function insertProperty(
  prisma: PrismaClient,
  info: ExtractedInfo,
  upload: UploadResult,
  attrib: AgencyWithAgent,
): Promise<string> {
  const districtOrArr = info.district || info.arrondissement
  const created = await prisma.property.create({
    data: {
      title:             info.title,
      arrondissement:    info.arrondissement,
      subtitle:          districtOrArr,
      district:          districtOrArr,
      location:          districtOrArr,
      description:       info.description,
      tags:              info.tags,
      dpe:               (info.dpe ?? 'D') as DpeRating,
      surface:           info.surface ?? 80,
      rooms:             info.rooms ?? 3,
      bedrooms:          info.bedrooms,
      price:             info.price ?? 500000,
      floor:             info.floor,
      hasElevator:       info.hasElevator ?? false,
      hasTerrace:        info.hasTerrace ?? false,
      hasBalcony:        info.hasBalcony ?? false,
      hasParking:        info.hasParking ?? false,
      videoUrl:          upload.videoUrl,
      imageUrlFallback:  upload.thumbnailUrl,
      statut:            PropertyStatus.PUBLISHED,
      agencyId:          attrib.agency.id,
      createdByAgentId:  attrib.agent.id,
      agentName:         attrib.agent.name,
      agentAvatar:       attrib.agent.avatar,
    },
  })
  return created.id
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 6 — optional video analysis (mirrors /api/biens/[id]/analyze-video)
// ─────────────────────────────────────────────────────────────────────────────

async function runAnalysis(
  prisma: PrismaClient,
  propertyId: string,
  videoUrl: string,
  info: ExtractedInfo,
): Promise<void> {
  const ctx = {
    rooms: info.rooms ?? undefined,
    bedrooms: info.bedrooms ?? undefined,
    description: info.description,
  }
  const { tags, chapters, error } = await analyzeVideo(videoUrl, propertyId, ctx)
  if (error) throw new Error('analyzeVideo a échoué')

  await prisma.$transaction(async (tx) => {
    if (tags.length > 0) {
      await tx.propertyTag.deleteMany({
        where: { propertyId, source: TagSource.AI_VIDEO },
      })
      await tx.propertyTag.createMany({
        data: tags.map((t) => ({
          propertyId,
          label: t.label,
          category: t.category,
          source: TagSource.AI_VIDEO,
          validated: false,
          confidence: t.confidence,
        })),
      })
    }
    await tx.videoAnalysis.upsert({
      where: { propertyId },
      create: {
        propertyId,
        status: VideoAnalysisStatus.DONE,
        chapitres: chapters,
        extractedAt: new Date(),
      },
      update: {
        status: VideoAnalysisStatus.DONE,
        chapitres: chapters,
        extractedAt: new Date(),
      },
    })
    const aiLabels = tags.map((t) => t.label)
    const fresh = await tx.property.findUniqueOrThrow({ where: { id: propertyId } })
    const mergedTags = Array.from(new Set([...(fresh.tags ?? []), ...aiLabels]))
    await tx.property.update({ where: { id: propertyId }, data: { tags: mergedTags } })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-URL pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function processUrl(
  url: string,
  idx: number,
  total: number,
  prisma: PrismaClient,
  anthropic: Anthropic,
  pool: AgencyWithAgent[],
  analyze: boolean,
): Promise<RunOutcome> {
  const tag = `[${idx + 1}/${total}]`
  const prefix = urlHash(url)
  const handle = url.match(/@([\w.\-_]+)\/video/)?.[1] ?? url.match(/instagram\.com\/p\/([\w-]+)/)?.[1] ?? prefix

  console.log(`${tag} ${handle} — téléchargement…`)
  const t0 = Date.now()
  let info: VideoInfo
  try {
    info = await downloadVideo(url, prefix)
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
    console.log(`${tag} ✗ yt-dlp: ${msg}`)
    return { ok: false, error: `yt-dlp: ${msg}` }
  }
  const fileSize = statSync(info.localPath).size
  console.log(`${tag} ✓ vidéo téléchargée (${formatDuration(Date.now() - t0)}, ${formatBytes(fileSize)})`)

  let upload: UploadResult
  try {
    upload = await uploadToCloudinary(info.localPath, prefix)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`${tag} ✗ Cloudinary: ${msg}`)
    return { ok: false, error: `cloudinary: ${msg}` }
  }
  console.log(`${tag} ✓ uploadée sur Cloudinary`)

  let extracted: ExtractedInfo
  try {
    extracted = await extractInfo(info.description, anthropic)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`${tag} ✗ extraction Claude: ${msg}`)
    return { ok: false, error: `claude: ${msg}` }
  }
  const priceFmt = extracted.price ? `${Math.round(extracted.price / 1000)}k€` : '—'
  console.log(`${tag} ✓ infos extraites: ${extracted.arrondissement}, ${extracted.rooms ?? '?'}P, ${priceFmt}`)

  const attrib = await pickAgency([info.uploaderId, handle], prisma, pool)

  let propertyId: string
  try {
    propertyId = await insertProperty(prisma, extracted, upload, attrib)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`${tag} ✗ insert DB: ${msg}`)
    return { ok: false, error: `db: ${msg}` }
  }
  console.log(`${tag} ✓ bien créé: ${propertyId} — ${attrib.agency.name}`)

  if (analyze) {
    try {
      await runAnalysis(prisma, propertyId, upload.videoUrl, extracted)
      console.log(`${tag} ✓ analyse IA terminée`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`${tag} ⚠ analyse IA échouée: ${msg}`)
      // Ne pas marquer le bien comme erreur global — il est créé.
    }
  }

  // Best-effort local cleanup so /tmp doesn't grow unbounded.
  try { unlinkSync(info.localPath) } catch { /* ignore */ }
  try { unlinkSync(join(TMP_DIR, `${prefix}.info.json`)) } catch { /* ignore */ }

  return { ok: true, propertyId, agencyName: attrib.agency.name }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const analyze = process.argv.includes('--analyze')

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non défini')
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY non défini')
  if (!process.env.CLOUDINARY_CLOUD_NAME) throw new Error('CLOUDINARY_CLOUD_NAME non défini')
  if (!process.env.CLOUDINARY_API_KEY) throw new Error('CLOUDINARY_API_KEY non défini')
  if (!process.env.CLOUDINARY_API_SECRET) throw new Error('CLOUDINARY_API_SECRET non défini')

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,
  })

  ensureTmpDir()
  const urls = loadUrls()
  if (urls.length === 0) {
    console.log('Aucune URL dans scripts/urls-to-scrape.txt — rien à faire.')
    return
  }
  console.log(`→ ${urls.length} URLs à traiter${analyze ? ' (avec analyse IA)' : ''}`)
  console.log('')

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter })
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const pool = await loadAgencyPool(prisma)
  if (pool.length === 0) {
    throw new Error('Aucune agence avec agent en DB — lance seed-agencies d\'abord.')
  }
  console.log(`→ ${pool.length} agences disponibles dans le pool`)
  console.log('')

  const outcomes: RunOutcome[] = []
  try {
    for (let i = 0; i < urls.length; i++) {
      const outcome = await processUrl(urls[i], i, urls.length, prisma, anthropic, pool, analyze)
      outcomes.push(outcome)
      console.log('')
    }
  } finally {
    await prisma.$disconnect()
  }

  // ─── Summary ──────────────────────────────────────────────────────────
  const success = outcomes.filter((o) => o.ok).length
  const failed = outcomes.length - success
  console.log('───────────────────────────────────────────')
  console.log(`✓ ${success}/${outcomes.length} biens créés`)
  if (failed > 0) {
    console.log(`✗ ${failed} erreurs`)
    const reasons: Record<string, number> = {}
    for (const o of outcomes) {
      if (o.ok || !o.error) continue
      const key = o.error.split(':')[0]
      reasons[key] = (reasons[key] ?? 0) + 1
    }
    for (const [reason, count] of Object.entries(reasons)) {
      console.log(`  ${reason} × ${count}`)
    }
  }
  console.log('───────────────────────────────────────────')
}

main().catch((err) => {
  console.error('[scrape-and-seed] erreur fatale:', err)
  process.exit(1)
})
