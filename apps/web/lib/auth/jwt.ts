import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * JWT de session Shomee — HS256, sans dependance (node:crypto).
 *
 * Distinct des autres schemas d'auth (token applicatif `appToken.ts`, bearer
 * agent `bearer.ts`) : ceci authentifie un UTILISATEUR (invite ou compte).
 * Signe {sub: userId, guest}. Verifie signature + expiration. Secret :
 * `SHOMEE_SESSION_SECRET` (obligatoire, sinon sign/verify renvoient null).
 */

const DEFAULT_TTL_S = 90 * 24 * 60 * 60 // 90 jours

export interface SessionClaims {
  sub: string
  guest: boolean
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

export function signSession(userId: string, guest: boolean, ttlSeconds = DEFAULT_TTL_S): string | null {
  const key = secret()
  if (!key) return null
  const now = Math.floor(Date.now() / 1000)
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' })
  const payload = b64urlJson({ sub: userId, guest, iat: now, exp: now + ttlSeconds })
  const data = `${header}.${payload}`
  return `${data}.${hmac(data, key)}`
}

export function verifySession(token: string): SessionClaims | null {
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
  if (typeof c.sub !== 'string' || typeof c.exp !== 'number' || typeof c.iat !== 'number') return null
  if (Math.floor(Date.now() / 1000) >= c.exp) return null
  return { sub: c.sub, guest: c.guest === true, iat: c.iat, exp: c.exp }
}
