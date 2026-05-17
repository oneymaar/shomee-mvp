/**
 * SpatialIntentParser — deterministic extraction of spatial structure from a user query.
 *
 * Handles without any LLM:
 *   - "entre X et Y"           → between relation
 *   - "X côté bois/seine/…"    → edge_of relation (no cardinal direction emitted)
 *   - "proche X / près de X"   → near relation with radius
 *   - "sauf X / mais pas X"    → exclusion
 *   - commune names            → city entity with resolvedId (com-NNNNN)
 *   - arrondissements          → district entity with resolvedId (arr-N)
 *   - transport prefix         → transport_station entity
 *   - quartiers + neighborhoods → quartier entity
 *   - street prefixes          → street entity
 *
 * Sets requiresLLM=true for lifestyle/subjective vocabulary and unresolved entities.
 *
 * Does NOT touch geoConstraintService, IRIS resolution, or LLM.
 */

import rawStations from '@/src/data/transportStations.json'
import rawNeighborhoods from '@/src/data/semanticNeighborhoods.json'
import { matchQuartier } from '@/lib/services/quartierMatchingService'
import type { SpatialEntity, SpatialIntent, SpatialRelation } from './spatialTokens'

// ─── Internal JSON shapes ─────────────────────────────────────────────────────

interface RawStation {
  id: string
  label: string
  type: string
  lines: string[]
  coordinates?: { lat: number; lng: number }
}

interface RawNeighborhood {
  id: string
  label: string
  aliases: string[]
}

// ─── Normalization ────────────────────────────────────────────────────────────

// Strip accents, lowercase, keep spaces — for regex pattern matching.
function normalizeForParsing(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''ʼ]/g, "'")
    .trim()
}

// Strip accents + ALL separators — for key lookups in maps.
function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-\s''ʼ]+/g, '')
    .trim()
}

// ─── Commune ID map ───────────────────────────────────────────────────────────
// Static from the LLM system prompt coverage list (analyze/route.ts lines 21-23).

const COMMUNE_ID_MAP: Record<string, { id: string; label: string }> = {
  // Hauts-de-Seine (92)
  neuilly:              { id: 'com-92050', label: 'Neuilly-sur-Seine' },
  neuillysursteine:     { id: 'com-92050', label: 'Neuilly-sur-Seine' },
  levallois:            { id: 'com-92044', label: 'Levallois-Perret' },
  levalloisperret:      { id: 'com-92044', label: 'Levallois-Perret' },
  boulogne:             { id: 'com-92012', label: 'Boulogne-Billancourt' },
  boulognebillancourt:  { id: 'com-92012', label: 'Boulogne-Billancourt' },
  puteaux:              { id: 'com-92062', label: 'Puteaux' },
  courbevoie:           { id: 'com-92026', label: 'Courbevoie' },
  issy:                 { id: 'com-92040', label: 'Issy-les-Moulineaux' },
  issylesmoulineaux:    { id: 'com-92040', label: 'Issy-les-Moulineaux' },
  montrouge:            { id: 'com-92049', label: 'Montrouge' },
  clichy:               { id: 'com-92024', label: 'Clichy' },
  malakoff:             { id: 'com-92046', label: 'Malakoff' },
  vanves:               { id: 'com-92075', label: 'Vanves' },
  meudon:               { id: 'com-92048', label: 'Meudon' },
  sevres:               { id: 'com-92071', label: 'Sèvres' },
  // Seine-Saint-Denis (93)
  saintdenis:           { id: 'com-93066', label: 'Saint-Denis' },
  saintouen:            { id: 'com-93070', label: 'Saint-Ouen' },
  aubervilliers:        { id: 'com-93001', label: 'Aubervilliers' },
  pantin:               { id: 'com-93055', label: 'Pantin' },
  montreuil:            { id: 'com-93048', label: 'Montreuil' },
  bagnolet:             { id: 'com-93006', label: 'Bagnolet' },
  leslilas:             { id: 'com-93045', label: 'Les Lilas' },
  // Val-de-Marne (94)
  vincennes:            { id: 'com-94078', label: 'Vincennes' },
  saintmande:           { id: 'com-94067', label: 'Saint-Mandé' },
  charenton:            { id: 'com-94018', label: 'Charenton-le-Pont' },
  charentonlepont:      { id: 'com-94018', label: 'Charenton-le-Pont' },
  ivry:                 { id: 'com-94041', label: 'Ivry-sur-Seine' },
  ivrysursteine:        { id: 'com-94041', label: 'Ivry-sur-Seine' },
  gentilly:             { id: 'com-94037', label: 'Gentilly' },
  alfortville:          { id: 'com-94002', label: 'Alfortville' },
  maisonsalfort:        { id: 'com-94046', label: 'Maisons-Alfort' },
}

// ─── "Côté" expansions ────────────────────────────────────────────────────────
// Maps a short reference word to the canonical POI name + default proximity radius.
// NEVER produces a cardinal direction — always edge_of.

const COTE_EXPANSIONS: Record<string, { label: string; targetType: string; radiusM: number }> = {
  bois:              { label: 'Bois de Boulogne',      targetType: 'poi', radiusM: 300 },
  boisdeboulogne:    { label: 'Bois de Boulogne',      targetType: 'poi', radiusM: 300 },
  boisdevincennes:   { label: 'Bois de Vincennes',     targetType: 'poi', radiusM: 300 },
  seine:             { label: 'Seine',                 targetType: 'poi', radiusM: 200 },
  canal:             { label: 'Canal Saint-Martin',    targetType: 'poi', radiusM: 250 },
  canalsaintmartin:  { label: 'Canal Saint-Martin',    targetType: 'poi', radiusM: 250 },
  parc:              { label: 'parc',                  targetType: 'poi', radiusM: 300 },
  foret:             { label: 'forêt',                 targetType: 'poi', radiusM: 400 },
  marne:             { label: 'Marne',                 targetType: 'poi', radiusM: 200 },
  periph:            { label: 'Boulevard Périphérique',targetType: 'poi', radiusM: 200 },
  peripherique:      { label: 'Boulevard Périphérique',targetType: 'poi', radiusM: 200 },
  lac:               { label: 'lac',                   targetType: 'poi', radiusM: 300 },
}

// ─── Street/way prefix ────────────────────────────────────────────────────────

const STREET_PREFIX_RE = /^(avenue|av\.|rue|boulevard|bd\.|place|pl\.|square|allee|chemin|impasse|passage|cour|quai|voie|route|promenade|villa|cite|residence|esplanade|parvis|terrasse|galerie|venelle|sentier|ruelle|port|pont)\s+/i

// ─── Lifestyle / subjective vocabulary ───────────────────────────────────────
// These words signal that the query requires LLM semantic understanding.

const LIFESTYLE_RE = /\b(bobo|branch[eé]?|ambiance|vivant|anim[eé]?|calme|familial|cosy|craignos|sympa(?:thique)?|chic|hype|trendy|populaire|boh[eè]me|dynamique|tranquille|convivial|villageois|un\s+peu|pas\s+trop|coin\s+(un|assez|trop)|atmosphere|atmosh?p[eè]re)\b/i

// ─── Lookup maps (built once at module init) ──────────────────────────────────

const stationByNorm = new Map<string, RawStation>()
for (const s of rawStations as RawStation[]) {
  const k = normKey(s.label)
  if (!stationByNorm.has(k)) stationByNorm.set(k, s)
}

const neighborhoodByNorm = new Map<string, RawNeighborhood>()
for (const n of rawNeighborhoods as RawNeighborhood[]) {
  neighborhoodByNorm.set(normKey(n.label), n)
  for (const a of n.aliases) {
    const k = normKey(a)
    if (!neighborhoodByNorm.has(k)) neighborhoodByNorm.set(k, n)
  }
}

// ─── Entity resolution ────────────────────────────────────────────────────────

function resolveEntity(rawText: string): SpatialEntity {
  const norm = normalizeForParsing(rawText.trim())
  const key = normKey(rawText.trim())

  // 1. Street/way prefix → type street (no further resolution needed)
  if (STREET_PREFIX_RE.test(norm)) {
    return { rawText, normalizedText: norm, type: 'street', confidence: 0.95 }
  }

  // 2. Arrondissement patterns: "11e", "11ème", "Paris 11", "1er", "premier"
  const arrMatch = norm.match(/^(?:paris\s+)?(\d{1,2})(?:e(?:m(?:e)?)?|er)?$/)
  if (arrMatch) {
    const num = parseInt(arrMatch[1], 10)
    if (num >= 1 && num <= 20) {
      return {
        rawText, normalizedText: norm,
        type: 'district',
        resolvedId: `arr-${num}`,
        label: num === 1 ? 'Paris 1er' : `Paris ${num}e`,
        confidence: 0.98,
      }
    }
  }

  // 3. Commune lookup (hardcoded coverage list from analyze/route.ts)
  const commune = COMMUNE_ID_MAP[key]
  if (commune) {
    return { rawText, normalizedText: norm, type: 'city', resolvedId: commune.id, label: commune.label, confidence: 0.95 }
  }

  // 4. Explicit transport prefix: "métro X", "RER X", "tram X"
  const tpMatch = norm.match(/^(?:metro|rer|tram(?:way)?|station)\s+(.+)$/)
  if (tpMatch) {
    const stKey = normKey(tpMatch[1])
    const s = stationByNorm.get(stKey)
    if (s) {
      return { rawText, normalizedText: norm, type: 'transport_station', resolvedId: s.id, label: s.label, confidence: 0.99 }
    }
    // Prefix present but station not found → still clearly a transport entity
    return { rawText, normalizedText: norm, type: 'transport_station', label: tpMatch[1], confidence: 0.7 }
  }

  // 5. Quartier exact match (quartiers.json — includes irisNames)
  const qtMatch = matchQuartier(rawText.trim())
  if (qtMatch && qtMatch.method === 'exact') {
    return {
      rawText, normalizedText: norm,
      type: 'quartier',
      resolvedId: qtMatch.quartier.id,
      label: qtMatch.quartier.name,
      confidence: 0.95,
    }
  }

  // 6. Semantic neighborhood exact match (richer metadata: center, vibeTags…)
  const nb = neighborhoodByNorm.get(key)
  if (nb) {
    return { rawText, normalizedText: norm, type: 'quartier', resolvedId: nb.id, label: nb.label, confidence: 0.90 }
  }

  // 7. Station exact match — only when no neighborhood matched (bare name = station)
  const st = stationByNorm.get(key)
  if (st) {
    return { rawText, normalizedText: norm, type: 'transport_station', resolvedId: st.id, label: st.label, confidence: 0.85 }
  }

  // 8. Quartier fuzzy/contains fallback (handles typos)
  if (qtMatch && qtMatch.confidence >= 0.65) {
    return {
      rawText, normalizedText: norm,
      type: 'quartier',
      resolvedId: qtMatch.quartier.id,
      label: qtMatch.quartier.name,
      confidence: qtMatch.confidence * 0.85,
    }
  }

  return { rawText, normalizedText: norm, type: 'unknown', confidence: 0 }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a raw user query into a structured SpatialIntent without any LLM call.
 *
 * Sets requiresLLM=true if:
 *   - Lifestyle/subjective vocabulary is detected
 *   - Any entity could not be resolved (type === 'unknown')
 */
export function parseSpatialIntent(rawQuery: string): SpatialIntent {
  const normalizedQuery = normalizeForParsing(rawQuery.trim())

  // ── 1. BETWEEN: "entre X et Y" ─────────────────────────────────────────────
  const betweenMatch = normalizedQuery.match(/^entre\s+(.+?)\s+et\s+(.+)$/)
  if (betweenMatch) {
    const e1 = resolveEntity(betweenMatch[1].trim())
    const e2 = resolveEntity(betweenMatch[2].trim())
    const requiresLLM = e1.type === 'unknown' || e2.type === 'unknown'
    return {
      rawQuery, normalizedQuery,
      primaryEntities: [e1, e2],
      spatialRelations: [{ type: 'between', confidence: 0.95 }],
      exclusions: [],
      requiresLLM,
      confidence: Math.min(e1.confidence, e2.confidence) * 0.95,
    }
  }

  // ── 2. Extract EXCLUSIONS (greedy suffix) ───────────────────────────────────
  // Matches: "sauf X", "mais pas X", "hors X" at the end of the query.
  let workingQuery = normalizedQuery
  const exclusions: SpatialEntity[] = []

  const EXCL_RE = /\s+(?:sauf|mais\s+pas|hors)\s+(.+)$/
  const exclMatch = workingQuery.match(EXCL_RE)
  if (exclMatch) {
    exclusions.push(resolveEntity(exclMatch[1].trim()))
    workingQuery = workingQuery.slice(0, exclMatch.index!).trim()
  }

  // ── 3. CÔTÉ: "[entity] côté [reference]" ───────────────────────────────────
  // IMPORTANT: "côté" is NEVER converted to a cardinal direction.
  // After normalizeForParsing, "côté" → "cote".
  const coteMatch = workingQuery.match(/^(.+?)\s+cote\s+(.+)$/)
  if (coteMatch) {
    const primaryEntity = resolveEntity(coteMatch[1].trim())
    const coteKey = normKey(coteMatch[2].trim())
    const expansion = COTE_EXPANSIONS[coteKey]

    const relation: SpatialRelation = expansion
      ? { type: 'edge_of', targetText: expansion.label, targetType: expansion.targetType, radiusM: expansion.radiusM, confidence: 0.90 }
      : { type: 'edge_of', targetText: coteMatch[2].trim(), targetType: 'poi', radiusM: 300, confidence: 0.70 }

    return {
      rawQuery, normalizedQuery,
      primaryEntities: [primaryEntity],
      spatialRelations: [relation],
      exclusions,
      requiresLLM: primaryEntity.type === 'unknown',
      confidence: primaryEntity.confidence * relation.confidence,
    }
  }

  // ── 3b. INLINE PROXIMITY: "[entity] proche/près [reference]" ─────────────────
  // Handles "neuilly proche bois", "16e proche bois", "boulogne proche canal"…
  // Only auto-resolves when the reference is in COTE_EXPANSIONS (known geographic
  // anchors). All other targets (metro, station, centre…) fall through to the LLM.
  // Uses edge_of semantics so the adapter emits the correct primary(inside) + poi(near).
  const INLINE_PROX_RE = /^(.+?)\s+(?:proche|pres)\s+(?:du\s+|de\s+la?\s+|des\s+|de\s+l[']\s*)?(.+)$/
  const inlineProxMatch = workingQuery.match(INLINE_PROX_RE)
  if (inlineProxMatch) {
    const refKey = normKey(inlineProxMatch[2].trim())
    const expansion = COTE_EXPANSIONS[refKey]
    if (expansion) {
      const primaryEntity = resolveEntity(inlineProxMatch[1].trim())
      const relation: SpatialRelation = {
        type: 'edge_of',
        targetText: expansion.label,
        targetType: expansion.targetType,
        radiusM: expansion.radiusM,
        confidence: 0.88,
      }
      return {
        rawQuery, normalizedQuery,
        primaryEntities: [primaryEntity],
        spatialRelations: [relation],
        exclusions,
        requiresLLM: primaryEntity.type === 'unknown',
        confidence: primaryEntity.confidence * relation.confidence,
      }
    }
  }

  // ── 4. PROXIMITY patterns ───────────────────────────────────────────────────
  const PROXIMITY_PATTERNS: Array<{ re: RegExp; radiusM: number }> = [
    { re: /^a\s+deux\s+pas\s+(?:de\s+)?(.+)$/,    radiusM: 100 },
    { re: /^proche\s+(?:de\s+)?(.+)$/,             radiusM: 100 },
    { re: /^pres\s+(?:de\s+)?(.+)$/,               radiusM: 150 },
    { re: /^a\s+cote\s+(?:de\s+)?(.+)$/,           radiusM: 150 },
  ]

  for (const { re, radiusM } of PROXIMITY_PATTERNS) {
    const m = workingQuery.match(re)
    if (m) {
      const target = m[1].trim()
      const entity = resolveEntity(target)
      return {
        rawQuery, normalizedQuery,
        primaryEntities: [entity],
        spatialRelations: [{ type: 'near', targetText: target, radiusM, confidence: 0.92 }],
        exclusions,
        requiresLLM: entity.type === 'unknown',
        confidence: entity.confidence * 0.92,
      }
    }
  }

  // ── 5. Lifestyle / subjective vocabulary ───────────────────────────────────
  if (LIFESTYLE_RE.test(normalizedQuery)) {
    return {
      rawQuery, normalizedQuery,
      primaryEntities: [],
      spatialRelations: [],
      exclusions: [],
      requiresLLM: true,
      confidence: 0.1,
    }
  }

  // ── 6. Direct entity resolution ────────────────────────────────────────────
  const entity = resolveEntity(workingQuery)

  return {
    rawQuery, normalizedQuery,
    primaryEntities: [entity],
    spatialRelations: [],
    exclusions,
    requiresLLM: entity.type === 'unknown',
    confidence: entity.confidence,
  }
}
