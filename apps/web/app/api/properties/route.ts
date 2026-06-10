import { NextRequest, NextResponse } from 'next/server'
import { PropertyStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toViewProperty } from '@/lib/serializers/property'
import { matchProperty } from '@shomee/core/matching/engine'
import {
  toBuyerBrief,
  buildBriefFromSnapshot,
  type BriefSnapshot,
} from '@/lib/matching/buyerBriefBuilder'
import { toPropertyProfile } from '@/lib/matching/propertyProfileBuilder'
import type { Property as ViewProperty } from '@/lib/types'
import type { UserCriteriaBrief } from '@shomee/core/criteria/types'

export const dynamic = 'force-dynamic'

/** Same shape Prisma + the agency + the videoAnalysis chapters embed. */
const PROPERTY_INCLUDE = {
  agency: { select: { name: true, logo: true } },
  videoAnalysis: { select: { chapitres: true } },
} as const

type RawChapter = { label: string; startSec?: number; fraction?: number }

/**
 * arr-N → Property.arrondissement string. The DB seed + scraper use the
 * "Paris Xème" pattern with "1er" as the only exception.
 */
function arrIdToName(id: string): string | null {
  const m = id.match(/^arr-(\d{1,2})$/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 1 || n > 20) return null
  return n === 1 ? 'Paris 1er' : `Paris ${n}ème`
}

/**
 * com-{INSEE} → Property.arrondissement string. Only the suburbs that
 * actually appear in our seeded data are mapped — the goal is to filter,
 * not to cover the full Île-de-France gazetteer. Unknown codes return
 * null and are silently dropped from the filter.
 */
const COMMUNE_ID_TO_NAME: Record<string, string> = {
  'com-92012': 'Boulogne-Billancourt',
  'com-92040': 'Issy-les-Moulineaux',
  'com-92044': 'Levallois-Perret',
  'com-92051': 'Neuilly-sur-Seine',
  'com-92064': 'Saint-Cloud',
  'com-92072': 'Sèvres',
  'com-94081': 'Vincennes',
}

function buildZoneNameFilter(body: BriefSnapshot): string[] {
  const out: string[] = []
  for (const id of body.arrondissementIds ?? []) {
    const name = arrIdToName(id)
    if (name) out.push(name)
  }
  for (const id of body.communeIds ?? []) {
    const name = COMMUNE_ID_TO_NAME[id]
    if (name) out.push(name)
  }
  return out
}

type PrismaPropertyWithRels = Awaited<
  ReturnType<typeof prisma.property.findMany<{ include: typeof PROPERTY_INCLUDE }>>
>[number]

/**
 * Project agency identity + chapters into the view-model. We only ever
 * surface *real* chapters issued by the IA analysis (VideoAnalysis.chapitres).
 * Synthetic listings have no VideoAnalysis row → chapters stay null, and the
 * feed renders a plain progress bar instead of fabricated segments.
 */
function projectPropertyExtras(
  p: PrismaPropertyWithRels,
  view: ViewProperty,
): ViewProperty {
  const va = p.videoAnalysis?.chapitres
  const chapters =
    Array.isArray(va) && va.length > 0 ? (va as unknown as RawChapter[]) : null

  return {
    ...view,
    agencyName: p.agency?.name ?? undefined,
    agencyLogo: p.agency?.logo ?? null,
    chapters: chapters as ViewProperty['chapters'],
  }
}

/**
 * GET /api/properties[?buyerProfileId=…]
 *
 * - No buyerProfileId: chronological feed (newest first), unchanged.
 * - With buyerProfileId: load the BuyerProfile, score every PUBLISHED
 *   property via the matching engine, drop exclusions, and return the
 *   survivors sorted by score (descending). Each row carries `matchScore`
 *   (0..1) and `isExcluded` so the feed can decorate cards without
 *   re-running the pipeline client-side.
 *
 * Both modes embed the agency identity (name + logo) and the video
 * chapters when available, so the feed always has enough to render the
 * agency badge and the segmented timeline without a follow-up fetch.
 */
export async function GET(req: NextRequest) {
  try {
    const buyerProfileId = req.nextUrl.searchParams.get('buyerProfileId')

    const properties = await prisma.property.findMany({
      where: { statut: PropertyStatus.PUBLISHED },
      orderBy: { createdAt: 'desc' },
      include: PROPERTY_INCLUDE,
    })

    if (!buyerProfileId) {
      return NextResponse.json(
        properties.map((p) => projectPropertyExtras(p, toViewProperty(p))),
      )
    }

    const profile = await prisma.buyerProfile.findUnique({ where: { id: buyerProfileId } })
    if (!profile) {
      // Profil inconnu → on retombe sur le flux chronologique sans casser
      // l'UI ; le badge restera absent côté client.
      console.warn(`[GET /api/properties] buyerProfile ${buyerProfileId} introuvable`)
      return NextResponse.json(
        properties.map((p) => projectPropertyExtras(p, toViewProperty(p))),
      )
    }

    return NextResponse.json(scoreAndProject(properties, toBuyerBrief(profile)))
  } catch (error) {
    console.error('[GET /api/properties]', error)
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 })
  }
}

/**
 * POST /api/properties
 *
 * Snapshot-driven scoring. The browser sends the relevant subset of its
 * Zustand store (surface/budget/rooms/chipStates/customCriteria) and the
 * server composes the brief on the fly, with zero persistence and no
 * `BuyerProfile` row required. Used by the onboarding → feed handoff
 * when the user has expressed enough preferences to make scoring useful.
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  try {
    const snapshot = body as BriefSnapshot
    const brief = buildBriefFromSnapshot(snapshot)
    const zoneNames = buildZoneNameFilter(snapshot)
    console.log(
      '[POST /api/properties] brief=' + brief.parsed_criteria.length + ' criteria' +
      (zoneNames.length > 0 ? ' | zones=' + zoneNames.join(',') : ' | zones=ALL') +
      ' | ' +
      brief.parsed_criteria
        .map((c) => c.importance[0] + ':' + c.display_label)
        .join(' | '),
    )
    const properties = await prisma.property.findMany({
      where: {
        statut: PropertyStatus.PUBLISHED,
        // Hard geo gate — IRIS / quartier precision isn't carried on
        // Property yet, so the filter operates at arr/commune granularity.
        // Empty zoneNames means "no location filter" (rare — only when the
        // user didn't pick any zone).
        ...(zoneNames.length > 0 ? { arrondissement: { in: zoneNames } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: PROPERTY_INCLUDE,
    })
    return NextResponse.json(scoreAndProject(properties, brief))
  } catch (error) {
    console.error('[POST /api/properties]', error)
    return NextResponse.json({ error: 'Failed to score properties' }, { status: 500 })
  }
}

/**
 * Shared scoring + projection pipeline. Excluded properties are dropped;
 * survivors are sorted by descending global score and decorated with the
 * agency/chapters/matchScore overlay needed by the feed.
 */
function scoreAndProject(
  properties: PrismaPropertyWithRels[],
  brief: UserCriteriaBrief,
): ViewProperty[] {
  return properties
    .map((p) => ({
      property: p,
      result: matchProperty(toPropertyProfile(p), brief),
    }))
    .filter(({ result }) => !result.is_excluded)
    .sort((a, b) => b.result.global_score - a.result.global_score)
    .map(({ property, result }) => {
      const view = toViewProperty(property)
      const enriched = projectPropertyExtras(property, view)
      return {
        ...enriched,
        matchScore: result.global_score / 100,
        isExcluded: result.is_excluded,
      }
    })
}
