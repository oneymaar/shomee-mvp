import { timingSafeEqual } from 'node:crypto'

/**
 * Garde « token applicatif OU origine web de confiance » (Session 2, Option A).
 * Distinct du bearer agent/MCP (`bearer.ts`) — les deux schémas coexistent.
 *
 * - Mobile (et intégrations) : envoient le header `x-shomee-app-token`.
 * - Web (PWA) : pas de token dans le bundle ; autorisé via l'allowlist d'Origin.
 *
 * Vit côté serveur (`apps/web`) — NE PART PAS dans @shomee/core.
 */

export type GuardResult =
  | { ok: true }
  | { ok: false; status: 401; body: { error: string } }

const DENY: GuardResult = { ok: false, status: 401, body: { error: 'Non autorisé' } }

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false // longueurs comparées avant timingSafeEqual
  return timingSafeEqual(ba, bb)
}

/** Token applicatif valide (timing-safe). Refuse si l'env n'est pas configurée. */
function tokenValid(req: Request): boolean {
  const expected = process.env.SHOMEE_APP_TOKEN
  if (!expected) return false
  const provided = req.headers.get('x-shomee-app-token')
  if (!provided) return false
  return safeEqual(provided, expected)
}

/**
 * Allowlist d'origines web — origines EXACTES uniquement, aucun wildcard :
 *   - `SHOMEE_WEB_ORIGINS` (CSV)
 *   - fallback localhost (dev)
 *   - URLs Vercel de CE déploiement : VERCEL_URL / VERCEL_BRANCH_URL /
 *     VERCEL_PROJECT_PRODUCTION_URL (injectées par Vercel)
 * PAS de filet `*.vercel.app` : un autre déploiement Vercel n'est pas autorisé,
 * même en preview. À ajouter au go-live : le domaine de prod final dans
 * `SHOMEE_WEB_ORIGINS`.
 */
function exactAllowed(): string[] {
  const csv = process.env.SHOMEE_WEB_ORIGINS
  const fromEnv = csv ? csv.split(',').map((s) => s.trim()).filter(Boolean) : []
  const fallback = ['http://localhost:3000', 'http://localhost:3001']
  const vercelSelf = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
  ]
    .filter((h): h is string => Boolean(h))
    .map((h) => `https://${h}`)
  return [...fromEnv, ...fallback, ...vercelSelf]
}

function originAllowed(origin: string | null): boolean {
  if (!origin) return false
  return exactAllowed().includes(origin)
}

/** Routes mortes (criteria/parse, criteria/update-importance, matching/score) :
 *  token applicatif OBLIGATOIRE, aucune exception d'origine. */
export function requireAppToken(req: Request): GuardResult {
  return tokenValid(req) ? { ok: true } : DENY
}

/** Routes web (feed/generate, criteria/analyze, location/analyze, location/geocode,
 *  properties) : token applicatif OU origine web autorisée.
 *  `allowReferer` (true uniquement pour /properties, GET nu) : si `Origin` est
 *  absent, retombe sur l'origine extraite du `Referer`. */
export function requireAppTokenOrTrustedOrigin(
  req: Request,
  opts: { allowReferer?: boolean } = {},
): GuardResult {
  if (tokenValid(req)) return { ok: true }
  if (originAllowed(req.headers.get('origin'))) return { ok: true }
  if (opts.allowReferer) {
    const referer = req.headers.get('referer')
    if (referer) {
      try {
        const u = new URL(referer)
        if (originAllowed(`${u.protocol}//${u.host}`)) return { ok: true }
      } catch {
        /* referer malformé → refus */
      }
    }
  }
  return DENY
}
