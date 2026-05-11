/**
 * LocationEntityRecognizer — fast, local (no-network) recognition of transport
 * stations and semantic neighborhoods from raw user text.
 *
 * Used to:
 *   1. Show a structured chip ("🚇 Métro Blanche · ligne 2") in the UI.
 *   2. Detect ambiguous inputs (e.g. "Pigalle" = station + neighborhood)
 *      and prompt a disambiguation modal before opening the map.
 *   3. Bypass the LLM for clear station / neighborhood queries.
 *
 * Recognition order:
 *   1. Explicit transport prefix: "métro Blanche", "RER Nation", "tram Porte de Vincennes"
 *   2. Explicit transport suffix: "Blanche métro"
 *   3. Explicit neighborhood prefix: "quartier Batignolles"
 *   4. Direct normalized match in both DBs — returns ambiguity if both hit
 *   5. Substring match in neighborhoods (min 6 chars)
 */

import rawStations from '@/src/data/transportStations.json'
import rawNeighborhoods from '@/src/data/semanticNeighborhoods.json'
import type { LocationIntent } from '@/lib/searchStore'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RecognizedLocationEntity {
  id: string
  label: string
  type: 'metro_station' | 'rer_station' | 'tram_station' | 'transilien_station' | 'semantic_neighborhood' | 'administrative_area'
  displayLabel: string
  emoji: string
  lines?: string[]
  coordinates?: { lat: number; lng: number }
  confidence: number
}

// ─── Internal types (matching JSON shapes) ─────────────────────────────────

interface RawStation {
  id: string; label: string
  type: string; lines: string[]
  coordinates: { lat: number; lng: number }
  defaultRadiusMeters: number
}

interface RawNeighborhood {
  id: string; label: string; aliases: string[]
  arrondissement: string; center: { lat: number; lng: number }
}

// ─── Data + lookup maps ────────────────────────────────────────────────────

const STATIONS = rawStations as RawStation[]
const NEIGHBORHOODS = rawNeighborhoods as RawNeighborhood[]

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ'\-\s]+/g, '')
}

// Build at module init — O(1) lookups at runtime
const stationByNorm = new Map<string, RawStation>()
for (const s of STATIONS) stationByNorm.set(norm(s.label), s)

const neighborhoodByNorm = new Map<string, RawNeighborhood>()
for (const n of NEIGHBORHOODS) {
  neighborhoodByNorm.set(norm(n.label), n)
  for (const a of n.aliases) neighborhoodByNorm.set(norm(a), n)
}

// ─── Display helpers ───────────────────────────────────────────────────────

const EMOJIS: Record<string, string> = {
  metro_station: '🚇', rer_station: '🚆', tram_station: '🚊', transilien_station: '🚂',
}

const TYPE_LABELS: Record<string, string> = {
  metro_station: 'Métro', rer_station: 'RER', tram_station: 'Tram', transilien_station: 'Transilien',
}

function formatLines(lines: string[], type: string): string {
  if (!lines.length) return ''
  if (type === 'rer_station') return `RER ${lines.join(', ')}`
  return `ligne${lines.length > 1 ? 's' : ''} ${lines.join(', ')}`
}

function buildStation(s: RawStation, confidence: number): RecognizedLocationEntity {
  const type = s.type as RecognizedLocationEntity['type']
  const linesStr = formatLines(s.lines, s.type)
  return {
    id: s.id, label: s.label, type,
    displayLabel: linesStr
      ? `${TYPE_LABELS[type] ?? 'Station'} ${s.label} · ${linesStr}`
      : `${TYPE_LABELS[type] ?? 'Station'} ${s.label}`,
    emoji: EMOJIS[type] ?? '🚇',
    lines: s.lines,
    coordinates: s.coordinates,
    confidence,
  }
}

function buildNeighborhood(n: RawNeighborhood, confidence: number): RecognizedLocationEntity {
  const arr = n.arrondissement.split('/')[0].trim()
  return {
    id: n.id, label: n.label, type: 'semantic_neighborhood',
    displayLabel: `${n.label} · ${arr}`,
    emoji: '🏘',
    coordinates: n.center,
    confidence,
  }
}

// ─── Pattern matchers ──────────────────────────────────────────────────────

// "métro Blanche", "RER A", "station Nation", "tram Porte de Vincennes"
const PREFIX_RE = /^(m[eé]tro|rer|tram(?:way)?|station)\s+(.+)/i
// "Blanche métro", "Nation station"
const SUFFIX_RE = /^(.+)\s+(m[eé]tro|rer|tram(?:way)?|station)$/i
// "quartier Batignolles", "village Montmartre"
const NB_PREFIX_RE = /^(?:quartier|village)\s+(.+)/i

function stationByName(name: string): RawStation | null {
  const nName = norm(name)
  return stationByNorm.get(nName) ?? null
}

function neighborhoodByName(name: string): RawNeighborhood | null {
  const nName = norm(name)
  return neighborhoodByNorm.get(nName) ?? null
}

function neighborhoodBySubstring(q: string): RawNeighborhood | null {
  const qNorm = norm(q)
  if (qNorm.length < 6) return null
  for (const n of NEIGHBORHOODS) {
    const nl = norm(n.label)
    if (nl.length >= 6 && qNorm.includes(nl)) return n
    if (n.aliases.some((a) => { const na = norm(a); return na.length >= 6 && qNorm.includes(na) })) return n
  }
  return null
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Recognize a location entity from raw user text.
 *
 * Returns:
 *   RecognizedLocationEntity        — unambiguous single match
 *   [station, neighborhood]         — ambiguous (both DBs matched)
 *   null                            — no match, fall through to LLM
 */
export function recognizeLocationEntity(
  query: string,
): RecognizedLocationEntity | [RecognizedLocationEntity, RecognizedLocationEntity] | null {
  const q = query.trim()
  if (q.length < 2) return null

  // 1. Explicit transport prefix
  const pre = q.match(PREFIX_RE)
  if (pre) {
    const s = stationByName(pre[2].trim())
    if (s) return buildStation(s, 0.99)
  }

  // 2. Explicit transport suffix
  const suf = q.match(SUFFIX_RE)
  if (suf) {
    const s = stationByName(suf[1].trim())
    if (s) return buildStation(s, 0.99)
  }

  // 3. Explicit neighborhood prefix
  const nbPre = q.match(NB_PREFIX_RE)
  if (nbPre) {
    const n = neighborhoodByName(nbPre[1].trim()) ?? neighborhoodBySubstring(nbPre[1].trim())
    if (n) return buildNeighborhood(n, 0.99)
  }

  // 4. Direct normalized match in both DBs
  const qNorm = norm(q)
  const stMatch = stationByNorm.get(qNorm)
  const nbMatch = neighborhoodByNorm.get(qNorm)

  if (stMatch && nbMatch) {
    return [buildStation(stMatch, 0.85), buildNeighborhood(nbMatch, 0.85)]
  }
  if (stMatch) return buildStation(stMatch, 0.9)
  if (nbMatch) return buildNeighborhood(nbMatch, 0.9)

  // 5. Substring match in neighborhoods
  const nbSub = neighborhoodBySubstring(q)
  if (nbSub) return buildNeighborhood(nbSub, 0.75)

  return null
}

/**
 * Build a LocationIntent from a recognized entity, bypassing the LLM.
 * Stations get a transport_station geoConstraint.
 * Neighborhoods get an empty geoConstraints array — initMap will add the
 * semantic_neighborhood constraint via matchNeighborhood(locationQuery).
 */
export function entityToIntent(entity: RecognizedLocationEntity): LocationIntent {
  const isStation = entity.type !== 'semantic_neighborhood' && entity.type !== 'administrative_area'

  if (isStation) {
    return {
      location_terms: [],
      lifestyle_terms: [],
      transport_constraints: [],
      confidence: entity.confidence,
      geoConstraints: [{
        type: 'transport_station',
        label: entity.label,
        stationName: entity.label,
        operator: 'near',
        confidence: entity.confidence,
      }],
    }
  }

  // Neighborhood: set query = entity.label so matchNeighborhood picks it up in initMap
  return {
    location_terms: [],
    lifestyle_terms: [],
    transport_constraints: [],
    confidence: entity.confidence,
    geoConstraints: [],
  }
}
