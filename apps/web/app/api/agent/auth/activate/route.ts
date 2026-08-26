import { NextResponse } from 'next/server'
import { readJsonObject, getString, jsonError } from '@/lib/http'
import { hashPassword, PASSWORD_MIN_LENGTH } from '@/lib/auth/agentPassword'
import { chatDb } from '@/lib/db/newModels'
import { AGENT_COOKIE, agentCookieAttributes, signAgentSession } from '@/lib/auth/agentSession'

export const dynamic = 'force-dynamic'

/**
 * Activation d'un compte agent — le lien d'activation (généré par l'admin)
 * porte un jeton à usage unique ; l'agent choisit son mot de passe et repart
 * CONNECTÉ (pas de double étape). Sert aussi de réinitialisation : l'admin
 * régénère un lien, même parcours.
 */
export async function POST(req: Request) {
  const body = await readJsonObject(req)
  const token = getString(body, 'token')
  const password = typeof body.password === 'string' ? body.password : ''
  if (!token) return jsonError('Lien invalide', 400)
  if (password.length < PASSWORD_MIN_LENGTH) {
    return jsonError(`Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères`, 400)
  }

  const agent = await chatDb.agent.findUnique({ where: { setupToken: token } })
  if (!agent || !agent.setupTokenExpires || agent.setupTokenExpires.getTime() < Date.now()) {
    return jsonError('Ce lien a expiré — demandez-en un nouveau', 410)
  }

  await chatDb.agent.update({
    where: { id: agent.id },
    data: { passwordHash: hashPassword(password), setupToken: null, setupTokenExpires: null },
  })

  const session = signAgentSession(agent.id)
  if (!session) return jsonError('Session indisponible (secret manquant)', 500)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AGENT_COOKIE, session, agentCookieAttributes())
  return res
}
