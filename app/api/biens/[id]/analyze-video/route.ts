import { NextResponse } from 'next/server'
import { TagSource, VideoAnalysisStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateBearer } from '@/lib/auth/bearer'
import { analyzeVideo } from '@/lib/services/videoAnalysisService'
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

  const { tags, chapters } = await analyzeVideo(property.videoUrl, property.id)

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
