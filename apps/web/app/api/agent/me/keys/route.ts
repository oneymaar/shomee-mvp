import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { readJsonObject, getString, jsonError } from '@/lib/http'
import { getSessionAgent } from '@/lib/auth/agentSession'

export const dynamic = 'force-dynamic'

/**
 * Clés d'API de l'agent connecté — LA porte de démarrage des connecteurs
 * Claude/ChatGPT maintenant que les comptes existent : l'agent crée sa
 * première clé depuis son back-office (l'ancienne route /api/agent/me/api-keys
 * exigeait… une clé déjà en main ; elle reste en place pour les intégrations).
 * La valeur complète n'est montrée QU'À la création.
 */
export async function GET(req: Request) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)
  const keys = await prisma.agentApiKey.findMany({
    where: { agentId: agent.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, key: true, createdAt: true, lastUsed: true },
  })
  return NextResponse.json({
    keys: keys.map((k) => ({
      id: k.id,
      label: k.label,
      preview: `${k.key.slice(0, 8)}…${k.key.slice(-4)}`,
      createdAt: k.createdAt.getTime(),
      lastUsed: k.lastUsed?.getTime() ?? null,
    })),
  })
}

export async function POST(req: Request) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)
  const body = await readJsonObject(req)
  const label = getString(body, 'label') ?? 'Connecteur'
  const key = `shomee_${randomBytes(24).toString('base64url')}`
  const created = await prisma.agentApiKey.create({
    data: { agentId: agent.id, key, label },
  })
  // Seule et unique fois où la clé complète sort du serveur.
  return NextResponse.json({ id: created.id, label, key })
}
