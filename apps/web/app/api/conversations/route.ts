import { NextResponse } from 'next/server'
import { requireAppToken } from '@/lib/auth/appToken'
import { getSessionUser } from '@/lib/auth/sessionUser'
import { jsonError } from '@/lib/http'
import { buyerConversationsJson } from '@/lib/chat/serialize'

export const dynamic = 'force-dynamic'

/**
 * Fils de l'acquéreur connecté — ENTIERS (messages inclus). Le mobile
 * synchronise en remplaçant tout : simple, sûr, suffisant aux volumes du MVP.
 */
export async function GET(req: Request) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const user = await getSessionUser(req)
  if (!user) return jsonError('Non authentifié', 401)
  const conversations = await buyerConversationsJson(user.id)
  return NextResponse.json({ conversations })
}
