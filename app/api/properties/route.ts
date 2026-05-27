import { NextResponse } from 'next/server'
import { PropertyStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toViewProperty } from '@/lib/serializers/property'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const properties = await prisma.property.findMany({
      where: { statut: PropertyStatus.PUBLISHED },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(properties.map(toViewProperty))
  } catch (error) {
    console.error('[GET /api/properties]', error)
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 })
  }
}
