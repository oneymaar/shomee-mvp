import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'

export const dynamic = 'force-dynamic'

const TAGS_FILE = path.join(process.cwd(), 'src', 'data', 'video-tags.json')

/**
 * Admin auth — secret lu UNIQUEMENT depuis le header `x-admin-secret`, comparé
 * en timing-safe à `process.env.ADMIN_SECRET`. Refuse par défaut si l'env n'est
 * pas configurée. Jamais de secret en query string ni en dur dans le code.
 */
function checkAdminSecret(req: Request): boolean {
  const expected = process.env.ADMIN_SECRET
  if (!expected) return false
  const provided = req.headers.get('x-admin-secret')
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

type VideoTag = {
  videoId: string
  videoUrl: string
  arrondissements: number[]
  communes: string[]
  rooms: number[]
  bedrooms: number[]
  priceRange: [number, number]
  surfaceRange: [number, number]
}

function isNumberArray(x: unknown): x is number[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'number')
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'string')
}

function isRange(x: unknown): x is [number, number] {
  return (
    Array.isArray(x) &&
    x.length === 2 &&
    typeof x[0] === 'number' &&
    typeof x[1] === 'number'
  )
}

function validate(body: unknown): VideoTag[] | null {
  if (!Array.isArray(body)) return null
  const out: VideoTag[] = []
  for (const item of body) {
    if (!item || typeof item !== 'object') return null
    const t = item as Record<string, unknown>
    if (typeof t.videoId !== 'string' || typeof t.videoUrl !== 'string') return null
    if (!isNumberArray(t.arrondissements)) return null
    if (!isStringArray(t.communes)) return null
    if (!isNumberArray(t.rooms)) return null
    if (!isNumberArray(t.bedrooms)) return null
    if (!isRange(t.priceRange)) return null
    if (!isRange(t.surfaceRange)) return null
    out.push({
      videoId: t.videoId,
      videoUrl: t.videoUrl,
      arrondissements: t.arrondissements,
      communes: t.communes,
      rooms: t.rooms,
      bedrooms: t.bedrooms,
      priceRange: t.priceRange,
      surfaceRange: t.surfaceRange,
    })
  }
  return out
}

/**
 * POST /api/admin/video-tags  (header `x-admin-secret: <ADMIN_SECRET>`)
 *
 * Persiste l'intégralité du tagging vidéo dans src/data/video-tags.json.
 *
 * ⚠️ Sur Vercel, fs.writeFileSync écrit dans un filesystem éphémère :
 * la modification disparaît au prochain déploiement. Après chaque
 * session de tagging, lire le textarea de la page admin et commiter
 * le fichier video-tags.json manuellement pour que la prod garde
 * la nouvelle config.
 */
export async function POST(req: NextRequest) {
  if (!checkAdminSecret(req)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const tags = validate(body)
  if (!tags) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  try {
    fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2) + '\n', 'utf-8')
  } catch (error) {
    console.error('[POST /api/admin/video-tags] write failed:', error)
    return NextResponse.json({ error: 'write_failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true, count: tags.length })
}
