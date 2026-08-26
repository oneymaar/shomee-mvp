import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/http'
import { getSessionAgent } from '@/lib/auth/agentSession'
import { chatDb } from '@/lib/db/newModels'

export const dynamic = 'force-dynamic'

/** Marque le fil lu côté agent. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)
  const { id } = await ctx.params
  const conv = await chatDb.conversation.findUnique({ where: { id } })
  if (!conv || conv.agentId !== agent.id) return jsonError('Fil introuvable', 404)
  await chatDb.conversation.update({ where: { id }, data: { agentLastReadAt: new Date() } })
  return NextResponse.json({ ok: true })
}
