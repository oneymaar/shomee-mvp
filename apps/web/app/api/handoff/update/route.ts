/**
 * POST /api/handoff/update — S9 H2 (récap web éditable)
 *
 * Persiste les ajustements faits sur la landing /onboarding?h=<token> AVANT
 * le claim : le brief stocké est remplacé par la version éditée, si bien que
 * l'app (claim) récupère exactement ce que l'utilisateur a validé.
 *
 * - La possession du token EST la capacité (même modèle que peek/landing) ;
 *   garde x-shomee-app-token OU origine web de confiance.
 * - Refusé si le handoff n'est plus `pending` (409 claimed / 410 expiré) —
 *   après claim, la vérité vit dans BuyerProfile, plus dans le Handoff.
 * - `transcriptSummary` (contexte LLM) est conservé ; `parsed[]` est ABANDONNÉ
 *   (les ParsedCriterion du LLM ne reflètent plus un brief édité à la main —
 *   le parser déterministe serveur reprend la main au claim).
 */

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAppTokenOrTrustedOrigin } from '@/lib/auth/appToken'
import { readJsonObject, getString, jsonError } from '@/lib/http'
import { AIOnboardingBriefSchema, zodErrorMessage } from '@/lib/handoff/briefSchema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const guard = requireAppTokenOrTrustedOrigin(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await readJsonObject(req)
  const token = getString(body, 'token')
  if (!token) return jsonError('Fournissez "token".', 400)

  const parsed = AIOnboardingBriefSchema.safeParse(body.brief)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: zodErrorMessage(parsed.error) },
      { status: 400 },
    )
  }

  const handoff = await prisma.handoff.findUnique({ where: { token } })
  if (!handoff) return jsonError('Lien introuvable.', 404)
  if (handoff.expiresAt.getTime() < Date.now()) {
    return jsonError('Ce lien a expiré.', 410)
  }
  if (handoff.status !== 'pending') {
    return jsonError('Ce brief a déjà été récupéré dans l’app — modifiez-le directement là-bas.', 409)
  }

  // transcriptSummary conservé, parsed[] volontairement abandonné (stale).
  const prev = (handoff.brief ?? {}) as Record<string, unknown>
  const nextBrief = {
    ...parsed.data,
    ...(typeof prev.transcriptSummary === 'string' && prev.transcriptSummary
      ? { transcriptSummary: prev.transcriptSummary }
      : {}),
  } as unknown as Prisma.InputJsonValue

  await prisma.handoff.update({
    where: { id: handoff.id },
    data: { brief: nextBrief },
  })

  return NextResponse.json({ success: true })
}
