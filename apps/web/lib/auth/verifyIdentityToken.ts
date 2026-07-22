import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from 'node:crypto'

/**
 * Verification d'un identity token OIDC (Apple / Google) cote serveur, sans
 * dependance : on recupere le JWKS du fournisseur, on verifie la signature
 * RS256 via node:crypto, puis on controle iss / aud / exp. Le fetch JWKS a lieu
 * au RUNTIME (Vercel a le reseau) ; mis en cache 1h par URL.
 */

interface Jwk {
  kid: string
  kty: string
  n: string
  e: string
  alg?: string
  use?: string
}

interface JwksCache {
  keys: Jwk[]
  fetchedAt: number
}

const JWKS_TTL_MS = 60 * 60 * 1000
const cache = new Map<string, JwksCache>()

async function getJwks(url: string): Promise<Jwk[]> {
  const c = cache.get(url)
  if (c && Date.now() - c.fetchedAt < JWKS_TTL_MS) return c.keys
  const res = await fetch(url)
  if (!res.ok) throw new Error(`JWKS ${url} -> ${res.status}`)
  const json = (await res.json()) as { keys?: Jwk[] }
  const keys = Array.isArray(json.keys) ? json.keys : []
  cache.set(url, { keys, fetchedAt: Date.now() })
  return keys
}

function decode(seg: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export interface IdentityClaims {
  sub: string
  email?: string
  name?: string
}

export interface VerifyConfig {
  jwksUrl: string
  issuers: string[]
  audiences: string[]
}

export async function verifyIdentityToken(token: string, cfg: VerifyConfig): Promise<IdentityClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const header = decode(parts[0])
  const payload = decode(parts[1])
  if (!header || !payload) return null
  if (asString(header.alg) !== 'RS256') return null
  const kid = asString(header.kid)
  if (!kid) return null
  if (cfg.audiences.length === 0) return null

  let keys: Jwk[]
  try {
    keys = await getJwks(cfg.jwksUrl)
  } catch {
    return null
  }
  const jwk = keys.find((k) => k.kid === kid)
  if (!jwk) return null

  let valid = false
  try {
    const keyObject = createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' })
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`)
    const signature = Buffer.from(parts[2], 'base64url')
    valid = cryptoVerify('RSA-SHA256', signingInput, keyObject, signature)
  } catch {
    return null
  }
  if (!valid) return null

  const iss = asString(payload.iss)
  if (!iss || !cfg.issuers.includes(iss)) return null
  const aud = payload.aud
  const audOk =
    typeof aud === 'string'
      ? cfg.audiences.includes(aud)
      : Array.isArray(aud) && aud.some((a) => typeof a === 'string' && cfg.audiences.includes(a))
  if (!audOk) return null
  const exp = typeof payload.exp === 'number' ? payload.exp : 0
  if (Math.floor(Date.now() / 1000) >= exp) return null
  const sub = asString(payload.sub)
  if (!sub) return null

  return { sub, email: asString(payload.email), name: asString(payload.name) }
}
