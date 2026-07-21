import { NextRequest, NextResponse } from 'next/server'
import { requireAppTokenOrTrustedOrigin } from '@/lib/auth/appToken'
import { PropertyStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toViewProperty } from '@/lib/serializers/property'
import { matchProperty } from '@shomee/core/matching/engine'
import { calibrateScore } from '@shomee/core/matching/calibration'
import type { MatchResult } from '@shomee/core/matching/types'
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
  // GET nu (fetch('/api/properties')) : le navigateur n'envoie pas toujours
  // Origin sur un GET same-origin → fallback Referer autorisé ici uniquement.
  const guard = requireAppTokenOrTrustedOrigin(req, { allowReferer: true })
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  try {
    const buyerProfileId = req.nextUrl.searchParams.get('buyerProfileId')

    const properties = await prisma.property.findMany({
      where: { statut: PropertyStatus.PUBLISHED },
      orderBy: { createdAt: 'desc' },
      include: PROPERTY_INCLUDE,
    })

    if (!buyerProfileId) {
      return NextResponse.json(
        dedupeByVideoUrl(shuffle(properties), (p) => p.videoUrl).map((p) =>
          projectPropertyExtras(p, toViewProperty(p)),
        ),
      )
    }

    const profile = await prisma.buyerProfile.findUnique({ where: { id: buyerProfileId } })
    if (!profile) {
      // Profil inconnu → on retombe sur le flux chronologique sans casser
      // l'UI ; le badge restera absent côté client.
      console.warn(`[GET /api/properties] buyerProfile ${buyerProfileId} introuvable`)
      return NextResponse.json(
        dedupeByVideoUrl(shuffle(properties), (p) => p.videoUrl).map((p) =>
          projectPropertyExtras(p, toViewProperty(p)),
        ),
      )
    }

    return NextResponse.json(scoreAndProject(properties, toBuyerBrief(profile), null).main)
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
  const guard = requireAppTokenOrTrustedOrigin(req, { allowReferer: true })
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
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
        // Hard geo gate arr/commune (héritage). Le raffinement IRIS exact se
        // fait juste en dessous, en mémoire, sur la colonne irisId peuplée
        // par le backfill — un bien SANS irisId (pas encore backfillé) reste
        // servi au grain arrondissement (dégradation douce, jamais un trou).
        ...(zoneNames.length > 0 ? { arrondissement: { in: zoneNames } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: PROPERTY_INCLUDE,
    })

    // ── Gate IRIS exact (quand la sélection est infra-arrondissement) ──
    const irisIds = Array.isArray(snapshot.irisIds)
      ? snapshot.irisIds.filter((x): x is string => typeof x === 'string')
      : []
    const irisSet = new Set(irisIds)
    const gated =
      irisSet.size > 0
        ? properties.filter((p) => {
            const pid = (p as unknown as { irisId?: string | null }).irisId
            return !pid || irisSet.has(pid)
          })
        : properties

    const lanes = scoreAndProject(gated, brief, snapshot)
    const withLanes = (body as { withLanes?: unknown }).withLanes === true
    return NextResponse.json(withLanes ? lanes : lanes.main)
  } catch (error) {
    console.error('[POST /api/properties]', error)
    return NextResponse.json({ error: 'Failed to score properties' }, { status: 500 })
  }
}

/**
 * Mélange Fisher-Yates (copie, non muté). Utilisé pour le flux « découverte »
 * sans critères : à chaque appel (la route est `force-dynamic`, sans cache),
 * l'ordre est ré-aléatoire → chaque relance de l'app propose un ordre différent.
 * Appliqué AVANT la déduplication : le bien représentant d'une vidéo partagée
 * varie aussi d'une fois sur l'autre. Le flux scoré (brief) n'est PAS mélangé —
 * il reste trié par pertinence décroissante.
 */
function shuffle<T>(items: T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Déduplication par vidéo : au plus un bien par `videoUrl` dans un même jeu de
 * résultats. Plusieurs biens (démo ou seed synthétique) partagent la même vidéo
 * source — on ne veut jamais tomber deux fois sur la même vidéo dans une même
 * recherche. L'ordre d'entrée décide du gagnant (déjà trié par score, ou
 * mélangé). Les biens sans vidéo (`videoUrl` null) sont toujours conservés.
 */
function dedupeByVideoUrl<T>(items: T[], getUrl: (x: T) => string | null): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    const url = getUrl(it)
    if (url) {
      if (seen.has(url)) continue
      seen.add(url)
    }
    out.push(it)
  }
  return out
}

/**
 * Shared scoring + projection pipeline. Excluded properties are dropped;
 * survivors are sorted by descending global score, deduped by video, and
 * decorated with the agency/chapters/matchScore overlay needed by the feed.
 */
/** Détail de match transporté au client (modale du badge + fiche ✓/✗). */
function buildMatchDetail(result: MatchResult, display: number) {
  const pick = (status: 'matched' | 'unmatched' | 'unknown') =>
    result.criteria_scores
      .filter((c) => c.status === status)
      .slice(0, 12)
      .map((c) => ({ label: c.display_label, importance: c.importance }))
  return {
    score100: display,
    raw: result.global_score,
    matched: pick('matched'),
    unmatched: pick('unmatched'),
    doubts: pick('unknown'),
  }
}

interface ScoredLanes {
  main: ViewProperty[]
  discovery: Array<ViewProperty & { discoveryDelta: string }>
}

/**
 * Pipeline scoring + projection, VERSION ÉTAGE 1 + LANES (architecture
 * validée) :
 *  - exclus (rédhibitoire contredit) : jamais servis ;
 *  - ÉTAGE 1 : un échec sur critère OBLIGATOIRE sort le bien du feed
 *    principal (fini la simple pénalité de score) ;
 *  - VOIE DÉCOUVERTE (D4) : biens à UNE relaxation près — budget ≤ +7 %,
 *    surface ≥ −5 %, pièces −1, ou UN seul autre obligatoire manqué —
 *    servis à part avec leur delta affiché, TOUJOURS annoncés (invariant :
 *    jamais d'infiltration muette du feed principal) ;
 *  - score AFFICHÉ calibré (D5 : plancher 60, 90+ réservé) ;
 *  - matchDetail transporté pour la modale (matchés / non-matchés / doutes).
 */
function scoreAndProject(
  properties: PrismaPropertyWithRels[],
  brief: UserCriteriaBrief,
  snapshot: BriefSnapshot | null,
): ScoredLanes {
  const scored = properties
    .map((p) => ({
      property: p,
      result: matchProperty(toPropertyProfile(p), brief),
    }))
    .filter(({ result }) => !result.is_excluded)

  const main: Array<{ property: PrismaPropertyWithRels; result: MatchResult }> = []
  const discovery: Array<{ property: PrismaPropertyWithRels; result: MatchResult; delta: string }> = []

  for (const entry of scored) {
    if (entry.result.mandatory_failures.length === 0) {
      main.push(entry)
      continue
    }
    const delta = discoveryDelta(entry.property, entry.result, snapshot)
    if (delta) discovery.push({ ...entry, delta })
    // Sinon : trop loin des critères — ni feed principal, ni découverte.
  }

  const bySc = (a: { result: MatchResult }, b: { result: MatchResult }) =>
    b.result.global_score - a.result.global_score

  const project = (property: PrismaPropertyWithRels, result: MatchResult): ViewProperty => {
    const cal = calibrateScore(result)
    const view = toViewProperty(property)
    const enriched = projectPropertyExtras(property, view)
    return {
      ...enriched,
      matchScore: cal.display / 100,
      isExcluded: result.is_excluded,
      matchDetail: buildMatchDetail(result, cal.display),
    } as ViewProperty
  }

  return {
    main: dedupeByVideoUrl(main.sort(bySc), ({ property }) => property.videoUrl)
      .map(({ property, result }) => project(property, result)),
    discovery: dedupeByVideoUrl(discovery.sort(bySc), ({ property }) => property.videoUrl)
      .map(({ property, result, delta }) => ({ ...project(property, result), discoveryDelta: delta })),
  }
}

/**
 * Un bien avec obligatoires manqués entre en VOIE DÉCOUVERTE si l'écart
 * tient dans UNE relaxation D4. Retourne le libellé du delta, ou null.
 */
function discoveryDelta(
  p: PrismaPropertyWithRels,
  result: MatchResult,
  snapshot: BriefSnapshot | null,
): string | null {
  if (!snapshot) return null
  if (result.mandatory_failures.length > 1) return null

  const budgetMax = typeof snapshot.budgetMax === 'number' ? snapshot.budgetMax : null
  const minSurface = typeof snapshot.minSurface === 'number' ? snapshot.minSurface : null
  const minRooms = typeof snapshot.minRooms === 'number' ? snapshot.minRooms : null

  // Budget : jusqu'à +7 % au-dessus du max.
  if (budgetMax && budgetMax > 0 && budgetMax < 5_000_001 && p.price > budgetMax) {
    if (p.price <= budgetMax * 1.07) {
      const pct = Math.round(((p.price - budgetMax) / budgetMax) * 100)
      return `Budget +${Math.max(1, pct)} %`
    }
    return null
  }
  // Surface : jusqu'à −5 % sous le minimum.
  if (minSurface && minSurface > 0 && p.surface < minSurface) {
    if (p.surface >= minSurface * 0.95) {
      return `Surface −${Math.max(1, Math.round(minSurface - p.surface))} m²`
    }
    return null
  }
  // Pièces : une de moins, pas plus.
  if (minRooms && minRooms > 0 && p.rooms < minRooms) {
    if (p.rooms === minRooms - 1) return '1 pièce en moins'
    return null
  }
  // Autre obligatoire (chip) manqué — un seul, on affiche son libellé.
  return `Hors critère : ${result.mandatory_failures[0]}`
}
