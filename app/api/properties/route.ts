import { NextRequest, NextResponse } from 'next/server'
import { PropertyStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toViewProperty } from '@/lib/serializers/property'
import { matchProperty } from '@/lib/matching/engine'
import { toBuyerBrief } from '@/lib/matching/buyerBriefBuilder'
import { toPropertyProfile } from '@/lib/matching/propertyProfileBuilder'

export const dynamic = 'force-dynamic'

/**
 * GET /api/properties[?buyerProfileId=…]
 *
 * - No buyerProfileId: chronological feed (newest first), unchanged.
 * - With buyerProfileId: load the BuyerProfile, score every PUBLISHED
 *   property via the matching engine, drop exclusions, and return the
 *   survivors sorted by score (descending). Each row carries `matchScore`
 *   (0..1) and `isExcluded` so the feed can decorate cards without
 *   re-running the pipeline client-side.
 */
export async function GET(req: NextRequest) {
  try {
    const buyerProfileId = req.nextUrl.searchParams.get('buyerProfileId')

    const properties = await prisma.property.findMany({
      where: { statut: PropertyStatus.PUBLISHED },
      orderBy: { createdAt: 'desc' },
    })

    if (!buyerProfileId) {
      return NextResponse.json(properties.map(toViewProperty))
    }

    const profile = await prisma.buyerProfile.findUnique({ where: { id: buyerProfileId } })
    if (!profile) {
      // Profil inconnu → on retombe sur le flux chronologique sans casser
      // l'UI ; le badge restera absent côté client.
      console.warn(`[GET /api/properties] buyerProfile ${buyerProfileId} introuvable`)
      return NextResponse.json(properties.map(toViewProperty))
    }

    const brief = toBuyerBrief(profile)
    const scored = properties
      .map((p) => ({
        property: p,
        result: matchProperty(toPropertyProfile(p), brief),
      }))
      .filter(({ result }) => !result.is_excluded)
      .sort((a, b) => b.result.global_score - a.result.global_score)
      .map(({ property, result }) => ({
        ...toViewProperty(property),
        matchScore: result.global_score / 100,
        isExcluded: result.is_excluded,
      }))

    return NextResponse.json(scored)
  } catch (error) {
    console.error('[GET /api/properties]', error)
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 })
  }
}
