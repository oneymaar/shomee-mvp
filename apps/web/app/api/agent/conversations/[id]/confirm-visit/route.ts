import { NextResponse } from 'next/server'
import { readJsonObject, jsonError } from '@/lib/http'
import { getSessionAgent } from '@/lib/auth/agentSession'
import { chatDb } from '@/lib/db/newModels'
import { newSetupToken } from '@/lib/auth/agentPassword'
import { formatVisitDateParis } from '@/lib/chat/parisTime'

export const dynamic = 'force-dynamic'

/**
 * L'agent cale la visite — heure PRÉCISE choisie par lui (c'est le contrat du
 * parcours : l'acquéreur donne des tranches grossières, l'agent tranche).
 * Crée l'objet Visit + poste le message structuré VISIT_CONFIRMED dans le fil.
 * `scheduledAt` arrive en ISO UTC : la conversion locale→UTC est faite par le
 * NAVIGATEUR de l'agent (datetime-local → toISOString), jamais par le serveur.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)
  const { id } = await ctx.params
  const conv = await chatDb.conversation.findUnique({ where: { id } })
  if (!conv || conv.agentId !== agent.id) return jsonError('Fil introuvable', 404)

  const body = await readJsonObject(req)
  const at = typeof body.scheduledAt === 'string' ? new Date(body.scheduledAt) : null
  const durationMin = typeof body.durationMin === 'number' ? Math.round(body.durationMin) : 30
  if (!at || Number.isNaN(at.getTime())) return jsonError('Date invalide', 400)
  if (durationMin < 15 || durationMin > 240) return jsonError('Durée invalide (15 à 240 min)', 400)

  const visit = await chatDb.visit.create({
    data: {
      conversationId: conv.id,
      propertyId: conv.propertyId,
      buyerUserId: conv.buyerUserId,
      agentId: agent.id,
      scheduledAt: at,
      durationMin,
      icsToken: newSetupToken(),
    },
  })

  const message = await chatDb.message.create({
    data: {
      conversationId: conv.id,
      sender: 'AGENT',
      kind: 'VISIT_CONFIRMED',
      text: `Visite confirmée — ${formatVisitDateParis(at)}.`,
      payload: {
        visitId: visit.id,
        scheduledAt: at.toISOString(),
        durationMin,
        icsToken: visit.icsToken,
        status: 'CONFIRMED',
      },
    },
  })
  await chatDb.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: message.createdAt, agentLastReadAt: message.createdAt },
  })

  return NextResponse.json({ ok: true, visitId: visit.id })
}
