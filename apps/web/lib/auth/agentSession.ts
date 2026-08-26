import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import type { Agent, Agency } from '@prisma/client'

/**
 * Session AGENT (back-office web) — cookie httpOnly + JWT HS256 maison, même
 * facture que la session acquéreur (`lib/auth/jwt.ts`) mais claims distincts :
 * un jeton acquéreur ne peut PAS servir de session agent (claim `agent: true`
 * exigé), et réciproquement (l'acquéreur exige `sub` d'un User, pas d'un
 * Agent). Même secret d'environnement : SHOMEE_SESSION_SECRET.
 *
 * Les clés d'API (AgentApiKey, `bearer.ts`) restent l'auth des intégrations
 * machine — connecteurs Claude/ChatGPT. Deux portes, une identité.
 */

export const AGENT_COOKIE = 'shomee_agent_session'
const TTL_S = 30 * 24 * 60 * 60 // 30 jours

interface AgentClaims {
  sub: string
  agent: true
  iat: number
  exp: number
}

function secret(): string | null {
  const s = process.env.SHOMEE_SESSION_SECRET
  return s && s.length >= 16 ? s : null
}

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function hmac(data: string, key: string): string {
  return createHmac('sha256', key).update(data).digest('base64url')
}

export function signAgentSession(agentId: string): string | null {
  const key = secret()
  if (!key) return null
  const now = Math.floor(Date.now() / 1000)
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' })
  const payload = b64urlJson({ sub: agentId, agent: true, iat: now, exp: now + TTL_S })
  const data = `${header}.${payload}`
  return `${data}.${hmac(data, key)}`
}

export function verifyAgentSession(token: string): AgentClaims | null {
  const key = secret()
  if (!key) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, sig] = parts
  const expected = hmac(`${h}.${p}`, key)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const c = parsed as Record<string, unknown>
  if (typeof c.sub !== 'string' || c.agent !== true) return null
  if (typeof c.exp !== 'number' || Math.floor(Date.now() / 1000) >= c.exp) return null
  return { sub: c.sub, agent: true, iat: Number(c.iat), exp: c.exp }
}

function tokenFromCookieHeader(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === AGENT_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return null
}

export type AgentWithAgency = Agent & { agency: Agency }

/** Agent courant depuis une Request (routes API). */
export async function getSessionAgent(req: Request): Promise<AgentWithAgency | null> {
  const token = tokenFromCookieHeader(req.headers.get('cookie'))
  if (!token) return null
  const claims = verifyAgentSession(token)
  if (!claims) return null
  return prisma.agent.findUnique({ where: { id: claims.sub }, include: { agency: true } })
}

/** Agent courant depuis les pages/layouts serveur (next/headers). */
export async function getSessionAgentFromCookies(): Promise<AgentWithAgency | null> {
  const store = await cookies()
  const token = store.get(AGENT_COOKIE)?.value
  if (!token) return null
  const claims = verifyAgentSession(token)
  if (!claims) return null
  return prisma.agent.findUnique({ where: { id: claims.sub }, include: { agency: true } })
}

/** Attributs du cookie de session (posé à la connexion et à l'activation). */
export function agentCookieAttributes(): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge: number
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_S,
  }
}
