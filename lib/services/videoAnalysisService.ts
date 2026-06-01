/**
 * Video analysis service — extracts frames from a Cloudinary video at fixed
 * intervals, sends them to Claude vision in a single request, and parses the
 * resulting tags + chapter markers.
 */

import Anthropic from '@anthropic-ai/sdk'
import cloudinary from '@/lib/cloudinary'

const MODEL = 'claude-sonnet-4-20250514'
const MAX_FRAMES = 20
const FRAME_INTERVAL_SEC = 2
const MAX_TOKENS = 2000
const DEFAULT_DURATION_SEC = 60
const MIN_FRAME_BYTES = 1000

const SYSTEM_PROMPT = `Tu es un expert immobilier parisien qui analyse des frames extraites d'une vidéo de visite immobilière.

Retourne UNIQUEMENT un JSON valide avec cette structure exacte :
{
  "tags": [
    { "label": "string", "category": "string", "confidence": 0.0-1.0 }
  ],
  "chapters": [
    { "label": "string", "startSec": 0 }
  ]
}

═══ RÈGLES POUR LES CHAPTERS ═══

Chaque frame correspond à un timestamp précis (frame 1 = 0s, frame 2 = 2s, frame 3 = 4s, etc.).
Crée un chapter dès qu'une nouvelle pièce apparaît pour la première fois dans une frame.
Le timestamp du chapter doit être celui de la frame où la pièce apparaît clairement — pas avant, pas après.

RÈGLES CRITIQUES :
- Si la même pièce apparaît plusieurs fois à des moments différents, crée un chapter distinct pour CHAQUE apparition avec son timestamp réel.
- Pour les chambres multiples, numérote : "Chambre parentale" (si grand lit double visible), "Chambre 1", "Chambre 2", "Chambre enfant" (si lit enfant ou jouets visibles).
- Ne fusionne JAMAIS deux apparitions distinctes d'une même pièce.
- Si tu n'es pas sûr d'une pièce, préfère ne pas la mentionner plutôt que d'inventer.
- Sois précis sur les timestamps — si la cuisine apparaît clairement à la frame 5 (10s), mets startSec: 10, pas 8 ni 12.

Labels autorisés : Extérieur, Entrée, Couloir, Salon, Séjour, Cuisine, Chambre parentale, Chambre 1, Chambre 2, Chambre 3, Chambre enfant, Salle de bain, Salle d'eau, WC, Bureau, Dressing, Terrasse, Balcon, Cave.

EXEMPLE DE BONNE RÉPONSE pour une vidéo de 34s montrant : extérieur (0s) → salon (3s) → balcon (7s) → retour salon (10s) → chambre parentale (15s) → chambre enfant (25s) :
"chapters": [
  { "label": "Extérieur", "startSec": 0 },
  { "label": "Salon", "startSec": 3 },
  { "label": "Balcon", "startSec": 7 },
  { "label": "Salon", "startSec": 10 },
  { "label": "Chambre parentale", "startSec": 15 },
  { "label": "Chambre enfant", "startSec": 25 }
]

═══ RÈGLES POUR LES TAGS ═══

Extrais uniquement des caractéristiques visuelles observées DANS les pièces intérieures.

RÈGLE CRITIQUE POUR LE STYLE ARCHITECTURAL :
- Pour déterminer le style (haussmannien, années 60-70, moderne, contemporain...), base-toi UNIQUEMENT sur ce que tu vois à l'intérieur : hauteur de plafond, type de fenêtres, présence de moulures, parquet ou non, type de revêtement de sol.
- Ne te fie JAMAIS à ce qu'on voit par les fenêtres (immeuble en face, rue...). Un immeuble haussmannien visible de l'extérieur ne signifie pas que l'appartement filmé est haussmannien.
- Si tu ne vois pas clairement le style architectural intérieur, n'ajoute pas de tag de style.

Categories valides : structure, luminosite, etat, exterieur, style, standing.

Ne mets que des tags avec confidence > 0.7.
Préfère ne pas taguer plutôt que de taguer avec incertitude.`

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

  console.log('[analyzeVideo] videoUrl:', videoUrl)
  const parsed = parseCloudinaryUrl(videoUrl)
  console.log('[analyzeVideo] parsed:', JSON.stringify(parsed))
  if (!parsed) return { tags: [], chapters: [] }
  const { cloud, publicId } = parsed

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { tags: [], chapters: [] }

  let durationSec: number = DEFAULT_DURATION_SEC
  try {
    const resource = (await cloudinary.api.resource(publicId, {
      resource_type: 'video',
      media_metadata: true,
    })) as Record<string, unknown> & {
      duration?: number
      video?: { duration?: number }
    }
    console.log('[analyzeVideo] cloudinary resource keys:', Object.keys(resource))
    durationSec = resource.duration ?? resource.video?.duration ?? DEFAULT_DURATION_SEC
  } catch (err) {
    console.error('[analyzeVideo] cloudinary.api.resource failed:', err)
  }
  const maxSec = Math.floor(durationSec)
  console.log('[analyzeVideo] durationSec:', durationSec, 'maxSec:', maxSec)

  const frames: Array<{ sec: number; url: string }> = []
  for (let i = 0; i < MAX_FRAMES; i++) {
    const sec = i * FRAME_INTERVAL_SEC
    if (sec > maxSec) break
    frames.push({ sec, url: frameUrl(cloud, publicId, sec) })
  }
  console.log('[analyzeVideo] frames générées:', frames.length, 'première URL:', frames[0]?.url)

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
  const validFrames = results.filter((r): r is NonNullable<typeof r> => r !== null)
  console.log('[analyzeVideo] frames téléchargées:', validFrames.length, '/', frames.length)
  if (validFrames.length === 0) return { tags: [], chapters: [] }

  const client = new Anthropic({ apiKey })

  const imageBlocks = validFrames.map((f) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: 'image/jpeg' as const,
      data: f.data,
    },
  }))

  const frameList = validFrames.map((f, i) => `Frame ${i + 1} = ${f.sec}s`).join(', ')
  const userText = `Voici ${validFrames.length} frames extraites de la vidéo (${frameList}). Analyse-les et retourne le JSON demandé.`

  console.log('[analyzeVideo] avant Claude — nbFrames:', validFrames.length,
    'first3sec:', validFrames.slice(0, 3).map((f) => f.sec),
    'systemPromptChars:', SYSTEM_PROMPT.length)

  try {
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
    const rawText = block?.type === 'text' ? block.text : ''
    console.log('[analyzeVideo] réponse Claude brute (1000 char):', block?.type,
      rawText ? rawText.slice(0, 1000) : 'non-text')
    if (!block || block.type !== 'text') return { tags: [], chapters: [] }
    const parsedResult = parseClaudeJson(block.text)
    console.log('[analyzeVideo] parseClaudeJson result:',
      'tags=', parsedResult.tags.length,
      'chapters=', parsedResult.chapters.length,
      'sample:', JSON.stringify({
        tag0: parsedResult.tags[0],
        chapter0: parsedResult.chapters[0],
      }))
    return parsedResult
  } catch (err) {
    console.error('[analyzeVideo] Anthropic error:', err)
    return { tags: [], chapters: [] }
  }
}
