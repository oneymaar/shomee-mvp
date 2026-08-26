import { NextRequest, NextResponse } from 'next/server'
import { requireAppTokenOrTrustedOrigin } from '@/lib/auth/appToken'
import { checkRateLimit } from '@/lib/rateLimit'
import { PropertyStatus, type Prisma } from '@prisma/client'
import { variantesArrondissement } from '@/lib/geo/zoneKey'
import { prisma } from '@/lib/prisma'
import { estimateRarity } from '@shomee/core/matching/estimator'
import type { BriefSnapshot } from '@/lib/matching/buyerBriefBuilder'

export const dynamic = 'force-dynamic'

/**
 * POST /api/feed/estimate — jauge de rareté du récap d'onboarding.
 *
 * « Avec vos critères, comptez ~N biens par semaine. » VRAI comptage
 * Prisma sur les filtres durs (zones arr/commune, budget, surface,
 * pièces, chambres) + fenêtre 28 j ; l'estimateur core décide si la
 * fenêtre est représentative (sinon : rotation de stock estimée).
 *
 * Réponse : { perWeekMin, perWeekMax, band, message, matchingCount }.
 */

// arr-N → toutes les orthographes possibles de Property.arrondissement.
// Ce filtre s'exécute en SQL et ne peut donc pas normaliser : il élargit la
// liste plutôt que de parier sur une graphie. Il comparait « Paris 11ème » à
// des lignes écrites « PARIS 11e » — donc zéro résultat, silencieusement.
function arrIdToNames(id: string): string[] {
  const m = id.match(/^arr-(\d{1,2})$/)
  if (!m) return []
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 1 || n > 20) return []
  return variantesArrondissement(n)
}

const COMMUNE_ID_TO_NAME: Record<string, string> = {
  'com-92012': 'Boulogne-Billancourt',
  'com-92040': 'Issy-les-Moulineaux',
  'com-92044': 'Levallois-Perret',
  'com-92051': 'Neuilly-sur-Seine',
  'com-92064': 'Saint-Cloud',
  'com-92072': 'Sèvres',
  'com-94081': 'Vincennes',
}

function zoneNames(snapshot: BriefSnapshot): string[] {
  const out: string[] = []
  for (const id of snapshot.arrondissementIds ?? []) {
    out.push(...arrIdToNames(id))
  }
  for (const id of snapshot.communeIds ?? []) {
    const n = COMMUNE_ID_TO_NAME[id]
    if (n) out.push(n)
  }
  return out
}

export async function POST(req: NextRequest) {
  const guard = requireAppTokenOrTrustedOrigin(req, { allowReferer: true })
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const rl = checkRateLimit(req)
  if (!rl.ok) return NextResponse.json(rl.body, { status: rl.status, headers: rl.headers })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const snapshot = body as BriefSnapshot

  try {
    const zones = zoneNames(snapshot)
    const since = new Date(Date.now() - 28 * 24 * 3600 * 1000)

    const hard: Prisma.PropertyWhereInput = {
      statut: PropertyStatus.PUBLISHED,
      ...(zones.length > 0 ? { arrondissement: { in: zones } } : {}),
      ...(typeof snapshot.budgetMax === 'number' && snapshot.budgetMax > 0 && snapshot.budgetMax < 5_000_001
        ? { price: { lte: snapshot.budgetMax, ...(typeof snapshot.budgetMin === 'number' && snapshot.budgetMin > 0 ? { gte: snapshot.budgetMin } : {}) } }
        : typeof snapshot.budgetMin === 'number' && snapshot.budgetMin > 0
          ? { price: { gte: snapshot.budgetMin } }
          : {}),
      ...(typeof snapshot.minSurface === 'number' && snapshot.minSurface > 0
        ? { surface: { gte: snapshot.minSurface } }
        : {}),
      ...(typeof snapshot.minRooms === 'number' && snapshot.minRooms > 0
        ? { rooms: { gte: snapshot.minRooms } }
        : {}),
      ...(typeof snapshot.minBedrooms === 'number' && snapshot.minBedrooms > 0
        ? { bedrooms: { gte: snapshot.minBedrooms } }
        : {}),
    }

    const [matchingCount, matchingLast28d, poolCount, poolLast28d] = await Promise.all([
      prisma.property.count({ where: hard }),
      prisma.property.count({ where: { ...hard, createdAt: { gte: since } } }),
      prisma.property.count({ where: { statut: PropertyStatus.PUBLISHED } }),
      prisma.property.count({ where: { statut: PropertyStatus.PUBLISHED, createdAt: { gte: since } } }),
    ])

    const estimate = estimateRarity({ matchingCount, matchingLast28d, poolCount, poolLast28d })

    return NextResponse.json({ ...estimate, matchingCount })
  } catch (error) {
    console.error('[POST /api/feed/estimate]', error)
    return NextResponse.json({ error: 'estimate_failed' }, { status: 500 })
  }
}
