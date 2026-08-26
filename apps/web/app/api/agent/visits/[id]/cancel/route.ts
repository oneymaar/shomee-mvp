import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/http'
import { getSessionAgent } from '@/lib/auth/agentSession'
import { chatDb } from '@/lib/db/newModels'
import { formatVisitDateParis } from '@/lib/chat/parisTime'

export const dynamic = 'force-dynamic'

/**
 * Annulation d'une visite par l'agence — statut CANCELLED (le .ics passe lui
 * aussi à CANCELLED : un agenda qui re-télécharge voit l'annulation) + message
 * SYSTEM neutre dans le fil, visible des deux côtés.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)
  const { id } = await ctx.params
  const visit = await chatDb.visit.findUnique({ where: { id } })
  if (!visit || visit.agentId !== agent.id) return jsonError('Visite introuvable', 404)
  if (visit.status === 'CANCELLED') return NextResponse.json({ ok: true })

  await chatDb.visit.update({ where: { id }, data: { status: 'CANCELLED' } })
  const message = await chatDb.message.create({
    data: {
      conversationId: visit.conversationId,
      sender: 'AGENT',
      kind: 'SYSTEM',
      text: `La visite du ${formatVisitDateParis(visit.scheduledAt)} a été annulée par l'agence.`,
      payload: { visitId: visit.id, status: 'CANCELLED' },
    },
  })
  await chatDb.conversation.update({
    where: { id: visit.conversationId },
    data: { lastMessageAt: message.createdAt },
  })
  return NextResponse.json({ ok: true })
}
