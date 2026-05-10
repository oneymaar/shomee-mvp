import type { LocationIntent } from '../searchStore'

const LIFESTYLE_KEYWORDS: Record<string, string[]> = {
  calme: ['calme', 'tranquille', 'paisible', 'résidentiel', 'quiet', 'serein'],
  animé: ['animé', 'vivant', 'dynamique', 'branché', 'festif', 'nightlife'],
  familial: ['familial', 'famille', 'enfants', 'école', 'sécurisé', 'sécurisée'],
  nature: ['nature', 'vert', 'parc', 'bois', 'jardin', 'forêt', 'verdure'],
  patrimoine: ['patrimoine', 'historique', 'haussmannien', 'ancien', 'charme'],
  lumineux: ['lumineux', 'ensoleillé', 'soleil', 'clair'],
  village: ['village', 'quartier de village', 'ambiance village', 'petit village'],
}

const TRANSPORT_PATTERNS: Array<{ pattern: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  { pattern: /ligne\s+(\d+|[A-E])/gi, extract: (m) => `ligne ${m[1]}` },
  { pattern: /m[eé]tro\s+(\d+)/gi, extract: (m) => `métro ${m[1]}` },
  { pattern: /rer\s+([A-E])/gi, extract: (m) => `RER ${m[1]}` },
  { pattern: /station\s+([\w\s-]+?)(?:\s|$|,)/gi, extract: (m) => `station ${m[1].trim()}` },
  { pattern: /tram(?:way)?\s+(\w+)/gi, extract: (m) => `tram ${m[1]}` },
]

const PROXIMITY_PATTERNS = [
  /(?:proche|près|à\s+côté)(?:\s+du?e?s?)?\s+([\w\s''-]+?)(?:\s*,|\s*$|\s+et\s)/gi,
  /autour\s+de\s+([\w\s''-]+?)(?:\s*,|\s*$|\s+et\s)/gi,
  /quartier\s+([\w\s''-]+?)(?:\s*,|\s*$|\s+et\s)/gi,
  /dans\s+le\s+([\w\s''-]+?)(?:\s*,|\s*$|\s+et\s)/gi,
  /à\s+\d+\s+min(?:utes?)?\s+de\s+([\w\s''-]+?)(?:\s*,|\s*$|\s+et\s)/gi,
]

const FRENCH_CITIES = [
  'paris', 'marseille', 'lyon', 'toulouse', 'nice', 'nantes', 'montpellier',
  'strasbourg', 'bordeaux', 'lille', 'rennes', 'reims', 'saint-étienne',
  'toulon', 'grenoble', 'dijon', 'angers', 'nîmes', 'villeurbanne', 'saint-denis',
  'le havre', 'clermont-ferrand', 'brest', 'tours', 'amiens', 'limoges',
  'perpignan', 'besançon', 'boulogne-billancourt', 'metz', 'nanterre',
  'versailles', 'argenteuil', 'rouen', 'montreuil', 'saint-paul', 'mulhouse',
  'roubaix', 'tourcoing', 'dunkerque', 'issy-les-moulineaux', 'neuilly-sur-seine',
  'la défense', 'vincennes', 'saint-cloud', 'levallois-perret', 'boulogne',
  'annecy', 'aix-en-provence', 'cannes', 'antibes', 'bayonne', 'pau',
  'avignon', 'poitiers', 'caen', 'lorient', 'calais', 'valenciennes',
]

const PARIS_ARRONDISSEMENTS = Array.from({ length: 20 }, (_, i) =>
  [`${i + 1}e`, `${i + 1}ème`, `paris ${i + 1}`, `75${String(i + 1).padStart(3, '0')}`]
).flat()

function extractTransportConstraints(text: string): string[] {
  const found: string[] = []
  for (const { pattern, extract } of TRANSPORT_PATTERNS) {
    const matches = [...text.matchAll(pattern)]
    for (const m of matches) found.push(extract(m))
  }
  return [...new Set(found)]
}

function extractLifestyleTerms(text: string): string[] {
  const lower = text.toLowerCase()
  const found: string[] = []
  for (const [category, keywords] of Object.entries(LIFESTYLE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) found.push(category)
  }
  return found
}

function extractLocationTerms(text: string): string[] {
  const terms: string[] = []
  const lower = text.toLowerCase()

  // Detect Paris arrondissements
  for (const arr of PARIS_ARRONDISSEMENTS) {
    if (lower.includes(arr)) {
      terms.push(arr)
    }
  }

  // Extract proximity patterns
  for (const pattern of PROXIMITY_PATTERNS) {
    const matches = [...text.matchAll(pattern)]
    for (const m of matches) {
      const term = m[1]?.trim()
      if (term && term.length > 1) terms.push(term)
    }
  }

  // Detect known French cities
  for (const city of FRENCH_CITIES) {
    if (lower.includes(city)) terms.push(city)
  }

  // If no terms found, treat the whole query as a location term
  if (terms.length === 0) {
    const cleaned = text.trim().replace(/[.,!?]/g, '')
    if (cleaned.length > 1) terms.push(cleaned)
  }

  return [...new Set(terms)]
}

function computeConfidence(text: string, locationTerms: string[], lifestyleTerms: string[], transportTerms: string[]): number {
  let score = 0.5

  // Boost for explicit location terms
  if (locationTerms.length > 0) score += 0.2
  if (locationTerms.some((t) => FRENCH_CITIES.includes(t.toLowerCase()))) score += 0.15
  if (locationTerms.some((t) => PARIS_ARRONDISSEMENTS.includes(t.toLowerCase()))) score += 0.15

  // Boost for transport constraints (user is specific)
  if (transportTerms.length > 0) score += 0.1

  // Slight boost for lifestyle terms (user is expressive)
  if (lifestyleTerms.length > 0) score += 0.05

  // Penalize very short queries
  if (text.trim().length < 5) score -= 0.3

  return Math.max(0, Math.min(1, score))
}

export function parseLocationIntent(query: string): LocationIntent {
  const text = query.trim()
  const location_terms = extractLocationTerms(text)
  const lifestyle_terms = extractLifestyleTerms(text)
  const transport_constraints = extractTransportConstraints(text)
  const confidence = computeConfidence(text, location_terms, lifestyle_terms, transport_constraints)

  return { location_terms, lifestyle_terms, transport_constraints, confidence }
}

/** Extract the best geocodable query from an intent */
export function intentToGeocodableQuery(query: string, intent: LocationIntent): string {
  // If we have explicit location terms, use them as geocoding input
  if (intent.location_terms.length > 0) {
    return intent.location_terms[0]
  }
  // Otherwise use the raw query
  return query
}
