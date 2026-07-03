/**
 * Shomee — TikTok Studio, couche serveur (Jalon 1).
 *
 * URL TikTok → mp4 local (yt-dlp) → Cloudinary → infos extraites de la caption
 * (Claude Sonnet). Port fidèle des étapes ①②③ de scripts/scrape-and-seed.ts,
 * adapté pour tourner dans une route API Next (runtime Node, dev local).
 *
 * ⚠️ SERVEUR UNIQUEMENT — importe node:child_process / cloudinary / Anthropic.
 * Ne jamais importer depuis un composant client.
 *
 * yt-dlp est un binaire système (installé via brew : /opt/homebrew/bin/yt-dlp).
 * Il n'existe PAS sur le runtime serverless Vercel — cet outil est prévu pour
 * tourner en local (`npm run dev`), ce qui correspond au flux de démo.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { v2 as cloudinary } from 'cloudinary'
import type { DpeRating, ExtractedInfo } from '@/lib/admin/tiktokStudioTypes'
import { VALID_DPE } from '@/lib/admin/tiktokStudioTypes'

const execFileAsync = promisify(execFile)

const TMP_DIR = '/tmp/shomee_tiktok'
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp'
// Sonnet 4 (claude-sonnet-4-20250514) renvoie un 404 not_found sur le compte —
// remplacé par le Sonnet courant. scrape-and-seed.ts porte encore l'ancien ID.
const CLAUDE_MODEL = 'claude-sonnet-4-6'

// ─────────────────────────────────────────────────────────────────────────────
// URL guard — TikTok-only (Instagram = hors scope, nécessite cookies).
// ─────────────────────────────────────────────────────────────────────────────

export function isTikTokUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return /(^|\.)tiktok\.com$/.test(u.hostname)
  } catch {
    return false
  }
}

function urlHash(url: string): string {
  return createHash('md5').update(url).digest('hex').slice(0, 12)
}

function handleFromUrl(url: string): string | null {
  return url.match(/@([\w.\-_]+)\/video/)?.[1] ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Étape ① — download yt-dlp (métadonnées + mp4 en un seul appel).
// ─────────────────────────────────────────────────────────────────────────────

export interface TikTokDownload {
  /** Où yt-dlp a déposé le mp4. */
  localPath: string
  /** md5 de l'URL — sert de public_id Cloudinary déterministe. */
  prefix: string
  caption: string
  videoId: string
  uploaderId: string | null
  handle: string | null
  webpageUrl: string
}

export async function downloadTikTok(url: string): Promise<TikTokDownload> {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true })
  const prefix = urlHash(url)
  const outputTemplate = join(TMP_DIR, `${prefix}.%(ext)s`)

  // Un seul appel : télécharge le mp4 ET écrit l'info.json (caption/uploader).
  // `mp4/best[height<=1080]` → format mono-fichier, pas besoin de ffmpeg.
  try {
    await execFileAsync(
      YTDLP_BIN,
      [
        '--no-playlist',
        '--no-warnings',
        '--write-info-json',
        '-f',
        'mp4/best[height<=1080]',
        '-o',
        outputTemplate,
        url,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    )
  } catch (err) {
    // yt-dlp casse quand TikTok durcit : on remonte la 1re ligne de stderr,
    // pas un stack trace, pour un message actionnable côté UI.
    const stderr = (err as { stderr?: string })?.stderr
    const msg = (stderr || (err instanceof Error ? err.message : String(err))).split('\n')[0]
    throw new Error(`yt-dlp: ${msg}`)
  }

  const infoPath = join(TMP_DIR, `${prefix}.info.json`)
  let info: {
    id?: string
    description?: string
    uploader_id?: string
    uploader?: string
    webpage_url?: string
  } = {}
  if (existsSync(infoPath)) {
    try {
      info = JSON.parse(readFileSync(infoPath, 'utf-8'))
    } catch {
      /* info.json illisible — on continue avec des valeurs vides */
    }
  }

  // Le mp4 réel (extension choisie par yt-dlp) — hors .info.json / .json.
  const candidates = readdirSync(TMP_DIR).filter(
    (n) => n.startsWith(`${prefix}.`) && !n.endsWith('.info.json') && !n.endsWith('.json'),
  )
  if (candidates.length === 0) {
    throw new Error('yt-dlp: fichier vidéo introuvable après téléchargement')
  }

  return {
    localPath: join(TMP_DIR, candidates[0]),
    prefix,
    caption: info.description ?? '',
    videoId: info.id ?? prefix,
    uploaderId: info.uploader_id ?? info.uploader ?? null,
    handle: handleFromUrl(url) ?? info.uploader ?? null,
    webpageUrl: info.webpage_url ?? url,
  }
}

/** Supprime le mp4 + info.json locaux (best-effort). */
export function cleanupDownload(dl: TikTokDownload): void {
  try {
    unlinkSync(dl.localPath)
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(join(TMP_DIR, `${dl.prefix}.info.json`))
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Étape ② — upload Cloudinary.
// ─────────────────────────────────────────────────────────────────────────────

export interface UploadResult {
  videoUrl: string
  publicId: string
  thumbnailUrl: string
}

export async function uploadToCloudinary(
  localPath: string,
  publicId: string,
): Promise<UploadResult> {
  // Config explicite (le module @/lib/cloudinary configure au load, mais on
  // reconfigure ici par sûreté — même env, singleton partagé).
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  })
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
// Étape ③ — extraction des infos depuis la caption (Claude Sonnet).
// Prompt repris à l'identique de scrape-and-seed.ts.
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

export async function extractInfoFromCaption(
  caption: string,
  anthropic: Anthropic,
): Promise<ExtractedInfo> {
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
  if (!match) throw new Error("Claude n'a pas retourné de JSON")
  const raw = JSON.parse(match[0]) as Partial<ExtractedInfo> & Record<string, unknown>

  return {
    title:
      typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Bien immobilier',
    arrondissement: typeof raw.arrondissement === 'string' ? raw.arrondissement : 'Paris',
    district: typeof raw.district === 'string' ? raw.district : '',
    price: typeof raw.price === 'number' ? raw.price : null,
    surface: typeof raw.surface === 'number' ? raw.surface : null,
    rooms: typeof raw.rooms === 'number' ? raw.rooms : null,
    bedrooms: typeof raw.bedrooms === 'number' ? raw.bedrooms : null,
    description: typeof raw.description === 'string' ? raw.description : caption,
    dpe: VALID_DPE.includes(raw.dpe as DpeRating) ? (raw.dpe as DpeRating) : null,
    hasElevator: typeof raw.hasElevator === 'boolean' ? raw.hasElevator : null,
    hasTerrace: typeof raw.hasTerrace === 'boolean' ? raw.hasTerrace : null,
    hasBalcony: typeof raw.hasBalcony === 'boolean' ? raw.hasBalcony : null,
    hasParking: typeof raw.hasParking === 'boolean' ? raw.hasParking : null,
    floor: typeof raw.floor === 'number' ? raw.floor : null,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === 'string')
      : [],
  }
}
