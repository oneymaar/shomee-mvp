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
// INSEE codes verified against geo.api.gouv.fr (May 2026).
// normKey(commune_name) → { id: "com-INSEE", label }

const COMMUNE_ID_MAP: Record<string, { id: string; label: string }> = {
  // ── Hauts-de-Seine (92) ──────────────────────────────────────────────────
  asnieres:             { id: 'com-92004', label: 'Asnières-sur-Seine' },
  asnieresurseine:      { id: 'com-92004', label: 'Asnières-sur-Seine' },
  boulogne:             { id: 'com-92012', label: 'Boulogne-Billancourt' },
  boulognebillancourt:  { id: 'com-92012', label: 'Boulogne-Billancourt' },
  clichy:               { id: 'com-92024', label: 'Clichy' },
  colombes:             { id: 'com-92025', label: 'Colombes' },
  courbevoie:           { id: 'com-92026', label: 'Courbevoie' },
  fontenayauxroses:     { id: 'com-92032', label: 'Fontenay-aux-Roses' },
  gennevilliers:        { id: 'com-92036', label: 'Gennevilliers' },
  issy:                 { id: 'com-92040', label: 'Issy-les-Moulineaux' },
  issylesmoulineaux:    { id: 'com-92040', label: 'Issy-les-Moulineaux' },
  levallois:            { id: 'com-92044', label: 'Levallois-Perret' },
  levalloisperret:      { id: 'com-92044', label: 'Levallois-Perret' },
  malakoff:             { id: 'com-92046', label: 'Malakoff' },
  meudon:               { id: 'com-92048', label: 'Meudon' },
  montrouge:            { id: 'com-92049', label: 'Montrouge' },
  // 92050 = Nanterre (NOT Neuilly — was wrong before this fix!)
  nanterre:             { id: 'com-92050', label: 'Nanterre' },
  // 92051 = Neuilly-sur-Seine (correct code)
  neuilly:              { id: 'com-92051', label: 'Neuilly-sur-Seine' },
  neuillysursteine:     { id: 'com-92051', label: 'Neuilly-sur-Seine' },
  puteaux:              { id: 'com-92062', label: 'Puteaux' },
  rueil:                { id: 'com-92063', label: 'Rueil-Malmaison' },
  rueilmalmaison:       { id: 'com-92063', label: 'Rueil-Malmaison' },
  saintcloud:           { id: 'com-92064', label: 'Saint-Cloud' },
  suresnes:             { id: 'com-92073', label: 'Suresnes' },
  vanves:               { id: 'com-92075', label: 'Vanves' },
  // 92072 = Sèvres (92071 = Sceaux — was wrong before this fix!)
  sevres:               { id: 'com-92072', label: 'Sèvres' },
  // ── Seine-Saint-Denis (93) ───────────────────────────────────────────────
  aubervilliers:        { id: 'com-93001', label: 'Aubervilliers' },
  aulnay:               { id: 'com-93005', label: 'Aulnay-sous-Bois' },
  aulnaysousbois:       { id: 'com-93005', label: 'Aulnay-sous-Bois' },
  bagnolet:             { id: 'com-93006', label: 'Bagnolet' },
  bobigny:              { id: 'com-93008', label: 'Bobigny' },
  drancy:               { id: 'com-93029', label: 'Drancy' },
  leslilas:             { id: 'com-93045', label: 'Les Lilas' },
  montreuil:            { id: 'com-93048', label: 'Montreuil' },
  pantin:               { id: 'com-93055', label: 'Pantin' },
  saintdenis:           { id: 'com-93066', label: 'Saint-Denis' },
  saintouen:            { id: 'com-93070', label: 'Saint-Ouen' },
  saintouensurseine:    { id: 'com-93070', label: 'Saint-Ouen' },
  // ── Val-de-Marne (94) ───────────────────────────────────────────────────
  alfortville:          { id: 'com-94002', label: 'Alfortville' },
  charenton:            { id: 'com-94018', label: 'Charenton-le-Pont' },
  charentonlepont:      { id: 'com-94018', label: 'Charenton-le-Pont' },
  creteil:              { id: 'com-94028', label: 'Créteil' },
  fontenaysousbois:     { id: 'com-94033', label: 'Fontenay-sous-Bois' },
  gentilly:             { id: 'com-94037', label: 'Gentilly' },
  ivry:                 { id: 'com-94041', label: 'Ivry-sur-Seine' },
  ivrysursteine:        { id: 'com-94041', label: 'Ivry-sur-Seine' },
  joinville:            { id: 'com-94042', label: 'Joinville-le-Pont' },
  joinvillelepont:      { id: 'com-94042', label: 'Joinville-le-Pont' },
  kremlin:              { id: 'com-94043', label: 'Le Kremlin-Bicêtre' },
  lekremlim:            { id: 'com-94043', label: 'Le Kremlin-Bicêtre' },
  kremlimbicetre:       { id: 'com-94043', label: 'Le Kremlin-Bicêtre' },
  lekremlimbicetre:     { id: 'com-94043', label: 'Le Kremlin-Bicêtre' },
  maisonsalfort:        { id: 'com-94046', label: 'Maisons-Alfort' },
  nogent:               { id: 'com-94052', label: 'Nogent-sur-Marne' },
  nogentsurmarne:       { id: 'com-94052', label: 'Nogent-sur-Marne' },
  laperreux:            { id: 'com-94058', label: 'Le Perreux-sur-Marne' },
  leperreuxsurmarne:    { id: 'com-94058', label: 'Le Perreux-sur-Marne' },
  saintmande:           { id: 'com-94067', label: 'Saint-Mandé' },
  saintmandé:           { id: 'com-94067', label: 'Saint-Mandé' },
  saintmaurdesposses:   { id: 'com-94068', label: 'Saint-Maur-des-Fossés' },
  // 94078 = Villeneuve-Saint-Georges (NOT Vincennes — was wrong before this fix!)
  villeneuve:           { id: 'com-94078', label: 'Villeneuve-Saint-Georges' },
  villeneuvestgeorges:  { id: 'com-94078', label: 'Villeneuve-Saint-Georges' },
  // 94080 = Vincennes (correct code)
  vincennes:            { id: 'com-94080', label: 'Vincennes' },
  vitrysurseine:        { id: 'com-94081', label: 'Vitry-sur-Seine' },
  vitry:                { id: 'com-94081', label: 'Vitry-sur-Seine' },
}

// ─── "Côté" expansions ────────────────────────────────────────────────────────
// Maps a short reference word to the canonical POI name + default proximity radius.
// NEVER produces a cardinal direction — always edge_of.

// targetType controls which geocoding strategy the /api/location/geocode route uses:
//   'park'/'landmark'/'poi' → fetchPoiWaysOverpass (1.5km bbox — correct for compact features)
//   'boulevard'/'avenue'/'street' → fetchStreetWaysOverpass (full IDF bbox — needed for linear
//      infrastructure spanning many km, e.g. Boulevard Périphérique ≈ 35km)
const COTE_EXPANSIONS: Record<string, { label: string; targetType: string; radiusM: number }> = {
  bois:              { label: 'Bois de Boulogne',      targetType: 'park',      radiusM: 300 },
  boisdeboulogne:    { label: 'Bois de Boulogne',      targetType: 'park',      radiusM: 300 },
  boisdevincennes:   { label: 'Bois de Vincennes',     targetType: 'park',      radiusM: 300 },
  seine:             { label: 'Seine',                 targetType: 'poi',       radiusM: 200 },
  canal:             { label: 'Canal Saint-Martin',    targetType: 'poi',       radiusM: 250 },
  canalsaintmartin:  { label: 'Canal Saint-Martin',    targetType: 'poi',       radiusM: 250 },
  parc:              { label: 'parc',                  targetType: 'park',      radiusM: 300 },
  foret:             { label: 'forêt',                 targetType: 'park',      radiusM: 400 },
  marne:             { label: 'Marne',                 targetType: 'poi',       radiusM: 200 },
  // 'boulevard' → fetchStreetWaysOverpass (full IDF bbox) so the complete 35km periph
  // LineString is returned, not just a 1.5km section near the Nominatim center.
  periph:            { label: 'Boulevard Périphérique',targetType: 'boulevard', radiusM: 200 },
  peripherique:      { label: 'Boulevard Périphérique',targetType: 'boulevard', radiusM: 200 },
  lac:               { label: 'lac',                   targetType: 'poi',       radiusM: 300 },
  // Reference points for directional exclusions ("pas côté Défense", "hors côté Défense")
  defense:           { label: 'La Défense',            targetType: 'landmark',  radiusM: 500 },
  ladefense:         { label: 'La Défense',            targetType: 'landmark',  radiusM: 500 },
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
 * Resolve an exclusion target text to a SpatialEntity, with special handling for
 * known geographic references (COTE_EXPANSIONS) and "côté X" patterns.
 *
 * This is the exclusion-side mirror of the inline proximity / CÔTÉ patterns:
 *   "sauf périph"             → poi(exclude, "Boulevard Périphérique")
 *   "mais pas côté Défense"   → poi(exclude, "La Défense")
 *   "hors bois"               → poi(exclude, "Bois de Boulogne")
 *   "sauf Marcel Sembat"      → resolveEntity normally (station)
 *   "hors Belleville"         → resolveEntity normally (quartier)
 *
 * When the exclusion target IS in COTE_EXPANSIONS (possibly with "côté" prefix),
 * it produces a poi entity whose label will be geocoded in LocationMapStep,
 * allowing resolveExcludeToIris to apply a geometry-based exclusion.
 */
function resolveExclusionTarget(rawText: string): SpatialEntity {
  const norm = normalizeForParsing(rawText.trim())
  const key = normKey(rawText.trim())

  // Direct COTE_EXPANSIONS match: "sauf périph", "hors bois", "hors seine"
  const direct = COTE_EXPANSIONS[key]
  if (direct) {
    return {
      rawText, normalizedText: norm, type: 'poi',
      label: direct.label, poiType: direct.targetType, confidence: 0.85,
    }
  }

  // "côté X" / "cote X" in exclusion context: "mais pas côté Défense"
  // After normalizeForParsing, "côté" → "cote"
  const coteMatch = norm.match(/^cote\s+(.+)$/)
  if (coteMatch) {
    const innerKey = normKey(coteMatch[1])
    const expansion = COTE_EXPANSIONS[innerKey]
    if (expansion) {
      return {
        rawText, normalizedText: norm, type: 'poi',
        label: expansion.label, poiType: expansion.targetType, confidence: 0.82,
      }
    }
    // "côté [entity]" where entity is a known place → resolve the inner entity
    const inner = resolveEntity(coteMatch[1].trim())
    if (inner.type !== 'unknown') return { ...inner, rawText }
  }

  // Default: resolve normally (handles stations, quartiers, communes…)
  return resolveEntity(rawText.trim())
}

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
    exclusions.push(resolveExclusionTarget(exclMatch[1].trim()))
    workingQuery = workingQuery.slice(0, exclMatch.index!).trim()
  }

  // ── 3. CÔTÉ: "[entity] côté [reference]" ───────────────────────────────────
  // IMPORTANT: "côté" is NEVER converted to a cardinal direction.
  // After normalizeForParsing, "côté" → "cote".
  //
  // Also handles the negated form "[entity] pas côté [reference]" → exclusion.
  // The "pas" ends up in the entity capture group; we strip it and produce a
  // poi(exclude) instead of an edge_of relation.
  const coteMatch = workingQuery.match(/^(.+?)\s+cote\s+(.+)$/)
  if (coteMatch) {
    let primaryText = coteMatch[1].trim()
    const coteKey = normKey(coteMatch[2].trim())
    const expansion = COTE_EXPANSIONS[coteKey]

    // "X pas côté Y" → negated: exclude IRIS bordering Y from X
    if (primaryText.endsWith(' pas') && expansion) {
      const primaryEntity = resolveEntity(primaryText.slice(0, -4).trim())
      return {
        rawQuery, normalizedQuery,
        primaryEntities: [primaryEntity],
        spatialRelations: [],
        exclusions: [{
          rawText: coteMatch[2].trim(),
          normalizedText: normalizeForParsing(coteMatch[2].trim()),
          type: 'poi',
          label: expansion.label,
          poiType: expansion.targetType,
          confidence: 0.82,
        }],
        requiresLLM: primaryEntity.type === 'unknown',
        confidence: primaryEntity.confidence * 0.82,
      }
    }

    // "X côté Y" → positive: select IRIS of X bordering Y
    const primaryEntity = resolveEntity(primaryText)
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

  // ── 3b. NEGATED PROXIMITY: "[entity] pas proche/côté/loin de [reference]" ──────
  // "Saint-Ouen pas proche périph", "Neuilly loin du bois", "Boulogne pas côté bois"
  // → inside(entity) + poi(exclude, reference)
  //
  // This is the structural mirror of the positive inline proximity (3c below).
  // "pas proche X" / "loin de X" / "pas côté X" all mean:
  //   "select entity, then remove IRIS that border X"
  //
  // Only resolves when reference is in COTE_EXPANSIONS (known geographic anchors).
  // Unknown references (e.g. "pas proche métro") fall through to LLM.
  const NEG_PROX_RE = /^(.+?)\s+(?:pas\s+(?:proche|pres|cote)|loin\s+(?:du\s+|de\s+la?\s+|des\s+|de\s+l[']\s*)?)\s*(.+)$/
  const negProxMatch = workingQuery.match(NEG_PROX_RE)
  if (negProxMatch) {
    // Strip leading French articles from reference before COTE_EXPANSIONS lookup
    const refRaw = negProxMatch[2].trim()
    const refStripped = refRaw.replace(/^(?:du\s+|de\s+la?\s+|des\s+|de\s+l[']\s*)/, '')
    const refKey = normKey(refStripped || refRaw)
    const expansion = COTE_EXPANSIONS[refKey]
    if (expansion) {
      const primaryEntity = resolveEntity(negProxMatch[1].trim())
      return {
        rawQuery, normalizedQuery,
        primaryEntities: [primaryEntity],
        spatialRelations: [],
        exclusions: [{
          rawText: refRaw,
          normalizedText: normalizeForParsing(refRaw),
          type: 'poi',
          label: expansion.label,
          poiType: expansion.targetType,
          confidence: 0.88,
        }],
        requiresLLM: primaryEntity.type === 'unknown',
        confidence: primaryEntity.confidence * 0.88,
      }
    }
  }

  // ── 3c. INLINE PROXIMITY: "[entity] proche/près [reference]" ─────────────────
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
