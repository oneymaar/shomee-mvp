/**
 * POST /api/handoff/create — S9 (handoff LLM → app native)
 *
 * Appelé par un LLM (serveur MCP shomee, App ChatGPT, connecteur Claude) à la
 * fin d'un brief conversationnel. Valide le brief (même schéma que l'ancien
 * contrat PWA), persiste un Handoff (token opaque + code court humain,
 * TTL 7 jours) et renvoie l'URL de la page récap /h/<token> + le code.
 *
 * Auth : bearer d'intégration (AgentApiKey), comme onboarding-prefill (S6)
 * et le serveur MCP — le LLM n'agit PAS au nom d'un acquéreur ici
 * (kind=first_brief ; le parcours B « edit » arrivera avec le lien de compte).
 *
 * Réf. : claude/ARCHITECTURE_ONBOARDING_HANDOFF.md §3 (projet Cowork).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateBearer } from '@/lib/auth/bearer'
import { AIOnboardingBriefSchema, zodErrorMessage } from '@/lib/handoff/briefSchema'
import { generateShortCode, formatShortCode } from '@/lib/handoff/shortCode'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HANDOFF_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 jours

const CreateHandoffSchema = z.object({
  brief: AIOnboardingBriefSchema,
  source: z.enum(['chatgpt', 'claude', 'web'], {
    message: 'Le champ "source" est obligatoire : "chatgpt", "claude" ou "web".',
  }),
  /** Résumé lisible de la conversation (affiché sur la page récap). */
  transcriptSummary: z.string().max(2000).optional(),
  /**
   * Passthrough optionnel : ParsedCriterion[] complets produits par le LLM
   * (règles conditionnelles incluses). Validés/normalisés plus finement en D3 ;
   * transportés tels quels pour l'instant (le parser déterministe serveur
   * reste le filet sur customCriteria).
   */
  parsed: z.array(z.unknown()).max(60).optional(),
})

export async function POST(req: NextRequest) {
  // 1. Auth intégration (même garde que le MCP annonces / onboarding-prefill).
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  // 2. Corps
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Corps JSON invalide.' }, { status: 400 })
  }
  const parsedBody = CreateHandoffSchema.safeParse(raw)
  if (!parsedBody.success) {
    return NextResponse.json(
      { success: false, error: zodErrorMessage(parsedBody.error) },
      { status: 400 },
    )
  }
  const { brief, source, transcriptSummary, parsed } = parsedBody.data

  // 3. Persistance — le Json `brief` embarque les champs optionnels pour que
  //    claim/peek n'aient qu'un seul objet à transporter.
  const briefJson = {
    ...brief,
    ...(transcriptSummary ? { transcriptSummary } : {}),
    ...(parsed && parsed.length > 0 ? { parsed } : {}),
  } as unknown as Prisma.InputJsonValue

  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS)

  // Code court : collision improbable (31^7) mais gérée — retry sur P2002.
  let record: { token: string; shortCode: string } | null = null
  for (let attempt = 0; attempt < 5 && !record; attempt++) {
    try {
      record = await prisma.handoff.create({
        data: { shortCode: generateShortCode(), source, brief: briefJson, expiresAt },
        select: { token: true, shortCode: true },
      })
    } catch (e) {
      const isUniqueViolation =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
      if (!isUniqueViolation) throw e
    }
  }
  if (!record) {
    return NextResponse.json(
      { success: false, error: 'Génération du code impossible, réessayez.' },
      { status: 500 },
    )
  }

  // 4. URL de la page récap — même stratégie de base URL que l'ancien contrat.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/$/, '')

  return NextResponse.json({
    success: true,
    url: `${baseUrl}/h/${record.token}`,
    shortCode: formatShortCode(record.shortCode),
    token: record.token,
    expiresAt: expiresAt.toISOString(),
  })
}
