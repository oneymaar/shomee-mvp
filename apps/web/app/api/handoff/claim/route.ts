/**
 * POST /api/handoff/claim — S9 (handoff LLM → app native)
 *
 * Appelé par l'APP (jamais par le LLM) une fois l'utilisateur en session —
 * invité ou compte, peu importe : c'est l'ancrage « invité d'abord ». Résout
 * le Handoff par token (deep link) OU code court (saisie / presse-papiers),
 * écrit le brief dans BuyerProfile, trace une CriteriaRevision, marque claimed.
 *
 * IDEMPOTENT pour le même utilisateur (réinstallation, double tap…) ;
 * 409 si un AUTRE compte a déjà réclamé ce lien (first-claim-wins).
 *
 * Garde : x-shomee-app-token + Bearer JWT (même duo que /api/buyer/profile).
 * Réf. : claude/ARCHITECTURE_ONBOARDING_HANDOFF.md §3–4 (projet Cowork).
 */

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAppToken } from '@/lib/auth/appToken'
import { getSessionUser } from '@/lib/auth/sessionUser'
import { readJsonObject, getString, jsonError } from '@/lib/http'
import { normalizeShortCode, isPlausibleShortCode } from '@/lib/handoff/shortCode'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  // 1. Gardes (duo appToken + JWT, comme buyer/profile).
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const user = await getSessionUser(req)
  if (!user) return jsonError('Non authentifié', 401)

  // 2. Corps : token OU shortCode (au moins l'un des deux).
  const body = await readJsonObject(req)
  const token = getString(body, 'token')
  const rawCode = getString(body, 'shortCode') ?? getString(body, 'code')
  const deviceId = getString(body, 'deviceId')

  let handoff = null
  if (token) {
    handoff = await prisma.handoff.findUnique({ where: { token } })
  } else if (rawCode) {
    const canonical = normalizeShortCode(rawCode)
    if (!isPlausibleShortCode(canonical)) {
      return jsonError('Code invalide — vérifiez la saisie (7 caractères, sans 0/O ni 1/I).', 400)
    }
    handoff = await prisma.handoff.findUnique({ where: { shortCode: canonical } })
  } else {
    return jsonError('Fournissez "token" ou "shortCode".', 400)
  }

  if (!handoff) return jsonError('Lien ou code introuvable.', 404)

  // 3. Expiration (lazy : on marque au passage).
  if (handoff.expiresAt.getTime() < Date.now()) {
    if (handoff.status === 'pending') {
      await prisma.handoff.update({ where: { id: handoff.id }, data: { status: 'expired' } })
    }
    return jsonError('Ce lien a expiré — refaites votre brief avec votre assistant.', 410)
  }

  // 4. Idempotence / conflit.
  if (handoff.status === 'claimed') {
    if (handoff.claimedByUserId === user.id) {
      return NextResponse.json({
        success: true,
        alreadyClaimed: true,
        kind: handoff.kind,
        source: handoff.source,
        brief: handoff.brief,
      })
    }
    return jsonError('Ce lien a déjà été utilisé par un autre compte.', 409)
  }

  // 5. Écritures atomiques : profil + révision + claim.
  //    Le brief embarque éventuellement parsed[] (passthrough create) →
  //    devient parsedCriteria ; le snapshot funnel entier va en
  //    searchPreferences ; les customCriteria alimentent rawTags.
  const briefObj = (handoff.brief ?? {}) as Record<string, unknown>
  const parsed = Array.isArray(briefObj.parsed) ? briefObj.parsed : []
  const customCriteria = Array.isArray(briefObj.customCriteria) ? briefObj.customCriteria : []
  const rawTags = customCriteria
    .map((c) => (c && typeof c === 'object' ? (c as { label?: unknown }).label : undefined))
    .filter((l): l is string => typeof l === 'string' && l.length > 0)

  // deviceId : fourni par l'app, sinon retrouvé via le pont UserDevice (S8).
  const revisionDeviceId =
    deviceId ??
    (await prisma.userDevice.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { deviceId: true },
    }))?.deviceId

  await prisma.$transaction([
    prisma.buyerProfile.upsert({
      where: { userId: user.id },
      update: {
        parsedCriteria: parsed as unknown as Prisma.InputJsonValue,
        searchPreferences: handoff.brief as unknown as Prisma.InputJsonValue,
        rawTags,
      },
      create: {
        userId: user.id,
        parsedCriteria: parsed as unknown as Prisma.InputJsonValue,
        searchPreferences: handoff.brief as unknown as Prisma.InputJsonValue,
        rawTags,
      },
    }),
    ...(revisionDeviceId
      ? [
          prisma.criteriaRevision.create({
            data: {
              deviceId: revisionDeviceId,
              snapshot: handoff.brief as unknown as Prisma.InputJsonValue,
              source: `handoff_${handoff.source}`,
            },
          }),
        ]
      : []),
    prisma.handoff.update({
      where: { id: handoff.id },
      data: { status: 'claimed', claimedByUserId: user.id, claimedAt: new Date() },
    }),
  ])

  // 6. Le brief part avec la réponse : l'app seed ses stores et génère le
  //    feed sans second aller-retour (chaîne runBriefHandoff existante).
  return NextResponse.json({
    success: true,
    alreadyClaimed: false,
    kind: handoff.kind,
    source: handoff.source,
    brief: handoff.brief,
  })
}
