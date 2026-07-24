/**
 * GET /api/handoff/peek?token=<uuid> | ?code=<court> — S9
 *
 * Lecture SEULE d'un handoff (aucune écriture, ne « consomme » rien) :
 * alimente la page récap /h/<token> côté client, le composant App ChatGPT
 * (H4) et l'écran « J'ai un code » du natif (prévisualisation avant claim).
 *
 * Garde : x-shomee-app-token OU origine web de confiance (même politique que
 * feed/estimate — la landing fetch depuis la même origine).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAppTokenOrTrustedOrigin } from '@/lib/auth/appToken'
import { jsonError } from '@/lib/http'
import { normalizeShortCode, isPlausibleShortCode, formatShortCode } from '@/lib/handoff/shortCode'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = requireAppTokenOrTrustedOrigin(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const token = req.nextUrl.searchParams.get('token')
  const rawCode = req.nextUrl.searchParams.get('code')

  let handoff = null
  if (token) {
    handoff = await prisma.handoff.findUnique({ where: { token } })
  } else if (rawCode) {
    const canonical = normalizeShortCode(rawCode)
    if (!isPlausibleShortCode(canonical)) {
      return jsonError('Code invalide — vérifiez la saisie.', 400)
    }
    handoff = await prisma.handoff.findUnique({ where: { shortCode: canonical } })
  } else {
    return jsonError('Fournissez "token" ou "code".', 400)
  }

  if (!handoff) return jsonError('Lien ou code introuvable.', 404)

  const expired = handoff.expiresAt.getTime() < Date.now()
  if (expired) {
    return NextResponse.json(
      { success: false, status: 'expired', error: 'Ce lien a expiré.' },
      { status: 410 },
    )
  }

  return NextResponse.json({
    success: true,
    status: handoff.status, // pending | claimed
    kind: handoff.kind,
    source: handoff.source,
    shortCode: formatShortCode(handoff.shortCode),
    expiresAt: handoff.expiresAt.toISOString(),
    brief: handoff.brief,
  })
}
