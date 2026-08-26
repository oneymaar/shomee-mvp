import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readJsonObject, getString, jsonError } from '@/lib/http'
import { getSessionAgent } from '@/lib/auth/agentSession'
import { creerBienDepuisLLM, verifierQuota } from '@/lib/biens/importLlm'

export const dynamic = 'force-dynamic'

/**
 * Créer un brouillon depuis une adresse — l'étape 1 de l'assistant.
 *
 * POURQUOI SI TÔT. Le téléversement d'une vidéo a besoin d'un `bien_id` pour
 * signer puis confirmer : sans bien en base, aucun envoi n'est possible. C'est
 * la raison de fond pour laquelle l'ancien assistant ne pouvait pas marcher —
 * il ne créait jamais rien et renvoyait vers une fiche fictive.
 *
 * Le métier est celui de l'import LLM, à l'identique (quota de l'agence,
 * arrondissement déduit du code postal, statut brouillon) : une adresse saisie
 * à la main ou dictée à Claude doit produire exactement le même bien.
 */
export async function POST(req: Request) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)

  const body = await readJsonObject(req)
  const adresse = getString(body, 'adresse')?.trim()
  if (!adresse) return jsonError('Indiquez l’adresse du bien.', 400)

  const quota = await verifierQuota(agent)
  if (!quota.ok) {
    return jsonError(
      `Vous avez ${quota.current} biens actifs sur ${quota.max} autorisés. Archivez un bien ou passez en Pro.`,
      403,
    )
  }

  try {
    const bien = await creerBienDepuisLLM(agent, { adresse })
    return NextResponse.json({
      bien_id: bien.id,
      completion_rate: bien.completionRate,
      editer_url: `/agent/biens/${bien.id}/editer`,
    })
  } catch (e) {
    console.error('[POST /api/agent/biens]', e)
    return jsonError('Création impossible.', 500)
  }
}

/** Le quota, pour prévenir AVANT de faire saisir une adresse pour rien. */
export async function GET(req: Request) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)
  const actifs = await prisma.property.count({
    where: { createdByAgentId: agent.id, statut: { not: 'ARCHIVED' } },
  })
  return NextResponse.json({ actifs, max: agent.agency.maxProperties })
}
