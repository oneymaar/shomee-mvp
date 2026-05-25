/**
 * Shomee — matching engine types.
 *
 * Two layers of property data feed the matching engine:
 *  - {@link PropertyStructuredAttributes}: deterministic, calculable facts
 *    (floor number, has-elevator, terrace surface…). Structured rules
 *    from the parser are evaluated against these.
 *  - {@link PropertySemanticScores}: 0–1 scores precomputed offline from
 *    the listing description and photos (luminosity, quietness, charm…).
 *    Semantic criteria consume these scores directly.
 */

import type {
  CriterionImportance,
  CriterionMatchType,
} from '@/lib/criteria/types'

// ─── Property layers ────────────────────────────────────────────────────────

export type Orientation = 'north' | 'south' | 'east' | 'west'

export type DpeRating = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export interface PropertyStructuredAttributes {
  floor: number
  total_floors: number
  has_elevator: boolean
  has_terrace: boolean
  terrace_surface_m2: number | null
  has_balcony: boolean
  balcony_surface_m2: number | null
  has_garden: boolean
  garden_surface_m2: number | null
  has_cellar: boolean
  has_parking: boolean
  has_concierge: boolean
  is_ground_floor: boolean
  surface_m2: number
  room_count: number
  bedroom_count: number
  bedroom_street_side: boolean | null
  orientation: Orientation[]
  is_quiet_street: boolean | null
  building_year: number | null
  dpe_rating: DpeRating | null
}

export interface PropertySemanticScores {
  luminosity: number | null
  quietness: number | null
  charm: number | null
  spaciousness: number | null
  living_quality: number | null
  outdoor_usability: number | null
}

export interface PropertyProfile {
  property_id: string
  structured: PropertyStructuredAttributes
  semantic: PropertySemanticScores
  raw_description: string
  enriched_at: Date | null
}

// ─── Match result ───────────────────────────────────────────────────────────

export interface CriterionScore {
  criterion_id: string
  display_label: string
  importance: CriterionImportance
  match_type: CriterionMatchType
  /** 0 to 1. Structured rules are strict 0/1; semantic returns the score
   *  directly; conditional returns 1 when the if-clause does not apply. */
  score: number
  /** Derived from `score` per match_type — see engine.ts for the rule. */
  matched: boolean
  /** Human-readable explanation, suitable for UI tooltips. */
  explanation: string
}

export interface MatchResult {
  property_id: string
  /** 0 to 100, rounded. 0 when `is_excluded` is true. */
  global_score: number
  /** True when at least one dealbreaker criterion failed. */
  is_excluded: boolean
  /** Display labels of dealbreaker criteria that failed. */
  exclusion_reasons: string[]
  /** Display labels of mandatory criteria that failed (non-excluding,
   *  but heavily penalised in the global score). */
  mandatory_failures: string[]
  criteria_scores: CriterionScore[]
}
