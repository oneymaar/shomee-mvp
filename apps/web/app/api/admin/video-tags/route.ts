import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

export const dynamic = 'force-dynamic'

const ADMIN_SECRET = 'shomee_admin'
const TAGS_FILE = path.join(process.cwd(), 'src', 'data', 'video-tags.json')

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
 * POST /api/admin/video-tags?secret=shomee_admin
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
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== ADMIN_SECRET) {
    return new NextResponse('Not Found', { status: 404 })
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
