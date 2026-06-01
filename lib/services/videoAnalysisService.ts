/**
 * Video analysis service — extracts frames from a Cloudinary video at 1Hz
 * and runs two parallel Claude vision calls (tags + chapters) to keep each
 * prompt focused and bounded.
 */

import Anthropic from '@anthropic-ai/sdk'
import cloudinary from '@/lib/cloudinary'

const MODEL = 'claude-sonnet-4-20250514'
const FRAME_INTERVAL_SEC = 1
const MAX_VIDEO_DURATION_SEC = 80
const MAX_TOKENS = 2000
const MIN_FRAME_BYTES = 1000
const TAG_FRAMES = 10

const TAG_SYSTEM_PROMPT = `Tu es un expert immobilier parisien. Analyse ces 10 frames d'une visite immobilière et identifie les caractéristiques visuelles du bien.

Retourne UNIQUEMENT un JSON valide :
{ "tags": [{ "label": "string", "category": "string", "confidence": 0.0-1.0 }] }

Caractéristiques à extraire :
- Structure : parquet, moulures, hauteur sous plafond > 3m, cheminée, double vitrage...
- Luminosité : lumineux, sombre, orienté sud...
- État : bon état, rénové, à rénover, neuf...
- Extérieur : balcon, terrasse, jardin, cour, vue dégagée...
- Standing : immeuble haussmannien, années 60-70, moderne, contemporain...

RÈGLE CRITIQUE pour le style architectural : base-toi UNIQUEMENT sur l'intérieur (plafonds, fenêtres, moulures, sols). Ne te fie jamais à ce qu'on voit par les fenêtres.

Ne mets que des tags avec confidence > 0.7. Préfère ne pas taguer plutôt que d'inventer.`

const CHAPTERS_PROMPT_HEAD = `Tu es un expert immobilier. Analyse cette séquence de frames d'une visite immobilière pour identifier les changements de pièce.

Chaque frame est précédée de son timestamp exact (ex: "=== FRAME 5 — 4s ===").

Retourne UNIQUEMENT un JSON valide :
{ "chapters": [{ "label": "string", "startSec": number }] }

RÈGLES :
- Crée un chapter uniquement quand une nouvelle pièce apparaît clairement pour la première fois.
- Le startSec doit être le timestamp exact indiqué avant la frame où la pièce apparaît.
- Si la même pièce apparaît à nouveau plus tard, crée un nouveau chapter avec le nouveau timestamp.
- Pour les chambres multiples : "Chambre parentale", "Chambre 1", "Chambre 2", "Chambre enfant".
- Tous les startSec doivent être entre 0 et la durée totale de la vidéo.
- Ne jamais inventer un timestamp qui n'existe pas dans la liste des frames.`

const CHAPTERS_PROMPT_TAIL = `RÈGLES D'EXHAUSTIVITÉ — CRITIQUES :
- Toute pièce contenant un lit DOIT être chapitrée. Un grand lit double = chambre parentale. Un lit simple ou jouets = chambre enfant ou Chambre 1/2/3.
- Si deux chapters consécutifs sont séparés de plus de 5 secondes, relis attentivement les frames intermédiaires — il y a probablement une pièce manquante entre les deux.
- Un balcon ou une terrasse visible depuis une chambre doit être chapitré séparément si on le montre clairement.
- En cas de doute sur une pièce, chapitres-la quand même avec le label le plus probable — il vaut mieux un chapter approximatif qu'une pièce manquante.
- Une cuisine se reconnaît aux placards, plan de travail, évier ou appareils électroménagers. Ne la confonds pas avec un séjour même si elle est ouverte.

Labels autorisés : Extérieur, Entrée, Couloir, Salon, Séjour, Cuisine, Chambre parentale, Chambre 1, Chambre 2, Chambre 3, Chambre enfant, Salle de bain, Salle d'eau, WC, Bureau, Dressing, Terrasse, Balcon, Cave.`

function buildContextBlock(context?: PropertyContext): string {
  if (!context) return ''
  const lines: string[] = []
  if (context.rooms != null) lines.push(`- Nombre de pièces : ${context.rooms}`)
  if (context.bedrooms != null) lines.push(`- Nombre de chambres : ${context.bedrooms}`)
  if (context.composition && context.composition.length > 0) {
    const summary = context.composition.map((p) => `${p.label} (${p.surface}m²)`).join(', ')
    lines.push(`- Composition connue : ${summary}`)
  }
  if (context.description) {
    lines.push(`- Description : ${context.description.slice(0, 200)}`)
  }
  if (lines.length === 0) return ''
  const target = context.bedrooms != null ? `${context.bedrooms}` : 'plusieurs'
  return `
CONTEXTE DU BIEN (utilise-le comme référence, pas comme vérité absolue) :
${lines.join('\n')}

Si le bien a ${target} chambre(s), cherche activement ces pièces dans la vidéo même si la transition est rapide.
`
}

function buildChaptersSystemPrompt(context?: PropertyContext): string {
  return `${CHAPTERS_PROMPT_HEAD}\n${buildContextBlock(context)}\n${CHAPTERS_PROMPT_TAIL}`
}

export type VideoTag = { label: string; category: string; confidence: number }
export type VideoChapter = { label: string; startSec: number }

export type VideoAnalysisResult = {
  tags: VideoTag[]
  chapters: VideoChapter[]
}

export type PropertyContext = {
  rooms?: number
  bedrooms?: number
  composition?: Array<{ label: string; surface: number }>
  description?: string
}

type Frame = { sec: number; data: string }

/**
 * Extract Cloudinary public_id + cloud name from a delivery URL like:
 *   https://res.cloudinary.com/{cloud}/video/upload/{maybe_version}/{public_id}.{ext}
 * Tolerates an optional /v1234567/ version segment between `/upload/` and the
 * public_id.
 */
function parseCloudinaryUrl(videoUrl: string): { cloud: string; publicId: string } | null {
  try {
    const u = new URL(videoUrl)
    if (!u.hostname.endsWith('res.cloudinary.com')) return null
    const parts = u.pathname.split('/').filter(Boolean) // ['<cloud>', 'video', 'upload', ...]
    const uploadIdx = parts.indexOf('upload')
    if (uploadIdx < 0 || uploadIdx + 1 >= parts.length) return null
    const cloud = parts[0]
    let rest = parts.slice(uploadIdx + 1)
    if (rest[0]?.match(/^v\d+$/)) rest = rest.slice(1)
    if (rest.length === 0) return null
    const joined = rest.join('/')
    const publicId = joined.replace(/\.[a-zA-Z0-9]+$/, '')
    if (!publicId) return null
    return { cloud, publicId }
  } catch {
    return null
  }
}

function frameUrl(cloud: string, publicId: string, sec: number): string {
  return `https://res.cloudinary.com/${cloud}/video/upload/so_${sec},w_800,h_600,c_fill,f_jpg/${publicId}.jpg`
}

export const VIDEO_MAX_DURATION_SEC = MAX_VIDEO_DURATION_SEC

/** Fetch the video duration from Cloudinary. Returns null if unavailable. */
export async function getVideoDuration(videoUrl: string): Promise<number | null> {
  const parsed = parseCloudinaryUrl(videoUrl)
  if (!parsed) return null
  try {
    const resource = (await cloudinary.api.resource(parsed.publicId, {
      resource_type: 'video',
      media_metadata: true,
    })) as { duration?: number; video?: { duration?: number } }
    return resource.duration ?? resource.video?.duration ?? null
  } catch {
    return null
  }
}

function parseTagsJson(text: string): VideoTag[] {
  const match = text.match(/\{[\s\S]*\}/)
  const body = match ? match[0] : text
  try {
    const parsed = JSON.parse(body) as { tags?: unknown }
    if (!Array.isArray(parsed?.tags)) return []
    return parsed.tags
      .map((t): VideoTag | null => {
        if (!t || typeof t !== 'object') return null
        const o = t as { label?: unknown; category?: unknown; confidence?: unknown }
        if (typeof o.label !== 'string' || typeof o.category !== 'string') return null
        const confidence = typeof o.confidence === 'number' ? o.confidence : 0
        return { label: o.label, category: o.category, confidence }
      })
      .filter((t): t is VideoTag => t !== null)
  } catch {
    return []
  }
}

function parseChaptersJson(text: string, maxSec: number): VideoChapter[] {
  const match = text.match(/\{[\s\S]*\}/)
  const body = match ? match[0] : text
  try {
    const parsed = JSON.parse(body) as { chapters?: unknown }
    if (!Array.isArray(parsed?.chapters)) return []
    return parsed.chapters
      .map((c): VideoChapter | null => {
        if (!c || typeof c !== 'object') return null
        const o = c as { label?: unknown; startSec?: unknown }
        if (typeof o.label !== 'string') return null
        const startSec = typeof o.startSec === 'number' ? o.startSec : 0
        return { label: o.label, startSec }
      })
      .filter((c): c is VideoChapter => c !== null && c.startSec <= maxSec)
  } catch {
    return []
  }
}

function pickTagFrames(validFrames: Frame[]): Frame[] {
  if (validFrames.length <= TAG_FRAMES) return validFrames
  const last = validFrames.length - 1
  const indices = Array.from({ length: TAG_FRAMES }, (_, i) =>
    Math.round((i / (TAG_FRAMES - 1)) * last),
  )
  return indices.map((i) => validFrames[i])
}

async function callTags(client: Anthropic, validFrames: Frame[]): Promise<VideoTag[]> {
  const tagFrames = pickTagFrames(validFrames)
  const imageBlocks = tagFrames.map((f) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: 'image/jpeg' as const,
      data: f.data,
    },
  }))
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: TAG_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: 'Analyse ces frames et retourne le JSON des tags.' },
          ],
        },
      ],
    })
    const block = res.content[0]
    if (!block || block.type !== 'text') return []
    const parsed = parseTagsJson(block.text)
    console.log('[analyzeVideo] tags raw (1000c):', block.text.slice(0, 1000))
    console.log('[analyzeVideo] tags parsed:', parsed.length, JSON.stringify(parsed))
    return parsed
  } catch (err) {
    console.error('[analyzeVideo] tags call failed:', err)
    return []
  }
}

async function callChapters(
  client: Anthropic,
  validFrames: Frame[],
  effectiveDuration: number,
  context?: PropertyContext,
): Promise<VideoChapter[]> {
  const content = validFrames.flatMap((f, i) => [
    { type: 'text' as const, text: `=== FRAME ${i + 1} — ${f.sec}s ===` },
    {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/jpeg' as const,
        data: f.data,
      },
    },
  ])
  const userText = `Vidéo de ${Math.round(effectiveDuration)} secondes. Identifie tous les changements de pièce avec leurs timestamps exacts.`
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildChaptersSystemPrompt(context),
      messages: [
        {
          role: 'user',
          content: [...content, { type: 'text', text: userText }],
        },
      ],
    })
    const block = res.content[0]
    if (!block || block.type !== 'text') return []
    const parsed = parseChaptersJson(block.text, effectiveDuration)
    console.log('[analyzeVideo] chapters raw (1500c):', block.text.slice(0, 1500))
    console.log('[analyzeVideo] chapters parsed:', parsed.length, JSON.stringify(parsed))
    return parsed
  } catch (err) {
    console.error('[analyzeVideo] chapters call failed:', err)
    return []
  }
}

export async function analyzeVideo(
  videoUrl: string,
  _propertyId: string,
  context?: PropertyContext,
): Promise<VideoAnalysisResult> {
  void _propertyId

  const parsed = parseCloudinaryUrl(videoUrl)
  if (!parsed) return { tags: [], chapters: [] }
  const { cloud, publicId } = parsed

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { tags: [], chapters: [] }

  let durationSec: number | null = null
  try {
    const resource = (await cloudinary.api.resource(publicId, {
      resource_type: 'video',
      media_metadata: true,
    })) as { duration?: number; video?: { duration?: number } }
    durationSec = resource.duration ?? resource.video?.duration ?? null
  } catch (err) {
    console.error('[analyzeVideo] cloudinary.api.resource failed:', err)
  }
  const effectiveDuration = Math.min(durationSec ?? MAX_VIDEO_DURATION_SEC, MAX_VIDEO_DURATION_SEC)

  const frames: Array<{ sec: number; url: string }> = []
  for (let sec = 0; sec <= effectiveDuration; sec += FRAME_INTERVAL_SEC) {
    frames.push({ sec, url: frameUrl(cloud, publicId, sec) })
  }

  const results = await Promise.all(
    frames.map(async (f) => {
      try {
        const res = await fetch(f.url)
        if (!res.ok) return null
        const buffer = await res.arrayBuffer()
        if (buffer.byteLength < MIN_FRAME_BYTES) return null
        return { sec: f.sec, data: Buffer.from(buffer).toString('base64') }
      } catch {
        return null
      }
    }),
  )
  const validFrames = results.filter((r): r is Frame => r !== null)
  if (validFrames.length === 0) return { tags: [], chapters: [] }

  const client = new Anthropic({ apiKey })
  const [tags, chapters] = await Promise.all([
    callTags(client, validFrames),
    callChapters(client, validFrames, effectiveDuration, context),
  ])

  return { tags, chapters }
}
