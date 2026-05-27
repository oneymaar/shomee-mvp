import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params
  try {
    const properties = await prisma.property.findMany({
      where: { createdByAgentId: agentId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        arrondissement: true,
        price: true,
        surface: true,
        statut: true,
        completionRate: true,
        badges: true,
        mandatType: true,
        avantPremiere: true,
        videoUrl: true,
        imageUrlFallback: true,
        updatedAt: true,
      },
    })
    return NextResponse.json(properties)
  } catch (error) {
    console.error(`[GET /api/agent/${agentId}/properties]`, error)
    return NextResponse.json({ error: 'Failed to fetch agent properties' }, { status: 500 })
  }
}
