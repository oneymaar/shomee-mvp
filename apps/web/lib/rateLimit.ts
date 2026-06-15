/**
 * Rate-limit in-memory : NON partagé entre instances serverless Vercel, remis à
 * zéro à chaque cold start. Suffisant pour le stade MVP non-public. AVANT
 * soumission App Store : migrer vers Vercel KV / Upstash pour un rate-limit
 * distribué (prérequis).
 *
 * Fenêtre glissante par IP. Appliqué aux routes coûteuses (appels Claude /
 * Nominatim) AVANT le travail coûteux.
 */

const WINDOW_MS = 60_000 // fenêtre glissante
const MAX_REQUESTS = 20 // plafond par IP et par fenêtre (ajustable)

const hits = new Map<string, number[]>()

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return 'unknown' // clé neutre si l'IP n'est pas disponible (dev local)
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; status: 429; headers: Record<string, string>; body: { error: string } }

export function checkRateLimit(req: Request): RateLimitResult {
  const ip = clientIp(req)
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)

  if (recent.length >= MAX_REQUESTS) {
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - recent[0])) / 1000))
    return {
      ok: false,
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
      body: { error: 'Trop de requêtes, réessayez plus tard.' },
    }
  }

  recent.push(now)
  hits.set(ip, recent)
  return { ok: true }
}
