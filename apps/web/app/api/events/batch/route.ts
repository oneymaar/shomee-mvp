import { NextRequest, NextResponse } from 'next/server'
import { requireAppTokenOrTrustedOrigin } from '@/lib/auth/appToken'
import { checkRateLimit } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/events/batch — ingestion des événements comportementaux (P5).
 *
 * Corps : { deviceId: string, events: [{ type, propertyId?, valueMs?,
 * lane?, servedScore?, criteriaHash?, meta?, ts? }] } — max 100 par appel.
 *
 * Append-only, anonyme (deviceId uuid généré côté app — le rattachement
 * User viendra avec S8). Ces événements nourrissent les affinités (P7),
 * les intercalaires (P6) et la détection de recherche affamée. AUCUNE
 * modification de critères n'en découle jamais directement (invariant).
 */

const ALLOWED_TYPES = new Set([
  'session_start',
  'video_start',
  'dwell',
  'skip',
  'skip_fast',
  'detail_open',
  'detail_dwell',
  'fav',
  'unfav',
  'share',
  'contact',
  'map_open',
  'probe_answer',
  'interstitial_shown',
  'interstitial_accepted',
  'interstitial_dismissed',
])

interface IncomingEvent {
  type?: unknown
  propertyId?: unknown
  valueMs?: unknown
  lane?: unknown
  servedScore?: unknown
  criteriaHash?: unknown
  meta?: unknown
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
  const b = body as { deviceId?: unknown; events?: unknown }
  if (typeof b?.deviceId !== 'string' || b.deviceId.length < 8 || b.deviceId.length > 64) {
    return NextResponse.json({ error: 'deviceId_required' }, { status: 400 })
  }
  if (!Array.isArray(b.events) || b.events.length === 0) {
    return NextResponse.json({ error: 'events_required' }, { status: 400 })
  }
  if (b.events.length > 100) {
    return NextResponse.json({ error: 'too_many_events' }, { status: 400 })
  }

  const deviceId = b.deviceId
  const rows = (b.events as IncomingEvent[])
    .filter((e) => e && typeof e.type === 'string' && ALLOWED_TYPES.has(e.type))
    .map((e) => ({
      deviceId,
      type: e.type as string,
      propertyId: typeof e.propertyId === 'string' ? e.propertyId : null,
      valueMs:
        typeof e.valueMs === 'number' && Number.isFinite(e.valueMs)
          ? Math.max(0, Math.min(3_600_000, Math.round(e.valueMs)))
          : null,
      lane: e.lane === 'main' || e.lane === 'discovery' ? e.lane : null,
      servedScore:
        typeof e.servedScore === 'number' && Number.isFinite(e.servedScore)
          ? Math.max(0, Math.min(100, Math.round(e.servedScore)))
          : null,
      criteriaHash: typeof e.criteriaHash === 'string' ? e.criteriaHash.slice(0, 64) : null,
      meta:
        e.meta && typeof e.meta === 'object' && !Array.isArray(e.meta)
          ? (e.meta as object)
          : undefined,
    }))

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 })
  }

  try {
    const result = await prisma.interactionEvent.createMany({ data: rows })
    return NextResponse.json({ inserted: result.count })
  } catch (error) {
    console.error('[POST /api/events/batch]', error)
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }
}
