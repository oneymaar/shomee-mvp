import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateBearer } from '@/lib/auth/bearer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const properties = await prisma.property.findMany({
    where: { createdByAgentId: auth.agent.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      arrondissement: true,
      location: true,
      surface: true,
      rooms: true,
      price: true,
      statut: true,
      completionRate: true,
      videoUrl: true,
      mandatType: true,
      avantPremiere: true,
      refInterneAgence: true,
      updatedAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json({
    agent: { id: auth.agent.id, name: auth.agent.name, agencyName: auth.agent.agency.name },
    count: properties.length,
    properties,
  })
}
