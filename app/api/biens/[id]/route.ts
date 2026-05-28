import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateBearer } from '@/lib/auth/bearer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const { id } = await params

  const property = await prisma.property.findUnique({
    where: { id },
    include: {
      propertyTags: { orderBy: { createdAt: 'asc' } },
      videoAnalysis: true,
      documents: true,
    },
  })

  if (!property) {
    return NextResponse.json({ error: 'Bien introuvable' }, { status: 404 })
  }

  // Only allow agents of the same agency to read
  if (property.agencyId !== auth.agent.agencyId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  return NextResponse.json(property)
}
