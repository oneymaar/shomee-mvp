/**
 * Shomee — deterministic matching engine.
 *
 * Pure function `matchProperty(profile, brief)` computes a `MatchResult`
 * with the following pipeline:
 *
 *  1. Each criterion is evaluated against the property via one of four
 *     paths, picked by `match_type`:
 *       - structured_rule  → resolve attribute, apply operator, 0 or 1
 *       - conditional_rule → if-clause gates the then-clause; non-applicable if-clause yields score = 1
 *       - semantic         → look up the matching score in the property's
 *                            PropertySemanticScores; null data → 0.5
 *       - fuzzy            → 0.5 placeholder; warned in logs; coefficient 0
 *  2. A criterion is "matched" depending on its `match_type`:
 *       - structured / conditional → score === 1
 *       - semantic                  → score >= 0.5
 *       - fuzzy                     → always considered matched
 *  3. Dealbreakers that don't match exclude the property immediately
 *     (`is_excluded = true`, global_score = 0).
 *  4. Mandatory that don't match are listed in `mandatory_failures` and
 *     scored 0 with coefficient 3 in the global score.
 *  5. Global score = round( Σ (score × coef) / Σ coef × 100 ), where
 *     coef = 1 (desired) | 3 (mandatory) | 5 (dealbreaker) and fuzzy
 *     criteria carry coef 0 (do not influence the score).
 *
 * No external calls, no mutation of inputs — safe to run in any context.
 */

import type {
  ConditionalRule,
  CriterionMatchType,
  CriterionPolarity,
  ParsedCriterion,
  RuleOperator,
  RuleValue,
  StructuredRule,
  UserCriteriaBrief,
} from '../criteria/types'
import { isConditionalRule, isStructuredRule } from '../criteria/types'
import { resolveSemanticKey } from './semantic-map'
import type {
  CriterionScore,
  MatchResult,
  PropertyProfile,
  PropertyStructuredAttributes,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full matching pipeline for a single property against a user's
 * brief. Pure function — does not mutate either argument.
 */
export function matchProperty(
  profile: PropertyProfile,
  brief: UserCriteriaBrief,
): MatchResult {
  const criteria_scores: CriterionScore[] = []
  const exclusion_reasons: string[] = []
  const mandatory_failures: string[] = []
  let is_excluded = false

  for (const criterion of brief.parsed_criteria) {
    const { score, matched, explanation } = scoreCriterion(criterion, profile)

    criteria_scores.push({
      criterion_id: criterion.id,
      display_label: criterion.display_label,
      importance: criterion.importance,
      match_type: criterion.match_type,
      score,
      matched,
      explanation,
    })

    if (!matched) {
      if (criterion.importance === 'dealbreaker') {
        is_excluded = true
        exclusion_reasons.push(criterion.display_label)
      } else if (criterion.importance === 'mandatory') {
        mandatory_failures.push(criterion.display_label)
      }
    }
  }

  // Compute global score. Excluded properties always score 0.
  let global_score = 0
  if (!is_excluded) {
    let numerator = 0
    let denominator = 0
    for (const cs of criteria_scores) {
      const coef = coefficientFor(cs.match_type, cs.importance)
      if (coef === 0) continue
      numerator += cs.score * coef
      denominator += coef
    }
    global_score = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0
  }

  return {
    property_id: profile.property_id,
    global_score,
    is_excluded,
    exclusion_reasons,
    mandatory_failures,
    criteria_scores,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-criterion scoring
// ─────────────────────────────────────────────────────────────────────────────

interface ScoreOutcome {
  score: number
  matched: boolean
  explanation: string
}

function scoreCriterion(criterion: ParsedCriterion, profile: PropertyProfile): ScoreOutcome {
  switch (criterion.match_type) {
    case 'structured_rule':
      return scoreStructured(criterion, profile)
    case 'conditional_rule':
      return scoreConditional(criterion, profile)
    case 'semantic':
      return scoreSemantic(criterion, profile)
    case 'fuzzy':
      return scoreFuzzy(criterion)
  }
}

function scoreStructured(
  criterion: ParsedCriterion,
  profile: PropertyProfile,
): ScoreOutcome {
  if (!isStructuredRule(criterion.rule)) {
    return {
      score: 0,
      matched: false,
      explanation: `${criterion.display_label} — règle structurée manquante`,
    }
  }
  const evalRes = evaluateStructured(criterion.rule, profile)
  // Structured rules already bake negation into the rule shape (e.g.
  // `floor.is_ground = false`), so polarity is metadata here — the
  // engine reads satisfaction as-is.
  const matched = evalRes.satisfied
  return {
    score: matched ? 1 : 0,
    matched,
    explanation: formatStructuredExplanation(
      criterion.display_label,
      criterion.rule,
      evalRes.resolvedValue,
      matched,
      criterion.polarity,
    ),
  }
}

function scoreConditional(
  criterion: ParsedCriterion,
  profile: PropertyProfile,
): ScoreOutcome {
  if (!isConditionalRule(criterion.rule)) {
    return {
      score: 0,
      matched: false,
      explanation: `${criterion.display_label} — règle conditionnelle manquante`,
    }
  }
  const { if: ifRule, then: thenRule } = criterion.rule as ConditionalRule
  const ifEval = evaluateStructured(ifRule, profile)

  // If-clause not applicable → criterion is non-relevant, score 1.
  if (!ifEval.satisfied) {
    return {
      score: 1,
      matched: true,
      explanation: `${criterion.display_label} — condition non applicable (✓ ignoré)`,
    }
  }
  const thenEval = evaluateStructured(thenRule, profile)
  const matched = thenEval.satisfied
  return {
    score: matched ? 1 : 0,
    matched,
    explanation: formatStructuredExplanation(
      criterion.display_label,
      thenRule,
      thenEval.resolvedValue,
      matched,
      criterion.polarity,
    ),
  }
}

function scoreSemantic(
  criterion: ParsedCriterion,
  profile: PropertyProfile,
): ScoreOutcome {
  const hint = criterion.semantic_hint
  if (!hint) {
    return {
      score: 0.5,
      matched: true,
      explanation: `${criterion.display_label} — hint sémantique absent (neutre 0.5)`,
    }
  }
  const key = resolveSemanticKey(hint)
  if (!key) {
    return {
      score: 0.5,
      matched: true,
      explanation: `${criterion.display_label} — pas de mapping sémantique (neutre 0.5)`,
    }
  }
  const value = profile.semantic[key]
  if (value === null || value === undefined) {
    return {
      score: 0.5,
      matched: true,
      explanation: `${criterion.display_label} — donnée sémantique "${key}" manquante (neutre 0.5)`,
    }
  }
  const raw = clamp01(value)
  // Negative polarity ⇒ we want a LOW raw score to mean "matched" (the
  // unwanted attribute is absent). Flip both the surface score and the
  // matched cutoff so dealbreakers exclude properties where the bad
  // attribute is present.
  const effectiveScore = criterion.polarity === 'negative' ? 1 - raw : raw
  const matched = criterion.polarity === 'negative' ? raw < 0.5 : raw >= 0.5
  return {
    score: effectiveScore,
    matched,
    explanation: `${criterion.display_label} — score sémantique "${key}" = ${raw.toFixed(2)} (polarité ${criterion.polarity})`,
  }
}

function scoreFuzzy(criterion: ParsedCriterion): ScoreOutcome {
  console.warn(`[matching] fuzzy criterion not yet scorable: "${criterion.display_label}"`)
  return {
    score: 0.5,
    matched: true,
    explanation: `${criterion.display_label} — critère flou non scorable (coef 0)`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured-rule evaluation
// ─────────────────────────────────────────────────────────────────────────────

interface StructuredEval {
  satisfied: boolean
  resolvedValue: unknown
}

/**
 * Evaluate a single structured rule against a property profile.
 * Returns `{ satisfied: false, resolvedValue: undefined }` when the
 * attribute cannot be resolved — the engine treats that as rule failure
 * per the spec's strict 0/1 rule.
 */
function evaluateStructured(rule: StructuredRule, profile: PropertyProfile): StructuredEval {
  const resolvedValue = resolveAttribute(rule.attribute, profile.structured)
  if (resolvedValue === undefined || resolvedValue === null) {
    return { satisfied: false, resolvedValue }
  }
  return { satisfied: compare(resolvedValue, rule.operator, rule.value), resolvedValue }
}

/**
 * Resolve a dotted attribute path against the property's structured
 * attributes. Returns `undefined` when the path is unknown so downstream
 * logic can treat it as a missing-data failure.
 *
 * The mapping intentionally covers all paths produced by the existing
 * parser + tags module. New attributes get added here as the parser
 * vocabulary grows.
 */
function resolveAttribute(
  path: string,
  s: PropertyStructuredAttributes,
): unknown {
  switch (path) {
    // Outdoor
    case 'terrace.exists':           return s.has_terrace
    case 'terrace.surface_m2':       return s.terrace_surface_m2 ?? 0
    case 'balcony.exists':           return s.has_balcony
    case 'balcony.surface_m2':       return s.balcony_surface_m2 ?? 0
    case 'garden.exists':            return s.has_garden
    case 'garden.surface_m2':        return s.garden_surface_m2 ?? 0
    case 'has_outdoor_space':        return s.has_terrace || s.has_balcony || s.has_garden

    // Floor
    case 'floor':                    return s.floor
    case 'floor.is_ground':          return s.is_ground_floor
    case 'floor.is_top':             return s.floor === s.total_floors

    // Building amenities
    case 'elevator':                 return s.has_elevator
    case 'cellar':                   return s.has_cellar
    case 'parking':                  return s.has_parking
    case 'guardian':                 return s.has_concierge

    // Bedroom / living
    case 'bedroom.count':            return s.bedroom_count
    case 'bedroom_count':            return s.bedroom_count
    case 'bedroom.street_side':      return s.bedroom_street_side
    case 'living.surface_m2':        return s.surface_m2
    case 'surface_m2':               return s.surface_m2
    case 'room_count':               return s.room_count

    // Hard buyer-side filters
    case 'price':                    return s.price
    case 'property_type':            return s.property_type

    // Orientation — operator '=' / 'in' against the array of facades
    case 'living.exposure':
    case 'exposure.main':
    case 'orientation':              return s.orientation

    // Building meta
    case 'building.year':            return s.building_year
    case 'building.recent':
      return s.building_year !== null && s.building_year >= 2000
    case 'noise.low':                return s.is_quiet_street
    case 'dpe.rating':               return s.dpe_rating

    default:
      return undefined
  }
}

/**
 * Compare a resolved attribute value against the rule operand. Handles:
 *  - scalar comparisons (numbers / booleans / strings)
 *  - array LHS with `=` / `!=` (orientation = "south" → array includes)
 *  - `in` / `not_in` for membership tests
 */
function compare(lhs: unknown, op: RuleOperator, rhs: RuleValue): boolean {
  // Array LHS — orientation, etc.
  if (Array.isArray(lhs)) {
    if (op === '=') return Array.isArray(rhs) ? rhs.every((v) => lhs.includes(v as never)) : lhs.includes(rhs as never)
    if (op === '!=') return Array.isArray(rhs) ? !rhs.some((v) => lhs.includes(v as never)) : !lhs.includes(rhs as never)
    if (op === 'in') {
      return Array.isArray(rhs)
        ? rhs.some((v) => lhs.includes(v as never))
        : lhs.includes(rhs as never)
    }
    if (op === 'not_in') {
      return Array.isArray(rhs)
        ? !rhs.some((v) => lhs.includes(v as never))
        : !lhs.includes(rhs as never)
    }
    return false
  }

  // Membership
  if (op === 'in') {
    return Array.isArray(rhs) && rhs.includes(lhs as never)
  }
  if (op === 'not_in') {
    return Array.isArray(rhs) && !rhs.includes(lhs as never)
  }

  // Scalar
  switch (op) {
    case '=':  return lhs === rhs
    case '!=': return lhs !== rhs
    case '>':  return typeof lhs === 'number' && typeof rhs === 'number' && lhs > rhs
    case '>=': return typeof lhs === 'number' && typeof rhs === 'number' && lhs >= rhs
    case '<':  return typeof lhs === 'number' && typeof rhs === 'number' && lhs < rhs
    case '<=': return typeof lhs === 'number' && typeof rhs === 'number' && lhs <= rhs
  }
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Coefficients & explanations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weight applied to a criterion when computing the global score.
 *  - fuzzy           → 0 (placeholder; not yet scorable)
 *  - desired         → 1
 *  - mandatory       → 3
 *  - dealbreaker     → 5 (in practice exclusion fires first when it fails)
 */
function coefficientFor(matchType: CriterionMatchType, importance: ParsedCriterion['importance']): number {
  if (matchType === 'fuzzy') return 0
  switch (importance) {
    case 'desired':     return 1
    case 'mandatory':   return 3
    case 'dealbreaker': return 5
  }
}

function formatStructuredExplanation(
  label: string,
  rule: StructuredRule,
  resolvedValue: unknown,
  matched: boolean,
  _polarity: CriterionPolarity,
): string {
  const indicator = matched ? '✓' : '✗'
  if (resolvedValue === undefined) {
    return `${label} — attribut ${rule.attribute} indisponible ${indicator}`
  }
  return `${label} — ${rule.attribute} = ${formatValue(resolvedValue)} (attendu ${rule.operator} ${formatValue(rule.value)}) ${indicator}`
}

function formatValue(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return `[${v.join(', ')}]`
  return String(v)
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

// Re-export types for convenience.
export type { MatchResult, CriterionScore, PropertyProfile } from './types'
