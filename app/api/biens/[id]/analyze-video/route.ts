import { NextResponse } from 'next/server'
import { TagSource, VideoAnalysisStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateBearer } from '@/lib/auth/bearer'
import {
  analyzeVideo,
  getVideoDuration,
  VIDEO_MAX_DURATION_SEC,
  type PropertyContext,
} from '@/lib/services/videoAnalysisService'
import { computeCompletionRate } from '@/lib/completion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const { id } = await params

  const property = await prisma.property.findUnique({ where: { id } })
  if (!property) {
    return NextResponse.json({ error: 'Bien introuvable' }, { status: 404 })
  }
  if (property.agencyId !== auth.agent.agencyId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  if (!property.videoUrl) {
    return NextResponse.json({ error: 'Aucune vidéo à analyser' }, { status: 400 })
  }

  // Optional duration guard — refuse videos longer than 80s. If Cloudinary
  // doesn't return a duration we let the request through and analyzeVideo
  // will cap frames internally.
  const durationSec = await getVideoDuration(property.videoUrl)
  if (durationSec !== null && durationSec > VIDEO_MAX_DURATION_SEC) {
    return NextResponse.json(
      { error: `Vidéo trop longue (${Math.round(durationSec)}s) — maximum ${VIDEO_MAX_DURATION_SEC} secondes` },
      { status: 400 },
    )
  }

  const context: PropertyContext = {
    rooms: property.rooms ?? undefined,
    bedrooms: property.bedrooms ?? undefined,
    composition: (property.composition as Array<{ label: string; surface: number }> | null) ?? undefined,
    description: property.description ?? undefined,
  }

  const { tags, chapters, error: analysisError } = await analyzeVideo(
    property.videoUrl,
    property.id,
    context,
  )

  if (analysisError) {
    return NextResponse.json(
      { error: 'Analyse indisponible, réessayez dans quelques instants.' },
      { status: 503 },
    )
  }

  await prisma.$transaction(async (tx) => {
    if (tags.length > 0) {
      await tx.propertyTag.deleteMany({
        where: { propertyId: property.id, source: TagSource.AI_VIDEO },
      })
      await tx.propertyTag.createMany({
        data: tags.map((t) => ({
          propertyId: property.id,
          label: t.label,
          category: t.category,
          source: TagSource.AI_VIDEO,
          validated: false,
          confidence: t.confidence,
        })),
      })
    }

    await tx.videoAnalysis.upsert({
      where: { propertyId: property.id },
      create: {
        propertyId: property.id,
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
    const mergedTags = Array.from(new Set([...(property.tags ?? []), ...aiLabels]))
    await tx.property.update({
      where: { id: property.id },
      data: { tags: mergedTags },
    })
  })

  const refreshed = await prisma.property.findUnique({ where: { id: property.id } })
  const completion_rate = refreshed ? computeCompletionRate(refreshed) : property.completionRate
  if (refreshed && completion_rate !== refreshed.completionRate) {
    await prisma.property.update({
      where: { id: property.id },
      data: { completionRate: completion_rate },
    })
  }

  return NextResponse.json({ tags, chapters, completion_rate })
}
