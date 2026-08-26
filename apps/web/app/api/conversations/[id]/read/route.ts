import { NextResponse } from 'next/server'
import { requireAppToken } from '@/lib/auth/appToken'
import { getSessionUser } from '@/lib/auth/sessionUser'
import { jsonError } from '@/lib/http'
import { chatDb } from '@/lib/db/newModels'

export const dynamic = 'force-dynamic'

/** Marque le fil lu côté acquéreur (curseur buyerLastReadAt). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const user = await getSessionUser(req)
  if (!user) return jsonError('Non authentifié', 401)
  const { id } = await ctx.params
  const conv = await chatDb.conversation.findUnique({ where: { id } })
  if (!conv || conv.buyerUserId !== user.id) return jsonError('Fil introuvable', 404)
  await chatDb.conversation.update({ where: { id }, data: { buyerLastReadAt: new Date() } })
  return NextResponse.json({ ok: true })
}
