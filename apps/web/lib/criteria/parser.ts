/**
 * Shomee — free-text criteria parser.
 *
 * Calls the Anthropic API to turn a free-text French description of
 * housing preferences into a typed `ParsedCriterion[]`. Each criterion
 * carries either a structured rule (numeric / boolean / categorical),
 * a conditional rule, or a semantic / fuzzy hint for downstream matchers.
 *
 * Output safety pipeline:
 *  1. Try to parse the LLM's response as JSON.
 *  2. If that fails, retry once with a corrective prompt that includes
 *     the malformed text so the model can fix its own output.
 *  3. Validate each element against the `ParsedCriterion` shape via
 *     `validateCriterion`. Invalid items are filtered out and logged.
 */

import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import type {
  ParsedCriterion,
  CriterionImportance,
  CriterionMatchType,
  CriterionCategory,
  CriterionPolarity,
  Rule,
  RuleOperator,
  StructuredRule,
  ConditionalRule,
} from './types'

// Model picked by the integrator — Sonnet handles structured-output tasks
// reliably. The ID is configurable so the operator can roll forward to
// newer Sonnet revisions without touching the parser.
const MODEL = process.env.SHOMEE_CRITERIA_MODEL ?? 'claude-sonnet-4-20250514'

const MAX_TOKENS = 2000

const VALID_IMPORTANCE: ReadonlyArray<CriterionImportance> = ['desired', 'mandatory', 'dealbreaker']
const VALID_MATCH_TYPE: ReadonlyArray<CriterionMatchType> = [
  'structured_rule',
  'conditional_rule',
  'semantic',
  'fuzzy',
]
const VALID_CATEGORY: ReadonlyArray<CriterionCategory> = [
  'outdoor',
  'bedroom',
  'living',
  'building',
  'location',
  'ambiance',
]
const VALID_POLARITY: ReadonlyArray<CriterionPolarity> = ['positive', 'negative']
const VALID_OPERATOR: ReadonlyArray<RuleOperator> = ['=', '!=', '>', '>=', '<', '<=', 'in', 'not_in']

export class CriteriaParseError extends Error {
  readonly kind: 'missing_api_key' | 'upstream' | 'invalid_json' | 'empty'
  constructor(kind: 'missing_api_key' | 'upstream' | 'invalid_json' | 'empty', message: string) {
    super(message)
    this.name = 'CriteriaParseError'
    this.kind = kind
  }
}

const SYSTEM_PROMPT = `Tu es le parser de critères immobiliers de Shomee.
Tu reçois du texte libre en français exprimant les préférences d'un utilisateur pour son futur logement.
Tu retournes UNIQUEMENT un tableau JSON valide, sans markdown, sans commentaires, sans préambule.

Chaque élément du tableau est un objet avec ces clés exactes :
{
  "display_label": string,           // reformulation courte et lisible (4 à 10 mots)
  "category": "outdoor" | "bedroom" | "living" | "building" | "location" | "ambiance",
  "polarity": "positive" | "negative",
  "importance": "desired" | "mandatory" | "dealbreaker",
  "match_type": "structured_rule" | "conditional_rule" | "semantic" | "fuzzy",
  "rule": StructuredRule | ConditionalRule | null,
  "semantic_hint": string | null,
  "confidence": number               // 0 à 1, selon la clarté de l'expression
}

StructuredRule  = { "attribute": string, "operator": "=" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "not_in", "value": string | number | boolean | array }
ConditionalRule = { "if": StructuredRule, "then": StructuredRule }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLES — IMPORTANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "indispensable" / "obligatoire" / "impératif" / "absolument" / "il faut" → "mandatory"
- "surtout pas" / "jamais" / "hors de question" / "pas question de" → "dealbreaker"
- Tout le reste → "desired"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLES — POLARITÉ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "pas de" / "sans" / "éviter" / "hors de question" / "ne veut pas" / "non" → "negative"
- Tout le reste → "positive"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLES — MATCH_TYPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Seuil numérique ou booléen → "structured_rule" (ex: terrasse ≥ 15 m², ascenseur = true)
- "si X alors Y" → "conditional_rule" (ex: étage ≥ 3 → ascenseur = true)
- Qualitatif observable mais non chiffré → "semantic" (lumineux, calme, traversant)
- Émotionnel / atmosphère → "fuzzy" (cocon, charme, cachet, esprit famille)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLES — ATTRIBUTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Utilise des chemins en notation pointée pour les attributs :
- terrace.surface_m2, terrace.orientation
- balcony.surface_m2
- bedroom.count, bedroom.street_side, bedroom.surface_m2
- living.surface_m2, living.exposure, living.luminosity
- floor (étage), floor.is_top (dernier étage), floor.is_ground (rez-de-chaussée)
- elevator (bool), guardian (bool), cellar (bool), parking (bool), bike_room (bool)
- charges.level, building.year, building.style
- exposure.main (=" north" | "south" | "east" | "west")
- view.unobstructed (bool)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLES — SEMANTIC / FUZZY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "rule" = null
- "semantic_hint" = une formulation normalisée (ex: "appartement lumineux", "ambiance cocon")
- "match_type" = "semantic" pour les observables qualitatifs, "fuzzy" pour les atmosphères

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXEMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Entrée : "Terrasse d'au moins 15 m², pas de chambre sur rue, ascenseur indispensable à partir du 3e"
Sortie :
[
  {
    "display_label": "Terrasse d'au moins 15 m²",
    "category": "outdoor",
    "polarity": "positive",
    "importance": "desired",
    "match_type": "structured_rule",
    "rule": { "attribute": "terrace.surface_m2", "operator": ">=", "value": 15 },
    "semantic_hint": null,
    "confidence": 0.96
  },
  {
    "display_label": "Pas de chambre sur rue",
    "category": "bedroom",
    "polarity": "negative",
    "importance": "dealbreaker",
    "match_type": "structured_rule",
    "rule": { "attribute": "bedroom.street_side", "operator": "=", "value": false },
    "semantic_hint": null,
    "confidence": 0.82
  },
  {
    "display_label": "Ascenseur indispensable à partir du 3e",
    "category": "building",
    "polarity": "positive",
    "importance": "mandatory",
    "match_type": "conditional_rule",
    "rule": {
      "if":   { "attribute": "floor", "operator": ">=", "value": 3 },
      "then": { "attribute": "elevator", "operator": "=", "value": true }
    },
    "semantic_hint": null,
    "confidence": 0.94
  }
]

Entrée : "Salon lumineux orienté ouest, ambiance cocon"
Sortie :
[
  {
    "display_label": "Salon lumineux orienté ouest",
    "category": "living",
    "polarity": "positive",
    "importance": "desired",
    "match_type": "structured_rule",
    "rule": { "attribute": "living.exposure", "operator": "=", "value": "west" },
    "semantic_hint": "salon lumineux",
    "confidence": 0.88
  },
  {
    "display_label": "Ambiance cocon",
    "category": "ambiance",
    "polarity": "positive",
    "importance": "desired",
    "match_type": "fuzzy",
    "rule": null,
    "semantic_hint": "ambiance cocon, intérieur chaleureux",
    "confidence": 0.75
  }
]

Entrée vide ou hors-sujet → retourne [].`

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a free-text French description of housing preferences into a typed
 * list of criteria. Throws {@link CriteriaParseError} on irrecoverable
 * failures (missing API key, upstream error, JSON still invalid after the
 * corrective retry). Returns an empty array when the user typed something
 * the model couldn't pin down — that is not an error.
 */
export async function parseUserCriteria(rawText: string): Promise<ParsedCriterion[]> {
  const input = rawText.trim()
  if (!input) return []

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new CriteriaParseError('missing_api_key', 'ANTHROPIC_API_KEY not set')
  }

  const client = new Anthropic({ apiKey })

  // First attempt — strict JSON contract.
  const firstResponse = await callModel(client, [
    { role: 'user', content: `Texte: "${input}"\n\nRetourne UNIQUEMENT le tableau JSON.` },
  ])
  const firstJson = extractJsonArray(firstResponse)
  if (firstJson !== null) {
    return finalize(firstJson, input)
  }

  // Corrective retry — feed the model its own malformed output so it can
  // fix its mistake. One retry is enough in practice; further failures
  // surface as `invalid_json`.
  const secondResponse = await callModel(client, [
    { role: 'user', content: `Texte: "${input}"\n\nRetourne UNIQUEMENT le tableau JSON.` },
    { role: 'assistant', content: firstResponse },
    {
      role: 'user',
      content:
        'Ta réponse précédente n\'est pas un JSON valide ou n\'est pas un tableau. ' +
        'Renvoie UNIQUEMENT le tableau JSON pur, sans markdown ni texte additionnel.',
    },
  ])
  const secondJson = extractJsonArray(secondResponse)
  if (secondJson === null) {
    throw new CriteriaParseError('invalid_json', 'Model returned non-JSON after retry')
  }
  return finalize(secondJson, input)
}

/**
 * Validate a single criterion shape coming from the LLM. Returns `null`
 * for invalid input — callers filter those out and log the rejection.
 * Adds the missing fields (`id`, `raw_input`, `importance_override`) so
 * the returned object is a complete `ParsedCriterion`.
 */
export function validateCriterion(input: unknown, rawInput: string): ParsedCriterion | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>

  const display_label = typeof o.display_label === 'string' ? o.display_label.trim() : ''
  if (!display_label) return null

  const category = o.category as CriterionCategory
  if (!VALID_CATEGORY.includes(category)) return null

  const polarity = o.polarity as CriterionPolarity
  if (!VALID_POLARITY.includes(polarity)) return null

  const importance = o.importance as CriterionImportance
  if (!VALID_IMPORTANCE.includes(importance)) return null

  const match_type = o.match_type as CriterionMatchType
  if (!VALID_MATCH_TYPE.includes(match_type)) return null

  const rule = validateRule(o.rule, match_type)
  // Reject criteria where the match_type contractually requires a rule but
  // none is present (or the wrong shape).
  if ((match_type === 'structured_rule' || match_type === 'conditional_rule') && rule === null) {
    return null
  }

  const semantic_hint = typeof o.semantic_hint === 'string' && o.semantic_hint.trim().length > 0
    ? o.semantic_hint.trim()
    : null

  const confidenceRaw = typeof o.confidence === 'number' ? o.confidence : Number(o.confidence)
  const confidence = Number.isFinite(confidenceRaw) ? clamp01(confidenceRaw) : 0.5

  return {
    id: randomUUID(),
    display_label,
    category,
    polarity,
    importance,
    match_type,
    rule,
    semantic_hint,
    raw_input: rawInput,
    confidence,
    importance_override: false,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

async function callModel(
  client: Anthropic,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    })
    const block = res.content[0]
    if (!block || block.type !== 'text') {
      throw new CriteriaParseError('empty', 'Model returned no text block')
    }
    return block.text
  } catch (err) {
    if (err instanceof CriteriaParseError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new CriteriaParseError('upstream', `Anthropic call failed: ${msg}`)
  }
}

/**
 * Extract the first JSON array found in a text blob. Returns `null` if
 * parsing fails or the value is not an array. Tolerates the model wrapping
 * the array in stray text despite the strict prompt.
 */
function extractJsonArray(text: string): unknown[] | null {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const value = JSON.parse(match[0])
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function finalize(items: unknown[], rawInput: string): ParsedCriterion[] {
  const result: ParsedCriterion[] = []
  for (const item of items) {
    const validated = validateCriterion(item, rawInput)
    if (validated) {
      result.push(validated)
    } else {
      console.warn('[criteria/parser] dropped invalid criterion:', JSON.stringify(item).slice(0, 240))
    }
  }
  return result
}

function validateRule(input: unknown, matchType: CriterionMatchType): Rule | null {
  if (matchType === 'semantic' || matchType === 'fuzzy') return null
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>

  if (matchType === 'conditional_rule') {
    const ifRule = validateStructuredRuleShape(o.if)
    const thenRule = validateStructuredRuleShape(o.then)
    if (!ifRule || !thenRule) return null
    const result: ConditionalRule = { if: ifRule, then: thenRule }
    return result
  }

  return validateStructuredRuleShape(o)
}

function validateStructuredRuleShape(input: unknown): StructuredRule | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const attribute = typeof o.attribute === 'string' ? o.attribute.trim() : ''
  if (!attribute) return null
  const operator = o.operator as RuleOperator
  if (!VALID_OPERATOR.includes(operator)) return null
  const value = o.value
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    !Array.isArray(value)
  ) {
    return null
  }
  return { attribute, operator, value: value as StructuredRule['value'] }
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}
