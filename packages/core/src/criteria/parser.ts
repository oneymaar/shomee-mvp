/**
 * Shomee — parser DÉTERMINISTE de critères acquéreur (côté onboarding).
 *
 * Transforme un libellé de critère libre (« ascenseur obligatoire à partir
 * du 4e », « pas de vis-à-vis », « terrasse d'au moins 15 m² ») en
 * `ParsedCriterion` complet — y compris les RÈGLES CONDITIONNELLES que le
 * moteur sait déjà évaluer mais que personne ne fabriquait.
 *
 * Utilisé par :
 *  - buyerBriefBuilder (customCriteria → règles au lieu de sémantique pur) ;
 *  - la route criteria/analyze (post-traitement des labels nettoyés par le
 *    LLM : le LLM découpe/nettoie, ce parser structure — zéro 2e appel).
 *
 * Retourne null quand le texte n'est pas structurable — l'appelant retombe
 * alors sur le critère sémantique historique (aucune régression possible).
 */

import type {
  CriterionCategory,
  CriterionImportance,
  ParsedCriterion,
  Rule,
} from './types'

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’ʼ]/g, "'")
    .trim()
}

let seq = 0
function makeId(): string {
  // Pas de crypto.randomUUID : ce module tourne aussi côté client RN/Hermes.
  seq = (seq + 1) % 0xffff
  return `crit-${Date.now().toString(36)}-${seq.toString(36)}`
}

function build(
  displayLabel: string,
  rawInput: string,
  category: CriterionCategory,
  rule: Rule,
  opts?: {
    importance?: CriterionImportance
    polarity?: 'positive' | 'negative'
    matchType?: 'structured_rule' | 'conditional_rule'
    confidence?: number
  },
): ParsedCriterion {
  return {
    id: makeId(),
    display_label: displayLabel,
    category,
    polarity: opts?.polarity ?? 'positive',
    importance: opts?.importance ?? 'desired',
    match_type: opts?.matchType ?? 'structured_rule',
    rule,
    semantic_hint: null,
    raw_input: rawInput,
    confidence: opts?.confidence ?? 0.9,
    importance_override: false,
  }
}

/** Attributs booléens reconnus dans les tournures « pas de X » / « X ». */
const BOOL_ATTRS: Array<{ re: RegExp; attribute: string; label: string; category: CriterionCategory }> = [
  { re: /\bascenseur\b/, attribute: 'elevator', label: 'Ascenseur', category: 'building' },
  { re: /\bterrasses?\b/, attribute: 'terrace.exists', label: 'Terrasse', category: 'outdoor' },
  { re: /\bbalcons?\b/, attribute: 'balcony.exists', label: 'Balcon', category: 'outdoor' },
  { re: /\bjardins?\b/, attribute: 'garden.exists', label: 'Jardin', category: 'outdoor' },
  { re: /\bcaves?\b/, attribute: 'cellar', label: 'Cave', category: 'building' },
  { re: /\b(?:parking|box|garage)\b/, attribute: 'parking', label: 'Parking', category: 'building' },
  { re: /\b(?:gardien(?:ne)?|concierge)\b/, attribute: 'guardian', label: 'Gardien', category: 'building' },
  { re: /\bvis[- ]?a[- ]?vis\b/, attribute: 'vis_a_vis', label: 'Vis-à-vis', category: 'living' },
  { re: /\bcheminees?\b/, attribute: 'fireplace', label: 'Cheminée', category: 'ambiance' },
  { re: /\btraversante?s?\b/, attribute: 'traversant', label: 'Traversant', category: 'living' },
  { re: /\brefaite?s?\s+a\s+neuf|renove[e]?s?\b/, attribute: 'renovated', label: 'Refait à neuf', category: 'living' },
  { re: /\bexterieur\b/, attribute: 'has_outdoor_space', label: 'Extérieur', category: 'outdoor' },
  { re: /\brez[- ]de[- ]chauss[ée]e|rdc\b/, attribute: 'floor.is_ground', label: 'Rez-de-chaussée', category: 'building' },
  { re: /\bdernier\s+etage\b/, attribute: 'floor.is_top', label: 'Dernier étage', category: 'building' },
]

const MANDATORY_RE = /\b(?:obligatoire|indispensable|imperatif|imperativement|absolument|necessaire)\b/
const NEGATION_RE = /\b(?:pas\s+d[e']?|sans|aucune?|eviter|hors|jamais|surtout\s+pas)\b/

/**
 * Parse un critère libre. Retourne null si non structurable.
 * `stateImportance` (chips 3 états) prime sur l'importance détectée dans le
 * texte quand il est fourni.
 */
export function parseCriterionText(
  rawInput: string,
  stateImportance?: CriterionImportance,
): ParsedCriterion | null {
  const n = norm(rawInput)
  if (n.length < 3) return null

  const textMandatory = MANDATORY_RE.test(n)
  const importance: CriterionImportance =
    stateImportance ?? (textMandatory ? 'mandatory' : 'desired')

  // ── 1. CONDITIONNEL : « ascenseur (obligatoire) à partir du/dès le Ne » ──
  {
    const m = n.match(
      /\bascenseur\b.*?\b(?:a\s+partir\s+d[ue]|des\s+le|au[- ]dela\s+d[ue])\s*(\d{1,2})\s*(?:e(?:me)?|er)?\b/,
    )
    if (m) {
      const floorN = parseInt(m[1], 10)
      return build(
        `Ascenseur obligatoire à partir du ${floorN}${floorN === 1 ? 'er' : 'e'}`,
        rawInput,
        'building',
        { if: { attribute: 'floor', operator: '>=', value: floorN }, then: { attribute: 'elevator', operator: '=', value: true } },
        { importance: stateImportance ?? 'mandatory', matchType: 'conditional_rule', confidence: 0.95 },
      )
    }
  }

  // ── 2. SEUILS DE SURFACE : « terrasse d'au moins 15 m² », « balcon ≥ 5 m2 » ──
  {
    const m = n.match(
      /\b(terrasses?|balcons?|jardins?)\b.*?(?:d'au\s+moins|au\s+moins|min(?:imum)?|superieure?\s+a|>=?|de)\s*(\d{1,3})\s*m/,
    )
    if (m) {
      const kind = m[1].startsWith('terrasse') ? 'terrace' : m[1].startsWith('balcon') ? 'balcony' : 'garden'
      const sqm = parseInt(m[2], 10)
      const label = `${kind === 'terrace' ? 'Terrasse' : kind === 'balcony' ? 'Balcon' : 'Jardin'} ≥ ${sqm} m²`
      return build(label, rawInput, 'outdoor',
        { attribute: `${kind}.surface_m2`, operator: '>=', value: sqm },
        { importance, confidence: 0.92 })
    }
  }

  // ── 3. ÉTAGE : « étage élevé », « à partir du 3e étage », « pas en RDC » ──
  {
    const m = n.match(/\b(?:a\s+partir\s+du|minimum|des\s+le)\s*(\d{1,2})\s*(?:e(?:me)?|er)?\s*etage\b/)
    if (m) {
      const floorN = parseInt(m[1], 10)
      return build(`Étage ≥ ${floorN}`, rawInput, 'building',
        { attribute: 'floor', operator: '>=', value: floorN },
        { importance, confidence: 0.9 })
    }
    if (/\betage\s+eleve\b/.test(n)) {
      return build('Étage élevé', rawInput, 'building',
        { attribute: 'floor', operator: '>=', value: 3 },
        { importance, confidence: 0.7 })
    }
  }

  // ── 4. BOOLÉENS, avec négation : « pas de vis-à-vis », « sans ascenseur » ──
  {
    const negated = NEGATION_RE.test(n)
    for (const { re, attribute, label, category } of BOOL_ATTRS) {
      if (!re.test(n)) continue
      // Cas particulier : « dernier étage » + négation est rarissime — ignoré.
      const value = !negated
      return build(
        label,
        rawInput,
        category,
        { attribute, operator: '=', value },
        {
          importance,
          polarity: negated ? 'negative' : 'positive',
          confidence: 0.88,
        },
      )
    }
  }

  return null
}
