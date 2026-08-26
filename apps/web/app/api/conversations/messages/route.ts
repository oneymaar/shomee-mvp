import { NextResponse } from 'next/server'
import { requireAppToken } from '@/lib/auth/appToken'
import { getSessionUser } from '@/lib/auth/sessionUser'
import { readJsonObject, getString, jsonError } from '@/lib/http'
import { chatDb } from '@/lib/db/newModels'
import { getOrCreateConversation, kindFromMobile } from '@/lib/chat/serialize'

export const dynamic = 'force-dynamic'

const MAX_TEXT = 4000

/**
 * Envoi d'un message acquéreur — adressé par PROPERTYID (le mobile ne connaît
 * pas les ids de fils avant la première synchro) ; le serveur résout ou crée.
 * kinds permis côté acquéreur : text, visit_request, availabilities.
 */
export async function POST(req: Request) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const user = await getSessionUser(req)
  if (!user) return jsonError('Non authentifié', 401)

  const body = await readJsonObject(req)
  const propertyId = getString(body, 'propertyId')
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!propertyId) return jsonError('propertyId requis', 400)
  if (!text || text.length > MAX_TEXT) return jsonError('Message vide ou trop long', 400)

  const kind = kindFromMobile(body.kind)
  if (kind === 'SYSTEM') return jsonError('Type de message non autorisé', 400)
  const payload =
    body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : undefined

  const conv = await getOrCreateConversation(user.id, propertyId)
  if (!conv) return jsonError('Bien introuvable', 404)

  const message = await chatDb.message.create({
    data: { conversationId: conv.id, sender: 'BUYER', kind, text, payload },
  })
  await chatDb.conversation.update({
    where: { id: conv.id },
    // L'envoi vaut lecture : je suis dans le fil, je vois tout ce qui précède.
    data: { lastMessageAt: message.createdAt, buyerLastReadAt: message.createdAt },
  })

  return NextResponse.json({
    conversationId: conv.id,
    message: { id: message.id, timestamp: message.createdAt.getTime() },
  })
}
