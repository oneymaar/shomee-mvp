/**
 * QuartierMatchingService — robust fuzzy matching against the Paris quartiers DB.
 *
 * Pipeline (in order, returns on first hit above threshold):
 *   1. Normalize query (lowercase, strip accents/punct, collapse separators)
 *   2. Exact normalized match on name or any alias
 *   3. Contains / prefix match (query fully contains a quartier token ≥ 5 chars)
 *   4. Levenshtein fuzzy match (threshold: ≤25% of candidate length, min 1 char)
 *
 * Intentionally generic — no per-quartier rules, works for the whole DB.
 */

import rawQuartiers from '../data/quartiers.json'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Quartier {
  id: string
  name: string
  aliases: string[]
  city: string
  irisNames: string[]
  irisIds?: string[]  // exact IRIS zone IDs (iris-NNNNNNNNN) — unambiguous, takes priority over irisNames
}

export const QUARTIERS = rawQuartiers as Quartier[]

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Canonical normalization for matching:
 *   - lowercase
 *   - strip diacritics (é→e, â→a, ç→c …)
 *   - apostrophes, hyphens, right-quotes → space
 *   - collapse multiple spaces
 *   - trim
 *
 * Applied identically to both query and candidate so both sides are comparable.
 */
export function normalizeQ(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')      // strip combining diacritics
    .replace(/['’ʼ\-]/g, ' ')   // apostrophe / hyphen → space
    .replace(/[^a-z0-9 ]/g, '')           // strip remaining punctuation
    .replace(/\s+/g, ' ')                 // collapse spaces
    .trim()
}

// ─── Levenshtein distance (O(m·n), pure TypeScript, no deps) ─────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const prev = Array.from({ length: n + 1 }, (_, i) => i)
  const curr = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1])
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]
  }
  return prev[n]
}

// ─── Pre-computed lookup maps (built once at module init) ─────────────────────

const exactMap = new Map<string, Quartier>()    // normalized name/alias → quartier
const tokenList: Array<{ token: string; quartier: Quartier }> = []

for (const q of QUARTIERS) {
  const normName = normalizeQ(q.name)
  exactMap.set(normName, q)
  tokenList.push({ token: normName, quartier: q })

  for (const alias of q.aliases) {
    const normAlias = normalizeQ(alias)
    if (!exactMap.has(normAlias)) exactMap.set(normAlias, q)
    tokenList.push({ token: normAlias, quartier: q })
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface QuartierMatch {
  quartier: Quartier
  confidence: number   // 0–1
  method: 'exact' | 'contains' | 'fuzzy'
}

/**
 * Match a user query to the best Paris quartier.
 * Returns null if nothing is found above the minimum confidence threshold.
 */
export function matchQuartier(query: string): QuartierMatch | null {
  const q = normalizeQ(query.trim())
  if (q.length < 3) return null

  // ── 1. Exact normalized match ──────────────────────────────────────────────
  const exact = exactMap.get(q)
  if (exact) return { quartier: exact, confidence: 1.0, method: 'exact' }

  // ── 2. Query contains a known token (min 5 chars to avoid "le", "la" noise) ─
  //    e.g. "marché d'aligre" contains "aligre"
  for (const { token, quartier } of tokenList) {
    if (token.length >= 5 && q.includes(token)) {
      return { quartier, confidence: 0.88, method: 'contains' }
    }
  }
  // Also: token contains query (query is a prefix of a longer name, min 5)
  if (q.length >= 5) {
    for (const { token, quartier } of tokenList) {
      if (token.startsWith(q) && token.length >= q.length) {
        return { quartier, confidence: 0.82, method: 'contains' }
      }
    }
  }

  // ── 3. Fuzzy match via Levenshtein ─────────────────────────────────────────
  //    Threshold: ≤25% of candidate length (e.g. "picalle" vs "pigalle" = 1 edit in 7)
  //    Only attempted for queries ≥ 4 chars to avoid trivial false positives.
  if (q.length < 4) return null

  let bestDist = Infinity
  let bestQuartier: Quartier | null = null

  for (const { token, quartier } of tokenList) {
    if (Math.abs(token.length - q.length) > Math.ceil(token.length * 0.35)) continue // fast skip
    const dist = levenshtein(q, token)
    const threshold = Math.max(1, Math.floor(token.length * 0.25))
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist
      bestQuartier = quartier
    }
  }

  if (bestQuartier) {
    const longerLen = Math.max(q.length, normalizeQ(bestQuartier.name).length)
    const confidence = Math.max(0.55, 1 - bestDist / longerLen)
    if (confidence >= 0.6) return { quartier: bestQuartier, confidence, method: 'fuzzy' }
  }

  return null
}

/** Look up a quartier by exact ID. */
export function findQuartierById(id: string): Quartier | null {
  return QUARTIERS.find(q => q.id === id) ?? null
}

/**
 * Normalize an IRIS name for case/accent-insensitive lookup.
 * Used by geoConstraintService to match irisNames against loaded GeoZone names.
 */
export function normalizeIrisName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}
