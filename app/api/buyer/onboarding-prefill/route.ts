/**
 * POST /api/buyer/onboarding-prefill
 *   Receives an AI-generated buyer brief, validates it, persists it as a
 *   magic-link token (24h TTL), and returns the URL the acquéreur must open.
 *   Bearer auth via lib/auth/bearer.ts.
 *
 * GET  /api/buyer/onboarding-prefill?token=<uuid>
 *   Returns the stored brief. The token stays valid until `expiresAt` —
 *   it is NOT single-use. This lets the acquéreur reopen the link from
 *   email/messaging history if they refresh, share devices, etc.
 *   Returns 404 if unknown, 410 if expired.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateBearer } from '@/lib/auth/bearer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ─── Validation ────────────────────────────────────────────────────────────

const ChipStateSchema = z.union([z.literal(1), z.literal(2), z.literal(3)])

export const AIOnboardingBriefSchema = z.object({
  locationQuery: z.string().min(2, 'locationQuery doit contenir au moins 2 caractères'),
  propertyTypes: z
    .array(z.enum(['appartement', 'maison', 'loft', 'atelier']))
    .optional()
    .default([]),
  minRooms: z.number().nullable().optional().default(null),
  minSurface: z.number().positive('minSurface doit être un nombre positif'),
  maxSurface: z.number().nullable().optional().default(null),
  budgetMin: z.number().nullable().optional().default(null),
  budgetMax: z.number().positive('budgetMax doit être un nombre positif'),
  chipStates: z.record(z.string(), ChipStateSchema).optional().default({}),
  customCriteria: z
    .array(
      z.object({
        label: z.string().min(1),
        state: ChipStateSchema,
      }),
    )
    .optional()
    .default([]),
})

export type AIOnboardingBrief = z.infer<typeof AIOnboardingBriefSchema>

// ─── Error message helpers (French, field-specific) ───────────────────────

const REQUIRED_FIELD_MESSAGES: Record<string, string> = {
  locationQuery: 'Le champ "locationQuery" est obligatoire (zone de recherche).',
  minSurface: 'Le champ "minSurface" est obligatoire (surface minimum en m²).',
  budgetMax: 'Le champ "budgetMax" est obligatoire (budget maximum en €).',
}

function zodErrorMessage(err: z.ZodError): string {
  const issue = err.issues[0]
  if (!issue) return 'Brief invalide.'
  const path = issue.path.join('.')
  const required = REQUIRED_FIELD_MESSAGES[path]
  if (required) return required
  if (issue.code === 'invalid_type' && (issue as { received?: unknown }).received === 'undefined') {
    return `Champ requis manquant : "${path}".`
  }
  return `Champ "${path}" invalide : ${issue.message}`
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Auth
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  // 2. Body
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Corps JSON invalide.' }, { status: 400 })
  }

  const parsed = AIOnboardingBriefSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: zodErrorMessage(parsed.error) },
      { status: 400 },
    )
  }
  const brief = parsed.data

  // 3. Persist a one-shot magic-link token (24h TTL).
  // Cast to Prisma.InputJsonValue — Zod already guarantees a JSON-safe
  // tree (strings / numbers / booleans / nulls / arrays / records).
  const record = await prisma.buyerBriefToken.create({
    data: {
      briefJson: brief as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    },
  })

  // 4. Build the magic link
  // Prefer NEXT_PUBLIC_APP_URL (canonical prod URL) but fall back to the
  // request origin so the system works in preview deployments and locally
  // without an explicit env var.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/$/, '')
  const url = `${baseUrl}/onboarding?brief=${record.token}`

  return NextResponse.json({ success: true, token: record.token, url })
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json(
      { success: false, error: 'Paramètre "token" manquant.' },
      { status: 400 },
    )
  }

  const record = await prisma.buyerBriefToken.findUnique({ where: { token } })
  if (!record) {
    return NextResponse.json(
      { success: false, error: 'Lien introuvable.' },
      { status: 404 },
    )
  }
  if (record.expiresAt.getTime() < Date.now()) {
    return NextResponse.json(
      { success: false, error: 'Lien expiré.' },
      { status: 410 },
    )
  }

  return NextResponse.json({ success: true, brief: record.briefJson })
}
