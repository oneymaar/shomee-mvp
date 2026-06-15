import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma'

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

export type VideoTag = {
  videoId: string
  videoUrl: string
  arrondissements: number[]
  communes: string[]
  rooms: number[]
  bedrooms: number[]
  priceRange: [number, number]
  surfaceRange: [number, number]
}

type AdminChapter = { label: string; startSec: number }

type AdminVideo = {
  id: string
  title: string
  address: string
  videoUrl: string
  videoId: string
  surface: number
  price: number
  rooms: number
  bedrooms: number | null
  chapitres: AdminChapter[] | null
  existingTags: VideoTag | null
}

function extractCloudinaryId(videoUrl: string): string {
  const match = videoUrl.match(/\/upload\/(?:v\d+\/)?(.+?)\.mp4/)
  return match?.[1] ?? videoUrl
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

type ChapterRow = { label?: unknown; startSec?: unknown }

function parseChapters(raw: unknown): AdminChapter[] | null {
  if (!Array.isArray(raw)) return null
  const out: AdminChapter[] = []
  for (const c of raw as ChapterRow[]) {
    if (typeof c?.label !== 'string') continue
    const startSec = typeof c.startSec === 'number' ? c.startSec : 0
    out.push({ label: c.label, startSec })
  }
  return out.length > 0 ? out : null
}

export async function GET(req: NextRequest) {
  if (!checkAdminSecret(req)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const properties = await prisma.property.findMany({
    where: { videoAnalysis: { isNot: null }, videoUrl: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      location: true,
      arrondissement: true,
      videoUrl: true,
      surface: true,
      price: true,
      rooms: true,
      bedrooms: true,
      videoAnalysis: { select: { chapitres: true } },
    },
  })

  const tags = readTagsFile()
  const tagByVideoId = new Map<string, VideoTag>()
  for (const t of tags) {
    if (t?.videoId) tagByVideoId.set(t.videoId, t)
  }

  const videos: AdminVideo[] = properties
    .filter((p): p is typeof p & { videoUrl: string } => Boolean(p.videoUrl))
    .map((p) => {
      const videoId = extractCloudinaryId(p.videoUrl)
      return {
        id: p.id,
        title: p.title,
        address: p.location || p.arrondissement,
        videoUrl: p.videoUrl,
        videoId,
        surface: p.surface,
        price: p.price,
        rooms: p.rooms,
        bedrooms: p.bedrooms,
        chapitres: parseChapters(p.videoAnalysis?.chapitres),
        existingTags: tagByVideoId.get(videoId) ?? null,
      }
    })

  return NextResponse.json({ videos })
}
