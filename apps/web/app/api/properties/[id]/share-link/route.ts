/**
 * P0 — Lien de partage d'un bien.
 *
 *   POST  /api/properties/<id>/share-link  → génère (une fois) et renvoie
 *         l'URL publique absolue `/p/<token>`, plus le titre et le texte
 *         d'accompagnement destinés à la feuille de partage iOS.
 *   PATCH /api/properties/<id>/share-link  → bascule `isShareable`, le
 *         garde-fou off-market piloté depuis le back-office.
 *
 * AUTH — le back-office agent n'a pas d'authentification propre : l'éditeur de
 * bien et les cartes du dashboard appellent `/api/biens/<id>` avec une clé de
 * démo EN DUR dans le bundle client (`shomee_test_kr3tz_0001`), validée par
 * `authenticateBearer`. On s'aligne donc sur ce garde — même niveau que la
 * page qui appelle la route, ni plus ni moins — plus le contrôle d'agence.
 * Ce n'est PAS une protection réelle : quiconque lit le bundle peut appeler
 * ces routes. À reprendre avec la vraie auth agent.
 *
 * Le token n'est jamais recyclé : une fois émis, il reste attaché au bien pour
 * que les liens déjà collés dans les conversations continuent de vivre. Couper
 * le partage se fait par `isShareable`, pas par rotation de token.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateBearer } from '@/lib/auth/bearer'
import {
  buildShareText,
  buildShareTitle,
  generateShareToken,
  isShareableStatus,
} from '@/lib/shareLink'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Tentatives de génération en cas de collision d'unicité (P2002). */
const MAX_TOKEN_ATTEMPTS = 5

const PROPERTY_SELECT = {
  id: true,
  statut: true,
  shareToken: true,
  isShareable: true,
  agencyId: true,
  rooms: true,
  price: true,
  district: true,
  arrondissement: true,
} as const

type GuardedProperty = Prisma.PropertyGetPayload<{ select: typeof PROPERTY_SELECT }>

type Guarded =
  | { ok: true; property: GuardedProperty }
  | { ok: false; response: NextResponse }

/** Bearer valide + bien existant + bien appartenant à l'agence du porteur. */
async function guard(req: NextRequest, id: string): Promise<Guarded> {
  const auth = await authenticateBearer(req)
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json(auth.body, { status: auth.status }) }
  }

  const property = await prisma.property.findUnique({ where: { id }, select: PROPERTY_SELECT })

  if (!property) {
    return { ok: false, response: NextResponse.json({ error: 'Bien introuvable' }, { status: 404 }) }
  }
  if (property.agencyId !== auth.agent.agencyId) {
    return { ok: false, response: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  }

  return { ok: true, property }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const guarded = await guard(req, id)
  if (!guarded.ok) return guarded.response

  const { property } = guarded

  // Un bien archivé est retiré du marché : son lien doit être mort, on refuse
  // donc d'en émettre un. Brouillon et dépublié, eux, sont partageables — c'est
  // l'avant-première et l'off-market.
  if (!isShareableStatus(property.statut)) {
    return NextResponse.json(
      { error: 'Désarchivez le bien pour le partager.' },
      { status: 409 },
    )
  }

  let token = property.shareToken

  if (!token) {
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS && !token; attempt++) {
      const candidate = generateShareToken()
      try {
        const updated = await prisma.property.update({
          where: { id: property.id },
          data: { shareToken: candidate },
          select: { shareToken: true },
        })
        token = updated.shareToken
      } catch (e) {
        const isUniqueViolation =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
        if (!isUniqueViolation) throw e
        // Collision (astronomiquement improbable) : on retire un autre token.
      }
    }
  }

  if (!token) {
    return NextResponse.json(
      { error: 'Génération du lien impossible, réessayez.' },
      { status: 500 },
    )
  }

  // Même stratégie de base URL que les liens /h/<token>.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/$/, '')

  return NextResponse.json({
    success: true,
    url: `${baseUrl}/p/${token}`,
    token,
    title: buildShareTitle(property),
    text: buildShareText(property),
    isShareable: property.isShareable,
    statut: property.statut,
  })
}

const ShareablePatchSchema = z.object({
  isShareable: z.boolean(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const guarded = await guard(req, id)
  if (!guarded.ok) return guarded.response

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const parsed = ShareablePatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const updated = await prisma.property.update({
    where: { id: guarded.property.id },
    data: { isShareable: parsed.data.isShareable },
    select: { id: true, isShareable: true },
  })

  return NextResponse.json({ success: true, ...updated })
}

