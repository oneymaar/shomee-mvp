/**
 * Engine tests — pure deterministic matching.
 *
 * Builds a baseline property + brief via helpers, then overrides per case.
 * The five canonical cases from the spec are covered, plus a quick sanity
 * check on the scoring weights.
 */

import { describe, expect, it } from 'vitest'
import { matchProperty } from '@/lib/matching/engine'
import type {
  PropertyProfile,
  PropertyStructuredAttributes,
  PropertySemanticScores,
} from '@/lib/matching/types'
import type {
  ParsedCriterion,
  UserCriteriaBrief,
} from '@/lib/criteria/types'

// ─── Builders ────────────────────────────────────────────────────────────

function structured(overrides: Partial<PropertyStructuredAttributes> = {}): PropertyStructuredAttributes {
  return {
    floor: 3,
    total_floors: 6,
    has_elevator: true,
    has_terrace: false,
    terrace_surface_m2: null,
    has_balcony: false,
    balcony_surface_m2: null,
    has_garden: false,
    garden_surface_m2: null,
    has_cellar: false,
    has_parking: false,
    has_concierge: false,
    is_ground_floor: false,
    surface_m2: 60,
    room_count: 3,
    bedroom_count: 2,
    bedroom_street_side: false,
    orientation: ['south'],
    is_quiet_street: true,
    building_year: 1995,
    dpe_rating: 'D',
    ...overrides,
  }
}

function semanticScores(overrides: Partial<PropertySemanticScores> = {}): PropertySemanticScores {
  return {
    luminosity: 0.8,
    quietness: 0.7,
    charm: 0.6,
    spaciousness: 0.6,
    living_quality: 0.7,
    outdoor_usability: null,
    ...overrides,
  }
}

function property(
  id: string,
  structuredOverrides: Partial<PropertyStructuredAttributes> = {},
  semanticOverrides: Partial<PropertySemanticScores> = {},
): PropertyProfile {
  return {
    property_id: id,
    structured: structured(structuredOverrides),
    semantic: semanticScores(semanticOverrides),
    raw_description: 'Test listing',
    enriched_at: new Date('2026-05-25T12:00:00Z'),
  }
}

function brief(criteria: ParsedCriterion[]): UserCriteriaBrief {
  const now = new Date().toISOString()
  return {
    user_id: 'test-user',
    parsed_criteria: criteria,
    raw_tags: [],
    raw_text_input: '',
    created_at: now,
    updated_at: now,
  }
}

function baseCriterion(partial: Partial<ParsedCriterion>): ParsedCriterion {
  return {
    id: 'c-default',
    display_label: 'Default',
    category: 'building',
    polarity: 'positive',
    importance: 'desired',
    match_type: 'structured_rule',
    rule: null,
    semantic_hint: null,
    raw_input: '',
    confidence: 1,
    importance_override: false,
    ...partial,
  }
}

// ─── Cas 1 — Dealbreaker déclenché ───────────────────────────────────────

describe('Cas 1 — dealbreaker triggered', () => {
  it('excludes the property and sets global_score to 0', () => {
    const c = baseCriterion({
      id: 'c1',
      display_label: 'Pas de RDC',
      polarity: 'negative',
      importance: 'dealbreaker',
      match_type: 'structured_rule',
      rule: { attribute: 'floor.is_ground', operator: '=', value: false },
    })
    const result = matchProperty(
      property('p1', { is_ground_floor: true, floor: 0 }),
      brief([c]),
    )

    expect(result.is_excluded).toBe(true)
    expect(result.global_score).toBe(0)
    expect(result.exclusion_reasons).toEqual(['Pas de RDC'])
    expect(result.criteria_scores[0].matched).toBe(false)
    expect(result.criteria_scores[0].score).toBe(0)
  })
})

// ─── Cas 2 — Conditional rule, if-clause non applicable ──────────────────

describe('Cas 2 — conditional rule, if-clause not applicable', () => {
  it('scores 1 (ignored) and does not flag a mandatory failure', () => {
    const c = baseCriterion({
      id: 'c2',
      display_label: 'Ascenseur si étage ≥ 3',
      importance: 'mandatory',
      match_type: 'conditional_rule',
      rule: {
        if:   { attribute: 'floor',    operator: '>=', value: 3 },
        then: { attribute: 'elevator', operator: '=',  value: true },
      },
    })
    const result = matchProperty(
      property('p2', { floor: 2, has_elevator: false }),
      brief([c]),
    )

    expect(result.is_excluded).toBe(false)
    expect(result.criteria_scores[0].score).toBe(1)
    expect(result.criteria_scores[0].matched).toBe(true)
    expect(result.mandatory_failures).toEqual([])
  })
})

// ─── Cas 3 — Conditional rule, if-clause applicable et échouée ───────────

describe('Cas 3 — conditional rule, if-clause applicable and then-clause fails', () => {
  it('scores 0 and lists the criterion in mandatory_failures', () => {
    const c = baseCriterion({
      id: 'c3',
      display_label: 'Ascenseur si étage ≥ 3',
      importance: 'mandatory',
      match_type: 'conditional_rule',
      rule: {
        if:   { attribute: 'floor',    operator: '>=', value: 3 },
        then: { attribute: 'elevator', operator: '=',  value: true },
      },
    })
    const result = matchProperty(
      property('p3', { floor: 4, has_elevator: false }),
      brief([c]),
    )

    expect(result.is_excluded).toBe(false)
    expect(result.criteria_scores[0].score).toBe(0)
    expect(result.criteria_scores[0].matched).toBe(false)
    expect(result.mandatory_failures).toEqual(['Ascenseur si étage ≥ 3'])
  })
})

// ─── Cas 4 — Score sémantique manquant ────────────────────────────────────

describe('Cas 4 — missing semantic score', () => {
  it('returns 0.5 (neutral) without excluding the property', () => {
    const c = baseCriterion({
      id: 'c4',
      display_label: 'Salon lumineux',
      importance: 'desired',
      match_type: 'semantic',
      semantic_hint: 'lumineux',
      rule: null,
    })
    const result = matchProperty(
      property('p4', {}, { luminosity: null }),
      brief([c]),
    )

    expect(result.is_excluded).toBe(false)
    expect(result.criteria_scores[0].score).toBe(0.5)
    expect(result.criteria_scores[0].matched).toBe(true) // neutral counts as matched
  })
})

// ─── Cas 5 — Score global mixte ───────────────────────────────────────────

describe('Cas 5 — mixed scoring (desired ✓ + mandatory ✗ + dealbreaker ✓)', () => {
  it('does NOT exclude and produces a penalised but non-zero score', () => {
    const terrasseOK = baseCriterion({
      id: 'c5-t',
      display_label: 'Terrasse ≥ 10 m²',
      importance: 'desired',
      match_type: 'structured_rule',
      rule: { attribute: 'terrace.surface_m2', operator: '>=', value: 10 },
    })
    const ascenseurKO = baseCriterion({
      id: 'c5-a',
      display_label: 'Ascenseur',
      importance: 'mandatory',
      match_type: 'structured_rule',
      rule: { attribute: 'elevator', operator: '=', value: true },
    })
    const pasDeRDCOK = baseCriterion({
      id: 'c5-r',
      display_label: 'Pas de RDC',
      polarity: 'negative',
      importance: 'dealbreaker',
      match_type: 'structured_rule',
      rule: { attribute: 'floor.is_ground', operator: '=', value: false },
    })

    const result = matchProperty(
      property('p5', {
        terrace_surface_m2: 12,
        has_terrace: true,
        has_elevator: false, // fails the mandatory
        is_ground_floor: false,
        floor: 2,
      }),
      brief([terrasseOK, ascenseurKO, pasDeRDCOK]),
    )

    expect(result.is_excluded).toBe(false)
    expect(result.mandatory_failures).toEqual(['Ascenseur'])
    expect(result.exclusion_reasons).toEqual([])
    // Expected weighting:
    //   terrasse  : score 1 × coef 1 = 1   (desired)
    //   ascenseur : score 0 × coef 3 = 0   (mandatory failure)
    //   pas RDC   : score 1 × coef 5 = 5   (dealbreaker matched)
    //   global    : (1 + 0 + 5) / (1 + 3 + 5) * 100 ≈ 67
    expect(result.global_score).toBe(67)
    // Sanity: a perfect 100 is unreachable here.
    expect(result.global_score).toBeLessThan(100)
    expect(result.global_score).toBeGreaterThan(0)
  })
})

// ─── Sanity — coefficient distribution ────────────────────────────────────

describe('Coefficients — fuzzy criteria are ignored in the global score', () => {
  it('returns 100 when only a passing desired sits alongside a fuzzy', () => {
    const passingDesired = baseCriterion({
      id: 'sanity-1',
      display_label: 'Cave',
      match_type: 'structured_rule',
      rule: { attribute: 'cellar', operator: '=', value: true },
    })
    const fuzzy = baseCriterion({
      id: 'sanity-2',
      display_label: 'Ambiance cocon',
      category: 'ambiance',
      match_type: 'fuzzy',
      semantic_hint: 'ambiance cocon',
      rule: null,
    })

    const result = matchProperty(
      property('sanity', { has_cellar: true }),
      brief([passingDesired, fuzzy]),
    )

    expect(result.is_excluded).toBe(false)
    expect(result.global_score).toBe(100)
    // Fuzzy criterion appears in the breakdown but contributes nothing.
    expect(result.criteria_scores).toHaveLength(2)
    expect(result.criteria_scores[1].match_type).toBe('fuzzy')
  })
})
