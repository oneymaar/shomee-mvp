import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import VideoTaggerClient, { type VideoEntry } from './VideoTaggerClient'

export const dynamic = 'force-dynamic'

const ADMIN_SECRET = 'shomee_admin'

function extractCloudinaryId(videoUrl: string): string {
  const match = videoUrl.match(/\/upload\/(?:v\d+\/)?(.+?)\.mp4/)
  return match?.[1] ?? videoUrl
}

type ChapterRow = { label?: unknown }

function parseChapters(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((c: ChapterRow) => (typeof c?.label === 'string' ? c.label : null))
    .filter((label): label is string => label !== null)
}

export default async function VideoTaggerPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string }>
}) {
  const { secret } = await searchParams
  if (secret !== ADMIN_SECRET) notFound()

  const rows = await prisma.property.findMany({
    where: { videoAnalysis: { isNot: null }, videoUrl: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      location: true,
      arrondissement: true,
      surface: true,
      price: true,
      rooms: true,
      videoUrl: true,
      videoAnalysis: { select: { chapitres: true } },
    },
  })

  const videos: VideoEntry[] = rows
    .filter((p): p is typeof p & { videoUrl: string } => Boolean(p.videoUrl))
    .map((p) => ({
      propertyId: p.id,
      videoId: extractCloudinaryId(p.videoUrl),
      videoUrl: p.videoUrl,
      title: p.title,
      location: p.location || p.arrondissement,
      surface: p.surface,
      price: p.price,
      rooms: p.rooms,
      chapters: parseChapters(p.videoAnalysis?.chapitres),
    }))

  return <VideoTaggerClient videos={videos} />
}
