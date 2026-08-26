import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readJsonObject, getString, jsonError } from '@/lib/http'
import { verifyPassword } from '@/lib/auth/agentPassword'
import { chatDb } from '@/lib/db/newModels'
import { AGENT_COOKIE, agentCookieAttributes, signAgentSession } from '@/lib/auth/agentSession'

export const dynamic = 'force-dynamic'

/**
 * Connexion agent (back-office web) — email + mot de passe → cookie httpOnly.
 * Même message d'erreur que l'email existe ou non : ne pas confirmer à un
 * inconnu quelles adresses ont un compte.
 */
export async function POST(req: Request) {
  const body = await readJsonObject(req)
  const email = getString(body, 'email')?.toLowerCase()
  const password = typeof body.password === 'string' ? body.password : undefined
  if (!email || !password) return jsonError('Email et mot de passe requis', 400)

  const agent = await chatDb.agent.findUnique({ where: { email } })
  if (!agent?.passwordHash || !verifyPassword(password, agent.passwordHash)) {
    return jsonError('Identifiants incorrects', 401)
  }

  const token = signAgentSession(agent.id)
  if (!token) return jsonError('Session indisponible (secret manquant)', 500)

  const full = await prisma.agent.findUnique({
    where: { id: agent.id },
    include: { agency: true },
  })
  const res = NextResponse.json({
    agent: { id: agent.id, name: agent.name, email: agent.email, agency: full?.agency?.name ?? null },
  })
  res.cookies.set(AGENT_COOKIE, token, agentCookieAttributes())
  return res
}
