import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jsonError } from '@/lib/http'
import { getSessionAgent } from '@/lib/auth/agentSession'
import { chatDb } from '@/lib/db/newModels'

export const dynamic = 'force-dynamic'

/**
 * Fils de l'agent connecté — liste allégée pour la boîte de réception :
 * dernier message, non-lus, bien, acquéreur. Le fil complet se charge par id.
 */
export async function GET(req: Request) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)

  const convs = await chatDb.conversation.findMany({
    where: { agentId: agent.id },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  })
  if (convs.length === 0) return NextResponse.json({ conversations: [] })

  const msgs = await chatDb.message.findMany({
    where: { conversationId: { in: convs.map((c) => c.id) } },
    orderBy: { createdAt: 'asc' },
  })
  const byConv = new Map<string, typeof msgs>()
  for (const m of msgs) {
    const l = byConv.get(m.conversationId) ?? []
    l.push(m)
    byConv.set(m.conversationId, l)
  }

  const props = await prisma.property.findMany({
    where: { id: { in: [...new Set(convs.map((c) => c.propertyId))] } },
    select: { id: true, title: true, arrondissement: true, district: true, price: true },
  })
  const propById = new Map(props.map((p) => [p.id, p]))
  const buyers = await prisma.user.findMany({
    where: { id: { in: [...new Set(convs.map((c) => c.buyerUserId))] } },
    select: { id: true, name: true, email: true, isGuest: true },
  })
  const buyerById = new Map(buyers.map((b) => [b.id, b]))

  return NextResponse.json({
    conversations: convs.map((c) => {
      const list = byConv.get(c.id) ?? []
      const last = list[list.length - 1]
      const read = c.agentLastReadAt?.getTime() ?? 0
      const unread = list.filter((m) => m.sender === 'BUYER' && m.createdAt.getTime() > read).length
      const buyer = buyerById.get(c.buyerUserId)
      const hasVisitRequest = list.some((m) => m.kind === 'VISIT_REQUEST')
      return {
        id: c.id,
        property: propById.get(c.propertyId) ?? { id: c.propertyId, title: 'Bien retiré' },
        buyer: {
          name: buyer?.name ?? (buyer?.isGuest ? 'Acquéreur invité' : 'Acquéreur'),
          email: buyer?.email ?? null,
        },
        lastMessage: last ? { text: last.text, at: last.createdAt.getTime(), fromBuyer: last.sender === 'BUYER' } : null,
        unread,
        hasVisitRequest,
      }
    }),
  })
}
