import { NextResponse } from 'next/server'
import { readJsonObject, jsonError } from '@/lib/http'
import { getSessionAgent } from '@/lib/auth/agentSession'
import { chatDb } from '@/lib/db/newModels'

export const dynamic = 'force-dynamic'

const MAX_TEXT = 4000

/** Réponse de l'agent dans un de ses fils (texte libre uniquement). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)
  const { id } = await ctx.params
  const conv = await chatDb.conversation.findUnique({ where: { id } })
  if (!conv || conv.agentId !== agent.id) return jsonError('Fil introuvable', 404)

  const body = await readJsonObject(req)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text || text.length > MAX_TEXT) return jsonError('Message vide ou trop long', 400)

  const message = await chatDb.message.create({
    data: { conversationId: id, sender: 'AGENT', kind: 'TEXT', text },
  })
  await chatDb.conversation.update({
    where: { id },
    data: { lastMessageAt: message.createdAt, agentLastReadAt: message.createdAt },
  })
  return NextResponse.json({ ok: true, message: { id: message.id, at: message.createdAt.getTime() } })
}
