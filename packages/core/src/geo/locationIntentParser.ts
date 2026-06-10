import type { LocationIntent } from '../stores/searchStore'

const LIFESTYLE_KEYWORDS: Record<string, string[]> = {
  calme: ['calme', 'tranquille', 'paisible', 'résidentiel', 'serein'],
  animé: ['animé', 'vivant', 'dynamique', 'branché', 'festif'],
  familial: ['familial', 'famille', 'enfants', 'école', 'sécurisé'],
  nature: ['nature', 'vert', 'parc', 'bois', 'jardin', 'forêt', 'verdure'],
  patrimoine: ['patrimoine', 'historique', 'haussmannien', 'ancien', 'charme'],
  lumineux: ['lumineux', 'ensoleillé', 'soleil', 'clair'],
  village: ['village', 'ambiance village', 'petit village'],
}

const TRANSPORT_PATTERNS: Array<{ pattern: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  { pattern: /ligne\s+(\d+|[A-Ea-e])/g, extract: (m) => `ligne ${m[1]}` },
  { pattern: /m[eé]tro\s+(\d+)/g, extract: (m) => `métro ${m[1]}` },
  { pattern: /rer\s+([A-Ea-e])/g, extract: (m) => `RER ${m[1].toUpperCase()}` },
  { pattern: /tram(?:way)?\s+(\w+)/g, extract: (m) => `tram ${m[1]}` },
]

// Roman numeral → arabic
const ROMAN_TO_NUM: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
}

function parseParisArrondissement(text: string): string[] {
  const found: string[] = []
  const lower = text.toLowerCase()

  // "Paris 11", "Paris 11e", "Paris 11ème", "Paris 11er"
  const numPattern = /paris\s+(\d{1,2})(?:e|ème|eme|er)?/g
  for (const m of lower.matchAll(numPattern)) {
    const n = parseInt(m[1])
    if (n >= 1 && n <= 20) found.push(`Paris ${n}e`)
  }

  // "11e arrondissement", "11ème arrondissement"
  const arrPattern = /(\d{1,2})(?:e|ème|eme|er)?\s*(?:arr(?:ondissement)?)/g
  for (const m of lower.matchAll(arrPattern)) {
    const n = parseInt(m[1])
    if (n >= 1 && n <= 20) found.push(`Paris ${n}e`)
  }

  // Roman numerals: "Paris XI", "Paris XIe", "Xe arrondissement"
  const romanPattern = /paris\s+(x{0,3}(?:ix|iv|v?i{0,3}))/g
  for (const m of lower.matchAll(romanPattern)) {
    const n = ROMAN_TO_NUM[m[1].toLowerCase()]
    if (n) found.push(`Paris ${n}e`)
  }

  return [...new Set(found)]
}

function extractTransportConstraints(text: string): string[] {
  const found: string[] = []
  for (const { pattern, extract } of TRANSPORT_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags)
    for (const m of text.matchAll(re)) found.push(extract(m))
  }
  return [...new Set(found)]
}

function extractLifestyleTerms(text: string): string[] {
  const lower = text.toLowerCase()
  return Object.entries(LIFESTYLE_KEYWORDS)
    .filter(([, keywords]) => keywords.some((kw) => lower.includes(kw)))
    .map(([category]) => category)
}

const KNOWN_PLACES = [
  'vincennes', 'saint-mandé', 'saint mande', 'neuilly', 'levallois', 'boulogne',
  'issy', 'montreuil', 'charenton', 'nogent', 'fontenay', 'joinville',
  'saint-maur', 'saint maur', 'bagnolet', 'pantin', 'aubervilliers',
  'montrouge', 'malakoff', 'vanves', 'clichy', 'saint-ouen', 'saint ouen',
  'ivry', 'gentilly', 'les lilas',
  'nation', 'bastille', 'montmartre', 'pigalle', 'marais', 'saint-germain',
  'montparnasse', 'batignolles', 'belleville', 'oberkampf', 'daumesnil', 'bercy',
  'invalides', 'passy', 'auteuil', 'trocadero', 'madeleine', 'opéra',
  'buttes-chaumont', 'la villette', 'canal saint martin', 'gare du nord',
  'gobelins', "place d'italie", 'alésia', 'pernety', 'aligre',
]

function extractKnownPlaces(text: string): string[] {
  const lower = text.toLowerCase()
  return KNOWN_PLACES.filter((place) => lower.includes(place))
}

const PROXIMITY_PATTERNS = [
  /(?:proche|près|à\s+côté)(?:\s+du?e?s?)?\s+([\w\s''-]+?)(?:\s*[,.]|\s*$)/gi,
  /autour\s+de\s+([\w\s''-]+?)(?:\s*[,.]|\s*$)/gi,
  /quartier\s+([\w\s''-]+?)(?:\s*[,.]|\s*$)/gi,
  /dans\s+le\s+([\w\s''-]+?)(?:\s*[,.]|\s*$)/gi,
  /à\s+\d+\s+min(?:utes?)?\s+de\s+([\w\s''-]+?)(?:\s*[,.]|\s*$)/gi,
]

function extractProximityTerms(text: string): string[] {
  const terms: string[] = []
  for (const pattern of PROXIMITY_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags)
    for (const m of text.matchAll(re)) {
      const term = m[1]?.trim()
      if (term && term.length > 1 && !['le', 'la', 'du', 'de', 'un', 'une'].includes(term.toLowerCase())) {
        terms.push(term)
      }
    }
  }
  return terms
}

function computeConfidence(locationTerms: string[], lifestyleTerms: string[], transportTerms: string[], rawQuery: string): number {
  let score = 0.4
  if (locationTerms.length > 0) score += 0.25
  if (locationTerms.some((t) => /paris\s*\d/i.test(t))) score += 0.15
  if (transportTerms.length > 0) score += 0.1
  if (lifestyleTerms.length > 0) score += 0.05
  if (rawQuery.trim().length < 4) score -= 0.35
  return Math.max(0, Math.min(1, score))
}

export function parseLocationIntent(query: string): LocationIntent {
  const text = query.trim()

  const parisArr = parseParisArrondissement(text)
  const knownPlaces = extractKnownPlaces(text)
  const proximity = extractProximityTerms(text)

  // Combine — deduplicate by value
  const location_terms = [...new Set([...parisArr, ...knownPlaces, ...proximity])]
  const lifestyle_terms = extractLifestyleTerms(text)
  const transport_constraints = extractTransportConstraints(text)
  const confidence = computeConfidence(location_terms, lifestyle_terms, transport_constraints, text)

  return { location_terms, lifestyle_terms, transport_constraints, confidence }
}

/** Return the best single query to geocode from an intent */
export function intentToGeocodableQuery(query: string, intent: LocationIntent): string {
  if (intent.location_terms.length > 0) return intent.location_terms[0]
  return query.trim()
}
