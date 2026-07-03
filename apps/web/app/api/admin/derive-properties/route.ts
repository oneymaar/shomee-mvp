/**
 * POST /api/admin/derive-properties   (header `x-admin-secret: <ADMIN_SECRET>`)
 *
 * Jalon 2 — proposition. À partir du profil d'UNE vidéo (caption + champs
 * extraits par le Jalon 1), génère N biens démo dérivés, variés en zone/budget
 * mais cohérents en standing. NE CRÉE AUCUN bien en base — pure proposition.
 *
 * Body : { caption: string, extracted: ExtractedInfo, count?: number }
 * 200  : { properties: GeneratedProperty[], count: number }
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { checkAdminSecret } from '@/lib/auth/adminSecret'
import { deriveProperties, suggestCount, clampCount } from '@/lib/services/propertyDerivation'
import type { ExtractedInfo } from '@/lib/admin/tiktokStudioTypes'
import { ALL_ZONES } from '@/lib/admin/tiktokStudioTypes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

function isExtractedInfo(x: unknown): x is ExtractedInfo {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.title === 'string' && typeof o.arrondissement === 'string'
}

export async function POST(req: NextRequest) {
  if (!checkAdminSecret(req)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const b = body as {
    caption?: unknown
    extracted?: unknown
    count?: unknown
    zones?: unknown
  }
  const caption = typeof b.caption === 'string' ? b.caption : ''
  if (!isExtractedInfo(b.extracted)) {
    return NextResponse.json({ error: 'extracted_required' }, { status: 400 })
  }
  // Ne retenir que des zones connues (anti-injection de libellés arbitraires).
  const zones = Array.isArray(b.zones)
    ? b.zones.filter((z): z is string => typeof z === 'string' && ALL_ZONES.includes(z))
    : []
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 })
  }

  const count =
    typeof b.count === 'number'
      ? clampCount(b.count)
      : suggestCount(caption, b.extracted)

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const properties = await deriveProperties(anthropic, {
      caption,
      extracted: b.extracted,
      count,
      zones,
    })
    if (properties.length === 0) {
      return NextResponse.json(
        { error: 'no_properties', message: 'Le LLM n\'a produit aucun bien exploitable — réessaie.' },
        { status: 502 },
      )
    }
    return NextResponse.json({ properties, count: properties.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'derivation_failed', message }, { status: 502 })
  }
}
