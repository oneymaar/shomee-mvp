/**
 * Shomee — semantic hint resolver.
 *
 * Maps the free-form `semantic_hint` strings produced by the parser
 * ("lumineux", "ambiance cocon", …) to one of the precomputed score
 * dimensions on a property. Matching is case- and accent-insensitive,
 * and falls back to substring inclusion so hints longer than a single
 * keyword ("salon lumineux orienté ouest") still resolve.
 */

import type { PropertySemanticScores } from './types'

type SemanticKey = keyof PropertySemanticScores

/**
 * Canonical hint → score-key table. Keys are pre-normalised (lowercased,
 * accent-stripped, single-spaced). Order does not matter; lookups are
 * O(1) for exact matches and O(n) for substring fallback.
 */
const SEMANTIC_MAP: Record<string, SemanticKey> = {
  // luminosity
  'lumineux': 'luminosity',
  'lumineuse': 'luminosity',
  'luminosite': 'luminosity',
  'clarte': 'luminosity',
  'baigne de lumiere': 'luminosity',
  'ensoleille': 'luminosity',

  // quietness
  'calme': 'quietness',
  'silencieux': 'quietness',
  'silencieuse': 'quietness',
  'tranquille': 'quietness',
  'au calme': 'quietness',
  'sur cour': 'quietness',
  'cour interieure': 'quietness',

  // charm
  'cachet': 'charm',
  'caractere': 'charm',
  'avec du charme': 'charm',
  'charmant': 'charm',
  'plein de charme': 'charm',
  'ame': 'charm',
  'authentique': 'charm',
  'parquet': 'charm',
  'moulures': 'charm',
  'cheminee': 'charm',

  // spaciousness
  'grand volume': 'spaciousness',
  'beaux volumes': 'spaciousness',
  'volume': 'spaciousness',
  'spacieux': 'spaciousness',
  'spacieuse': 'spaciousness',
  'aere': 'spaciousness',
  'hauteur sous plafond': 'spaciousness',

  // living quality
  'belle piece de vie': 'living_quality',
  'piece a vivre': 'living_quality',
  'salon agreable': 'living_quality',
  'bien agencé': 'living_quality',
  'fonctionnel': 'living_quality',

  // outdoor usability
  'exterieur exploitable': 'outdoor_usability',
  'exterieur': 'outdoor_usability',
  'terrasse exploitable': 'outdoor_usability',
  'balcon exploitable': 'outdoor_usability',
}

/**
 * Resolve a semantic hint to the matching score key, or `null` if no
 * mapping is found. Exact-normalized match wins; otherwise the longest
 * key that appears as a substring of the normalised hint wins. The
 * longest-match preference keeps multi-word keys ("beaux volumes")
 * from being short-circuited by their substrings ("volume").
 */
export function resolveSemanticKey(hint: string): SemanticKey | null {
  const normalized = normalizeHint(hint)
  if (!normalized) return null

  // Exact match
  const exact = SEMANTIC_MAP[normalized]
  if (exact) return exact

  // Substring fallback — pick the longest matching key so the most
  // specific mapping wins.
  let bestKey: string | null = null
  let bestLen = 0
  for (const key of Object.keys(SEMANTIC_MAP)) {
    if (key.length > bestLen && normalized.includes(key)) {
      bestKey = key
      bestLen = key.length
    }
  }
  return bestKey ? SEMANTIC_MAP[bestKey] : null
}

/**
 * Normalise a hint string for lookup: lowercase, NFD-decompose, strip
 * combining diacritics, collapse non-alphanumerics to single spaces.
 */
export function normalizeHint(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export type { SemanticKey }
