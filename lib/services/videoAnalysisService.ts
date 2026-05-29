/**
 * Video analysis service — extracts frames from a Cloudinary video at fixed
 * intervals, sends them to Claude vision in a single request, and parses the
 * resulting tags + chapter markers.
 */

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-20250514'
const MAX_FRAMES = 20
const FRAME_INTERVAL_SEC = 2
const MAX_TOKENS = 2000

const SYSTEM_PROMPT = `Tu es un expert immobilier parisien. Analyse ces frames extraites d'une vidéo de visite immobilière.

Retourne UNIQUEMENT un JSON valide avec cette structure exacte :
{
  "tags": [
    { "label": "string", "category": "string", "confidence": 0.0-1.0 }
  ],
  "chapters": [
    { "label": "string", "startSec": 0 }
  ]
}

Pour les tags, extrais des caractéristiques objectives et qualitatives :
- Caractéristiques structurelles (parquet, moulures, hauteur sous plafond, cheminée...)
- Luminosité et orientation (lumineux, orienté sud, sans vis-à-vis...)
- État général (bon état, rénové, à rénover...)
- Extérieurs (balcon, terrasse, cour...)
- Type architectural (haussmannien, ancien, moderne...)
Ne mets que des tags avec confidence > 0.7.

Pour les chapters, identifie chaque changement de pièce avec son timestamp estimé en secondes.
Les labels de pièces doivent être : Entrée, Salon, Séjour, Cuisine, Chambre, Salle de bain, Salle d'eau, Bureau, Dressing, Terrasse, Balcon, Cave, Extérieur.`

export type VideoTag = { label: string; category: string; confidence: number }
export type VideoChapter = { label: string; startSec: number }

export type VideoAnalysisResult = {
  tags: VideoTag[]
  chapters: VideoChapter[]
}

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

function parseClaudeJson(text: string): VideoAnalysisResult {
  // Tolerate stray text around the JSON body.
  const match = text.match(/\{[\s\S]*\}/)
  const body = match ? match[0] : text
  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== 'object') return { tags: [], chapters: [] }
    const obj = parsed as { tags?: unknown; chapters?: unknown }

    const tags: VideoTag[] = Array.isArray(obj.tags)
      ? obj.tags
          .map((t): VideoTag | null => {
            if (!t || typeof t !== 'object') return null
            const o = t as { label?: unknown; category?: unknown; confidence?: unknown }
            if (typeof o.label !== 'string' || typeof o.category !== 'string') return null
            const confidence = typeof o.confidence === 'number' ? o.confidence : 0
            return { label: o.label, category: o.category, confidence }
          })
          .filter((t): t is VideoTag => t !== null)
      : []

    const chapters: VideoChapter[] = Array.isArray(obj.chapters)
      ? obj.chapters
          .map((c): VideoChapter | null => {
            if (!c || typeof c !== 'object') return null
            const o = c as { label?: unknown; startSec?: unknown }
            if (typeof o.label !== 'string') return null
            const startSec = typeof o.startSec === 'number' ? o.startSec : 0
            return { label: o.label, startSec }
          })
          .filter((c): c is VideoChapter => c !== null)
      : []

    return { tags, chapters }
  } catch {
    return { tags: [], chapters: [] }
  }
}

export async function analyzeVideo(
  videoUrl: string,
  _propertyId: string,
): Promise<VideoAnalysisResult> {
  void _propertyId

  const parsed = parseCloudinaryUrl(videoUrl)
  console.log('[analyzeVideo] parsed:', JSON.stringify(parsed))
  if (!parsed) return { tags: [], chapters: [] }
  const { cloud, publicId } = parsed

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { tags: [], chapters: [] }

  const frames: Array<{ sec: number; url: string }> = []
  for (let i = 0; i < MAX_FRAMES; i++) {
    const sec = i * FRAME_INTERVAL_SEC
    frames.push({ sec, url: frameUrl(cloud, publicId, sec) })
  }
  console.log('[analyzeVideo] frames générées:', frames.length, 'première URL:', frames[0]?.url)

  const client = new Anthropic({ apiKey })

  const imageBlocks = frames.map((f) => ({
    type: 'image' as const,
    source: { type: 'url' as const, url: f.url },
  }))

  const userText = `Voici ${frames.length} frames extraites toutes les ${FRAME_INTERVAL_SEC}s à partir de la seconde 0 (frame 1 = 0s, frame 2 = ${FRAME_INTERVAL_SEC}s, etc.). Analyse-les et retourne le JSON demandé.`

  try {
    console.log('[analyzeVideo] envoi à Claude, nb images:', imageBlocks.length)
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: userText },
          ],
        },
      ],
    })
    const block = res.content[0]
    console.log('[analyzeVideo] réponse Claude brute:', block?.type, block?.type === 'text' ? block.text.slice(0, 500) : 'non-text')
    if (!block || block.type !== 'text') return { tags: [], chapters: [] }
    return parseClaudeJson(block.text)
  } catch (err) {
    console.error('[analyzeVideo] Anthropic error:', err)
    return { tags: [], chapters: [] }
  }
}
