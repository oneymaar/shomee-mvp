import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  ImportLLMSchema,
  creerBienDepuisLLM,
  verifierQuota,
  type AgentAvecAgence,
} from '@/lib/biens/importLlm'
import type { AgentApiKey } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Import d'une annonce rédigée par un LLM, authentifié par clé Bearer.
 * Tout le métier (schéma, mapping des 24 champs, quota) vit dans
 * lib/biens/importLlm.ts, partagé avec l'outil `shomee_creer_annonce` du
 * connecteur MCP : une seule définition, deux portes d'entrée.
 */

type AuthResult =
  | { ok: true;  apiKey: AgentApiKey; agent: AgentAvecAgence }
  | { ok: false; status: 401; body: { error: string } }

async function authenticate(req: Request): Promise<AuthResult> {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return { ok: false, status: 401, body: { error: 'Clé API invalide' } }
  }
  const key = header.slice(7).trim()
  if (!key) return { ok: false, status: 401, body: { error: 'Clé API invalide' } }

  const apiKey = await prisma.agentApiKey.findUnique({
    where: { key },
    include: { agent: { include: { agency: true } } },
  })
  if (!apiKey) return { ok: false, status: 401, body: { error: 'Clé API invalide' } }

  return { ok: true, apiKey, agent: apiKey.agent }
}

export async function POST(req: Request) {
  const auth = await authenticate(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const { apiKey, agent } = auth

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const parsed = ImportLLMSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
    const missingAdresse = issues.some((i) => i.path[0] === 'adresse')
    if (missingAdresse) {
      return NextResponse.json({ error: 'adresse est obligatoire', details: issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'Validation échouée', details: issues }, { status: 400 })
  }

  const quota = await verifierQuota(agent)
  if (!quota.ok) {
    return NextResponse.json(
      {
        error: 'Quota atteint',
        message: `Limite de ${quota.max} biens actifs atteinte. Passez en Pro pour en ajouter davantage.`,
        current: quota.current,
        max: quota.max,
      },
      { status: 403 },
    )
  }

  try {
    const bien = await creerBienDepuisLLM(agent, parsed.data)

    await prisma.agentApiKey.update({
      where: { id: apiKey.id },
      data:  { lastUsed: new Date() },
    })

    return NextResponse.json({
      success: true,
      bien_id: bien.id,
      completion_rate: bien.completionRate,
      fields_filled: bien.fieldsFilled,
      fields_total: bien.fieldsTotal,
      next_step_url: `/agent/biens/${bien.id}/editer`,
      message: `Annonce créée à ${Math.round(bien.completionRate * 100)}%. Ouvrez l'app SHOMEE pour ajouter la vidéo et finaliser.`,
    })
  } catch (err) {
    console.error('[POST /api/biens/import-llm]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
