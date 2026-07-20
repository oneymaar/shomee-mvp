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

import rawStations from '../data/transportStations.json'
import rawNeighborhoods from '../data/semanticNeighborhoods.json'
import { matchQuartier } from '../geo/quartierMatchingService'
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

const COTE_EXPANSIONS: Record<string, { label: string; targetType: string; radiusM: number; neighborhoodId?: string }> = {
  bois:              { label: 'Bois de Boulogne',      targetType: 'poi', radiusM: 300 },
  boisdeboulogne:    { label: 'Bois de Boulogne',      targetType: 'poi', radiusM: 300 },
  boisdevincennes:   { label: 'Bois de Vincennes',     targetType: 'poi', radiusM: 300 },
  seine:             { label: 'Seine',                 targetType: 'poi', radiusM: 200 },
  canal:             { label: 'Canal Saint-Martin',    targetType: 'poi', radiusM: 250 },
  canalsaintmartin:  { label: 'Canal Saint-Martin',    targetType: 'poi', radiusM: 250 },
  parc:              { label: 'parc',                  targetType: 'poi', radiusM: 300 },
  foret:             { label: 'forêt',                 targetType: 'poi', radiusM: 400 },
  marne:             { label: 'Marne',                 targetType: 'poi', radiusM: 200 },
  periph:            { label: 'Boulevard Périphérique',targetType: 'neighborhood', radiusM: 0, neighborhoodId: 'zone-periph' },
  peripherique:      { label: 'Boulevard Périphérique',targetType: 'neighborhood', radiusM: 0, neighborhoodId: 'zone-periph' },
  lac:               { label: 'lac',                   targetType: 'poi', radiusM: 300 },
  // Reference points for directional exclusions ("pas côté Défense", "hors côté Défense")
  defense:           { label: 'La Défense',            targetType: 'poi', radiusM: 500 },
  ladefense:         { label: 'La Défense',            targetType: 'poi', radiusM: 500 },
}

// ─── Arrondissements en toutes lettres ───────────────────────────────────────

const ARR_WORDS: Record<string, number> = {
  premier: 1, '1er': 1, deuxieme: 2, second: 2, troisieme: 3, quatrieme: 4,
  cinquieme: 5, sixieme: 6, septieme: 7, huitieme: 8, neuvieme: 9, dixieme: 10,
  onzieme: 11, douzieme: 12, treizieme: 13, quatorzieme: 14, quinzieme: 15,
  seizieme: 16, dixseptieme: 17, dixhuitieme: 18, dixneuvieme: 19, vingtieme: 20,
  deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  dixsept: 17, dixhuit: 18, dixneuf: 19, vingt: 20,
}

// ─── Lignes de transport (déterministe — le résolveur gère transport_line) ───

/** Abaque temps de marche → rayon (alignée sur le prompt V1 de /api/location/analyze). */
function walkRadiusM(minutes: number): number {
  if (minutes <= 5) return 200
  if (minutes <= 8) return 350
  if (minutes <= 10) return 400
  return 700
}

function lineEntity(rawId: string, rawText: string, radiusM?: number): SpatialEntity {
  const id = rawId.replace(/\s+/g, '').toUpperCase() // "6", "7BIS", "A"
  const generic = id === 'METRO' || id === 'RER'
  return {
    rawText,
    normalizedText: normalizeForParsing(rawText),
    type: 'transport_line',
    resolvedId: generic ? id.toLowerCase() : id,
    label: generic ? (id === 'RER' ? 'RER' : 'métro') : `ligne ${id}`,
    confidence: 0.95,
    operatorHint: 'near',
    ...(radiusM ? { radiusM } : {}),
  }
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

function resolveEntity(rawText: string, _retried = false): SpatialEntity {
  const norm = normalizeForParsing(rawText.trim())
  const key = normKey(rawText.trim())

  // 1. Street/way prefix → type street (no further resolution needed)
  if (STREET_PREFIX_RE.test(norm)) {
    return { rawText, normalizedText: norm, type: 'street', confidence: 0.95 }
  }

  // 2. Arrondissement patterns: "11e", "11ème", "Paris 11", "1er", "premier"
  const arrMatch = norm.match(/^(?:paris\s+)?(?:le\s+)?(\d{1,2})(?:e(?:m(?:e)?)?|er|eme)?$/)
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


  // 2b. Arrondissement en toutes lettres : "paris douze", "le quatorzieme", "dix-huitieme".
  // Cardinaux UNIQUEMENT derriere "paris " (sinon trop ambigu) ; ordinaux acceptes seuls.
  {
    const parisPrefixed = /^paris\s+(.+)$/.exec(norm)
    const candidate = (parisPrefixed ? parisPrefixed[1] : norm).replace(/^le\s+/, '')
    const kk = candidate.replace(/[-\s]+/g, '')
    const wordNum = ARR_WORDS[kk]
    const isOrdinal = /ieme$/.test(kk) || kk === 'premier' || kk === 'second' || kk === '1er'
    if (wordNum !== undefined && wordNum >= 1 && wordNum <= 20 && (parisPrefixed || isOrdinal)) {
      return {
        rawText, normalizedText: norm,
        type: 'district',
        resolvedId: `arr-${wordNum}`,
        label: wordNum === 1 ? 'Paris 1er' : `Paris ${wordNum}e`,
        confidence: 0.95,
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
    const lm = tpMatch[1].match(/^(?:ligne\s+)?(\d{1,2}(?:\s*bis)?|[a-e])$/)
    if (lm) return lineEntity(lm[1], rawText)
    const stKey = normKey(tpMatch[1])
    const s = stationByNorm.get(stKey)
    if (s) {
      return { rawText, normalizedText: norm, type: 'transport_station', resolvedId: s.id, label: s.label, confidence: 0.99 }
    }
    // Prefix present but station not found → still clearly a transport entity
    return { rawText, normalizedText: norm, type: 'transport_station', label: tpMatch[1], confidence: 0.7 }
  }

  // Priority rule: quartier vécu > QA administratif > station (sans préfixe "métro")
  // A name that exists as a quartier vécu (semanticNeighborhoods.json) → use that.
  // A name that exists as a QA (quartiers.json) → use QA, even if also a station name.
  // Station without explicit "métro/rer" prefix only wins when no neighborhood/QA matches.
  // Rationale: in real estate searches, "Bel-Air", "Nation", "Daumesnil" refer to
  // geographic areas, not transport anchors.

  // 5. Semantic neighborhood exact match (quartier vécu — highest priority)
  const nb = neighborhoodByNorm.get(key)
  if (nb) {
    return { rawText, normalizedText: norm, type: 'quartier', resolvedId: nb.id, label: nb.label, confidence: 0.92 }
  }

  // 6. Quartier administratif exact match (preferred over bare station name)
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

  // 7. Station exact match — only when no neighborhood or QA matched
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

  // 9. Article initial ("la Goutte d'Or", "les Batignolles") : retente sans lui.
  if (!_retried) {
    const stripped = norm.replace(/^(?:le|la|les|l'|du|de\s+la|des|au|aux)\s+/, '')
    if (stripped !== norm && stripped.length >= 2) {
      const retried = resolveEntity(stripped, true)
      if (retried.type !== 'unknown') return { ...retried, rawText }
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
      rawText, normalizedText: norm,
      type: direct.neighborhoodId ? 'quartier' : 'poi',
      label: direct.label,
      resolvedId: direct.neighborhoodId,
      confidence: 0.85,
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
        rawText, normalizedText: norm,
        type: expansion.neighborhoodId ? 'quartier' : 'poi',
        label: expansion.label,
        resolvedId: expansion.neighborhoodId,
        confidence: 0.82,
      }
    }
    // "côté [entity]" where entity is a known place → resolve the inner entity
    const inner = resolveEntity(coteMatch[1].trim())
    if (inner.type !== 'unknown') return { ...inner, rawText }
  }

  // Default: resolve normally (handles stations, quartiers, communes…)
  return resolveEntity(rawText.trim())
}

// ─── Fillers conversationnels (retirés clause par clause, jamais globalement) ──

const FILLER_RES: RegExp[] = [
  /^(?:je|on|nous)\s+(?:veux|voudrais|souhaite(?:rais)?|cherche(?:s)?|cherchons|recherche|aimerais|aimerait|reve\s+de)\s*/,
  /^(?:j'aimerais(?:\s+bien)?|je\s+reve\s+de|j'adorerais)\s*/,
  /^(?:bien\s+)?(?:vivre|habiter|etre|m'installer|nous\s+installer|demenager|louer|acheter)\s*/,
  /^(?:un\s+(?:appart(?:ement)?|logement|bien|studio|deux\s+pieces|trois\s+pieces)|quelque\s+chose|quelque\s+part)\s*/,
  /^(?:idealement|si\s+possible|plutot|de\s+preference|surtout|pourquoi\s+pas)\s*/,
  /^(?:dans|a|au|aux|en|vers)\s+/,
  /^(?:autour|du\s+cote|le\s+long|aupres)\s+(?:du|de\s+la|de\s+l'|des|de)\s+/,
  /^(?:le|la|les|l')\s+/,
  /^(?:quartier|secteur|coin)\s+/,
]

function stripFillers(clause: string): string {
  let out = clause.trim()
  for (let i = 0; i < 8; i++) {
    let changed = false
    for (const re of FILLER_RES) {
      const next = out.replace(re, '')
      if (next !== out) { out = next.trim(); changed = true }
    }
    if (!changed) break
  }
  return out
}

/** resolveEntity, puis retente après retrait des fillers conversationnels. */
function resolveEntityDeep(text: string): SpatialEntity {
  const direct = resolveEntity(text)
  if (direct.type !== 'unknown') return direct
  const stripped = stripFillers(text)
  if (stripped !== text.trim() && stripped.length >= 2) {
    const retried = resolveEntity(stripped)
    if (retried.type !== 'unknown') return { ...retried, rawText: text }
  }
  return direct
}

// ─── Séparateurs ─────────────────────────────────────────────────────────────
// Forts (frontières de clauses) : virgule, point-virgule, slash, retour ligne,
// tiret espacé, "+". Faibles (énumération d'entités DANS une clause) : et/ou.

const STRONG_SEP = /\s*[,;\n\/+]+\s*|\s+-\s+/
const WEAK_SEP = /\s+(?:et(?:\s+(?:aussi|pourquoi\s+pas|egalement|meme|surtout))?|ou(?:\s+(?:eventuellement|bien|encore|meme|plutot))?)\s+/gi

function weakSplit(text: string): string[] {
  const parts = text.split(WEAK_SEP).map((p) => p.trim()).filter((p) => p.length >= 2)
  return parts.length >= 1 ? parts : [text.trim()]
}

// ─── Clauses transport (lignes, métro générique, « à N min ») ────────────────

const LINE_ID_RE = String.raw`(\d{1,2}(?:\s*bis)?|[a-e])`

interface TransportMatch { primaryText: string; entity: SpatialEntity }

function tryTransportClause(clause: string): TransportMatch | null {
  // « [X] à (moins de) N min/mn (à pied) du métro|RER|d'une station|gare »
  const minRe = /^(.*?)\s*a\s+(?:moins\s+d[e']\s*)?(\d{1,2})\s*m(?:i?n(?:utes)?)?\s*(?:a\s+pied\s+)?(?:du|d'une?|de\s+la|de|des)?\s*(metro|rer|station|gare|tram)\s*$/
  const mm = clause.match(minRe)
  if (mm) {
    const network = mm[3] === 'rer' ? 'rer' : 'metro'
    return { primaryText: mm[1].trim(), entity: lineEntity(network, clause, walkRadiusM(parseInt(mm[2], 10))) }
  }
  // « [X] proche/près/sur (de la) ligne N » ou « [X] ligne N » ou « ligne N » seule
  const lineRe = new RegExp(String.raw`^(.*?)(?:^|\s)(?:(?:proche|pres|sur|le\s+long)\s+)?(?:de\s+la\s+|de\s+|du\s+|la\s+)?ligne\s+${LINE_ID_RE}\s*$`)
  const lm = clause.match(lineRe)
  if (lm) {
    return { primaryText: lm[1].trim(), entity: lineEntity(lm[2], clause) }
  }
  // « [X] proche/près du métro|RER » (générique, fin de clause)
  const genRe = /^(.*?)\s*(?:proche|pres)\s+(?:du|d'un|de\s+la|de|des)?\s*(metro|rer)\s*$/
  const gm = clause.match(genRe)
  if (gm) {
    const network = gm[2] === 'rer' ? 'rer' : 'metro'
    return { primaryText: gm[1].trim(), entity: lineEntity(network, clause, network === 'rer' ? 800 : 400) }
  }
  return null
}

// ─── Traitement d'une clause ─────────────────────────────────────────────────

interface ClauseResult {
  primaries: SpatialEntity[]
  relations: SpatialRelation[]
  exclusions: SpatialEntity[]
  llm: boolean
}

const EXCL_PREFIX_RE = /^(?:sauf|hors|sans|mais\s+pas|pas)\s+(.+)$/
const EXCL_INFIX_RE = /\s+(?:sauf|mais\s+pas|hors|sans)\s+(.+)$/
const EXCENTRE_CL_RE = /^(.+?)\s+pas\s+(?:trop\s+)?excentr/
const NEG_PROX_CL_RE = /^(.+?)\s+(?:pas\s+(?:trop\s+)?(?:proche|pres|cote)|loin\s+(?:du\s+|de\s+la?\s+|des\s+|de\s+l[']\s*)?)\s*(.+)$/
const COTE_CL_RE = /^(.+?)\s+cote\s+(.+)$/
const INLINE_PROX_CL_RE = /^(.+?)\s+(?:proche|pres)\s+(?:du\s+|de\s+la?\s+|des\s+|de\s+l[']\s*)?(.+)$/
const PROX_PREFIX_PATTERNS: Array<{ re: RegExp; radiusM: number }> = [
  { re: /^a\s+deux\s+pas\s+(?:de\s+|du\s+)?(.+)$/, radiusM: 100 },
  { re: /^proche\s+(?:de\s+|du\s+)?(.+)$/, radiusM: 100 },
  { re: /^pres\s+(?:de\s+|du\s+)?(.+)$/, radiusM: 150 },
  { re: /^a\s+cote\s+(?:de\s+|du\s+)?(.+)$/, radiusM: 150 },
  { re: /^autour\s+(?:de\s+la\s+|de\s+l'\s*|de\s+|du\s+|des\s+)?(.+)$/, radiusM: 250 },
]

const EXCENTRE_EXCLUSION: SpatialEntity = {
  rawText: 'excentré',
  normalizedText: 'excentre',
  type: 'quartier',
  label: 'Zone périphérique élargie',
  resolvedId: 'zone-periph-elargie',
  confidence: 0.88,
}

/** Résout la cible d'une exclusion, avec découpe faible (« sauf X et Y »). */
function resolveExclusionList(targetText: string): SpatialEntity[] {
  // « pas proche du périph » / « sauf côté bois » : retire le marqueur de proximité
  const cleaned = targetText.replace(/^(?:trop\s+)?(?:proche|pres|cote)\s+(?:du|de\s+la|de\s+l'|des|de)?\s*/, '')
  if (/^excentr/.test(targetText) || /^trop\s+excentr/.test(targetText)) return [EXCENTRE_EXCLUSION]
  return weakSplit(cleaned).map((part) => resolveExclusionTarget(part))
}

function processClause(clauseRaw: string): ClauseResult {
  const out: ClauseResult = { primaries: [], relations: [], exclusions: [], llm: false }
  let clause = clauseRaw.trim()
  if (clause.length < 2) return out

  // 0a. Clause-exclusion pure : « sauf X », « sans Y », « pas proche du périph »
  const exclPrefix = clause.match(EXCL_PREFIX_RE)
  if (exclPrefix) {
    if (/^(?:trop\s+)?excentr/.test(exclPrefix[1])) { out.exclusions.push(EXCENTRE_EXCLUSION); return out }
    out.exclusions.push(...resolveExclusionList(exclPrefix[1].trim()))
    return out
  }

  // 0b. Exclusion en suffixe de clause : « paris 18 sauf goutte d'or »
  const exclInfix = clause.match(EXCL_INFIX_RE)
  if (exclInfix) {
    const target = exclInfix[1].trim()
    if (/^(?:trop\s+)?excentr/.test(target)) out.exclusions.push(EXCENTRE_EXCLUSION)
    else out.exclusions.push(...resolveExclusionList(target))
    clause = clause.slice(0, exclInfix.index!).trim()
    if (clause.length < 2) return out
  }

  // 1. « X pas (trop) excentré »
  const excentre = clause.match(EXCENTRE_CL_RE)
  if (excentre) {
    out.primaries.push(resolveEntityDeep(excentre[1].trim()))
    out.exclusions.push(EXCENTRE_EXCLUSION)
    return out
  }

  // 2. « X pas proche/loin de REF » (REF ∈ ancres géo)
  const negProx = clause.match(NEG_PROX_CL_RE)
  if (negProx) {
    const refRaw = negProx[2].trim()
    const refStripped = refRaw.replace(/^(?:du\s+|de\s+la?\s+|des\s+|de\s+l[']\s*)/, '')
    const expansion = COTE_EXPANSIONS[normKey(refStripped || refRaw)]
    if (expansion) {
      out.primaries.push(resolveEntityDeep(negProx[1].trim()))
      out.exclusions.push({
        rawText: refRaw, normalizedText: normalizeForParsing(refRaw),
        type: expansion.neighborhoodId ? 'quartier' : 'poi',
        label: expansion.label, resolvedId: expansion.neighborhoodId, confidence: 0.88,
      })
      return out
    }
  }

  // 3. « X côté REF » (jamais converti en direction cardinale) — et « X pas côté REF »
  const cote = clause.match(COTE_CL_RE)
  if (cote) {
    let primaryText = cote[1].trim()
    const expansion = COTE_EXPANSIONS[normKey(cote[2].trim())]
    if (primaryText.endsWith(' pas') && expansion) {
      out.primaries.push(resolveEntityDeep(primaryText.slice(0, -4).trim()))
      out.exclusions.push({
        rawText: cote[2].trim(), normalizedText: normalizeForParsing(cote[2].trim()),
        type: expansion.neighborhoodId ? 'quartier' : 'poi',
        label: expansion.label, resolvedId: expansion.neighborhoodId, confidence: 0.82,
      })
      return out
    }
    if (expansion) {
      out.primaries.push(resolveEntityDeep(primaryText))
      out.relations.push({
        type: 'edge_of', targetText: expansion.label, targetType: expansion.targetType,
        radiusM: expansion.radiusM, confidence: 0.9,
        ...(expansion.neighborhoodId ? { neighborhoodId: expansion.neighborhoodId } : {}),
      })
      return out
    }
    const inner = resolveEntityDeep(cote[2].trim())
    if (inner.type !== 'unknown') {
      out.primaries.push(resolveEntityDeep(primaryText))
      out.relations.push({ type: 'edge_of', targetText: inner.label ?? cote[2].trim(), targetType: 'poi', radiusM: 300, confidence: 0.7 })
      return out
    }
  }

  // 4. Transport : « ligne 6 », « [X] proche ligne 6 », « proche du métro », « à N min du métro »
  const transport = tryTransportClause(clause)
  if (transport) {
    const TRANSPORT_KEYWORD_RE = /^(?:le\s+|la\s+|du\s+)?(?:metro|rer|tram(?:way)?|station|train)$/
    if (TRANSPORT_KEYWORD_RE.test(transport.primaryText)) transport.primaryText = ''
    if (transport.primaryText.length >= 2) {
      const primary = resolveEntityDeep(transport.primaryText)
      out.primaries.push(primary)
      if (primary.type === 'unknown') out.llm = true
    }
    out.primaries.push(transport.entity)
    return out
  }

  // 5. « X proche REF » : ancre géo connue → edge_of ; sinon station/quartier → filtre
  const inlineProx = clause.match(INLINE_PROX_CL_RE)
  if (inlineProx) {
    const refText = inlineProx[2].trim()
    const expansion = COTE_EXPANSIONS[normKey(refText)]
    if (expansion) {
      out.primaries.push(resolveEntityDeep(inlineProx[1].trim()))
      out.relations.push({
        type: 'edge_of', targetText: expansion.label, targetType: expansion.targetType,
        radiusM: expansion.radiusM, confidence: 0.88,
        ...(expansion.neighborhoodId ? { neighborhoodId: expansion.neighborhoodId } : {}),
      })
      return out
    }
    const ref = resolveEntityDeep(refText)
    if (ref.type === 'transport_station' || ref.type === 'quartier') {
      const primary = resolveEntityDeep(inlineProx[1].trim())
      out.primaries.push(primary)
      out.primaries.push({ ...ref, operatorHint: 'near' })
      if (primary.type === 'unknown') out.llm = true
      return out
    }
  }

  // 6. Proximité en tête de clause : « proche de X », « à deux pas de X », « autour de X »
  for (const { re, radiusM } of PROX_PREFIX_PATTERNS) {
    const m = clause.match(re)
    if (m) {
      const target = m[1].trim()
      const targetParts = weakSplit(target)
      const entities = targetParts.map((t) => resolveEntityDeep(t))
      if (entities.every((e) => e.type !== 'unknown')) {
        out.primaries.push(...entities)
        out.relations.push({ type: 'near', targetText: target, radiusM, confidence: 0.92 })
        return out
      }
      // cible(s) inconnue(s) → on retombe sur le chemin générique (LLM probable)
      break
    }
  }

  // 7. « entre X et Y » en clause (le cas requête-entière est géré en amont)
  const between = clause.match(/^entre\s+(.+?)\s+et\s+(.+)$/)
  if (between) {
    const e1 = resolveEntityDeep(between[1].trim())
    const e2 = resolveEntityDeep(between[2].trim())
    out.primaries.push(e1, e2)
    out.relations.push({ type: 'between', confidence: 0.95 })
    out.llm = e1.type === 'unknown' || e2.type === 'unknown'
    return out
  }

  // 8. Chemin générique : énumération faible (« X et Y ») puis entité directe
  const parts = weakSplit(clause)
  if (parts.length >= 2) {
    const entities = parts.map((p) => resolveEntityDeep(p))
    if (entities.some((e) => e.type !== 'unknown')) {
      out.primaries.push(...entities)
      out.llm = entities.some((e) => e.type === 'unknown')
      return out
    }
  }

  const entity = resolveEntityDeep(clause)

  // Lifestyle sans entité résolue → clause subjective, déléguée au LLM
  if (entity.type === 'unknown' && LIFESTYLE_RE.test(clause)) {
    out.llm = true
    return out
  }

  // Garde anti-« partial match » : requête longue, entité courte → LLM.
  // Comptée sur le texte APRÈS retrait des fillers (« je veux vivre dans le
  // 18eme » → « 18eme » = 1 mot → pas de garde).
  const queryWordCount = stripFillers(clause).split(/\s+/).length
  const entityWordCount = (entity.label ?? entity.rawText).split(/\s+/).length
  if (entity.type !== 'unknown' && queryWordCount >= 4 && entityWordCount < queryWordCount - 1) {
    out.primaries.push(entity)
    out.llm = true
    return out
  }

  out.primaries.push(entity)
  if (entity.type === 'unknown') out.llm = true
  return out
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Parse une requête libre en SpatialIntent structuré, sans LLM.
 *
 * Architecture par clauses (v2) : la requête est découpée sur les séparateurs
 * forts (, ; / retour-ligne + tiret espacé), chaque clause est classifiée
 * (zone | transport | proximité | exclusion | lifestyle) puis les résultats
 * sont composés — union d'entités, relations et exclusions MULTIPLES.
 *
 * requiresLLM=true si : vocabulaire lifestyle, une entité primaire inconnue,
 * ou une EXCLUSION inconnue (une exclusion perdue silencieusement produirait
 * une carte trop large — c'est le pire échec possible).
 */
export function parseSpatialIntent(rawQuery: string): SpatialIntent {
  const normalizedQuery = normalizeForParsing(rawQuery.trim()).replace(/[.!?…]+$/, '').trim()

  // Requête entièrement « entre X et Y » : comportement historique exact.
  const betweenMatch = normalizedQuery.match(/^entre\s+(.+?)\s+et\s+(.+)$/)
  if (betweenMatch && !STRONG_SEP.test(normalizedQuery)) {
    const e1 = resolveEntityDeep(betweenMatch[1].trim())
    const e2 = resolveEntityDeep(betweenMatch[2].trim())
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

  const clauses = normalizedQuery.split(STRONG_SEP).map((c) => c.trim()).filter((c) => c.length >= 2)

  const primaries: SpatialEntity[] = []
  const relations: SpatialRelation[] = []
  const exclusions: SpatialEntity[] = []
  let llm = false

  for (const clause of clauses.length > 0 ? clauses : [normalizedQuery]) {
    const res = processClause(clause)
    primaries.push(...res.primaries)
    relations.push(...res.relations)
    exclusions.push(...res.exclusions)
    llm = llm || res.llm
  }

  // Déduplication des primaires (même entité citée deux fois)
  const seen = new Set<string>()
  const dedupedPrimaries = primaries.filter((e) => {
    const key = `${e.type}|${e.resolvedId ?? normKey(e.label ?? e.rawText)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const knownPrimaries = dedupedPrimaries.filter((e) => e.type !== 'unknown')
  const requiresLLM =
    llm ||
    dedupedPrimaries.some((e) => e.type === 'unknown') ||
    exclusions.some((e) => e.type === 'unknown')

  const baseConfidence =
    knownPrimaries.length > 0
      ? Math.min(...knownPrimaries.map((e) => e.confidence)) * (dedupedPrimaries.length > 1 ? 0.9 : 1)
      : 0

  return {
    rawQuery, normalizedQuery,
    primaryEntities: dedupedPrimaries,
    spatialRelations: relations,
    exclusions,
    requiresLLM,
    confidence: requiresLLM && knownPrimaries.length === 0 ? Math.min(baseConfidence, 0.1) : baseConfidence,
  }
}
