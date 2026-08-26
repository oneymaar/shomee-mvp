import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jsonError } from '@/lib/http'
import { getSessionAgent } from '@/lib/auth/agentSession'
import { chatDb } from '@/lib/db/newModels'

export const dynamic = 'force-dynamic'

/** Fil complet côté agent : messages + bien + acquéreur. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)
  const { id } = await ctx.params
  const conv = await chatDb.conversation.findUnique({ where: { id } })
  if (!conv || conv.agentId !== agent.id) return jsonError('Fil introuvable', 404)

  const messages = await chatDb.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
  })
  const property = await prisma.property.findUnique({
    where: { id: conv.propertyId },
    select: { id: true, title: true, arrondissement: true, district: true, price: true, surface: true, rooms: true },
  })
  const buyer = await prisma.user.findUnique({
    where: { id: conv.buyerUserId },
    select: { name: true, email: true, isGuest: true },
  })

  return NextResponse.json({
    id: conv.id,
    property,
    buyer: {
      name: buyer?.name ?? (buyer?.isGuest ? 'Acquéreur invité' : 'Acquéreur'),
      email: buyer?.email ?? null,
    },
    messages: messages.map((m) => ({
      id: m.id,
      fromBuyer: m.sender === 'BUYER',
      kind: m.kind,
      text: m.text,
      payload: m.payload ?? null,
      at: m.createdAt.getTime(),
    })),
  })
}
