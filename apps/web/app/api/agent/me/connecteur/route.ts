import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { jsonError } from '@/lib/http'
import { getSessionAgent } from '@/lib/auth/agentSession'

export const dynamic = 'force-dynamic'

/**
 * LE CONNECTEUR DE L'AGENT — une seule adresse à copier, pas une clé à gérer.
 *
 * Ce que l'agent voyait avant : « créez une clé, copiez-la maintenant, elle ne
 * sera plus jamais affichée ». Un secret à recopier est un geste
 * d'informaticien, et un secret montré une seule fois oblige à tout révoquer
 * dès qu'on change d'ordinateur. Or la clé est de toute façon stockée en clair
 * en base — c'est ainsi qu'un porteur de jeton s'authentifie. La cacher à son
 * propriétaire n'apportait donc aucune sécurité, seulement de la friction.
 *
 * Ici : UN connecteur par agent, ré-affichable autant de fois qu'il veut depuis
 * sa session, révocable en un clic. Les clés créées par l'ancienne route
 * (/api/agent/me/keys) et la clé de test ne sont pas touchées.
 *
 * OAuth 2.0 remplacera tout ceci : l'agent collera alors une adresse publique
 * identique pour tous et se connectera avec son mot de passe, sans jamais voir
 * de secret. C'est aussi la condition d'entrée dans les annuaires Claude et
 * ChatGPT.
 */

const LABEL = 'Connecteur IA'

/** Base publique du connecteur : le domaine configuré, sinon celui de la requête. */
function baseUrl(req: Request): string {
  const configuree = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  return configuree && configuree.length > 0 ? configuree : new URL(req.url).origin
}

/**
 * En bêta, le déploiement de prévisualisation est protégé par Vercel, et ni
 * Claude ni ChatGPT ne savent poser un en-tête : le contournement se met donc
 * en paramètres d'URL. Le secret ne sort que vers l'agent authentifié, et cette
 * partie disparaît avec le domaine de production.
 */
function suffixeBypass(): string {
  const secret = process.env.SHOMEE_VERCEL_BYPASS
  if (!secret) return ''
  return `&x-vercel-protection-bypass=${encodeURIComponent(secret)}&x-vercel-set-bypass-cookie=true`
}

type Connecteur = {
  urlClaude: string
  urlChatgpt: string
  createdAt: number
  lastUsed: number | null
}

function composer(req: Request, cle: { key: string; createdAt: Date; lastUsed: Date | null }): Connecteur {
  const base = `${baseUrl(req)}/api/mcp?k=${encodeURIComponent(cle.key)}`
  return {
    urlClaude: `${base}&client=claude${suffixeBypass()}`,
    urlChatgpt: `${base}&client=chatgpt${suffixeBypass()}`,
    createdAt: cle.createdAt.getTime(),
    lastUsed: cle.lastUsed?.getTime() ?? null,
  }
}

export async function GET(req: Request) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)

  const cle = await prisma.agentApiKey.findFirst({
    where: { agentId: agent.id, label: LABEL },
    orderBy: { createdAt: 'desc' },
    select: { key: true, createdAt: true, lastUsed: true },
  })
  return NextResponse.json({ connecteur: cle ? composer(req, cle) : null })
}

export async function POST(req: Request) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)

  // Idempotent : deux clics ne créent pas deux connecteurs.
  const existante = await prisma.agentApiKey.findFirst({
    where: { agentId: agent.id, label: LABEL },
    orderBy: { createdAt: 'desc' },
    select: { key: true, createdAt: true, lastUsed: true },
  })
  if (existante) return NextResponse.json({ connecteur: composer(req, existante) })

  const cle = await prisma.agentApiKey.create({
    data: { agentId: agent.id, key: `shomee_${randomBytes(24).toString('base64url')}`, label: LABEL },
    select: { key: true, createdAt: true, lastUsed: true },
  })
  return NextResponse.json({ connecteur: composer(req, cle) })
}

/** Révocation : le connecteur cesse de répondre immédiatement, partout. */
export async function DELETE(req: Request) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)
  await prisma.agentApiKey.deleteMany({ where: { agentId: agent.id, label: LABEL } })
  return NextResponse.json({ ok: true })
}
