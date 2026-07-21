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
} from '../criteria/types'

// ─── Property layers ────────────────────────────────────────────────────────

export type Orientation = 'north' | 'south' | 'east' | 'west'

export type DpeRating = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export type PropertyTypeStructured =
  | 'appartement'
  | 'maison'
  | 'loft'
  | 'atelier'

export interface PropertyStructuredAttributes {
  /** Total asking price in euros. Drives hard budget filters. */
  price: number
  /** Coarse type derived from the listing title — pattern-matched in
   *  {@link PropertyStructuredAttributes}'s builder, never persisted. */
  property_type: PropertyTypeStructured
  // TRI-ÉTAT (D1) : `null` = NON RENSEIGNÉ (doute), distinct de `false` =
  // affirmé absent. Les champs toujours connus (prix, surface, pièces)
  // restent non-nullables. Les booléens historiques acceptent null — les
  // builders existants (qui passent des booléens) restent valides.
  floor: number | null
  total_floors: number | null
  has_elevator: boolean | null
  has_terrace: boolean | null
  terrace_surface_m2: number | null
  has_balcony: boolean | null
  balcony_surface_m2: number | null
  has_garden: boolean | null
  garden_surface_m2: number | null
  has_cellar: boolean | null
  has_parking: boolean | null
  has_concierge: boolean | null
  is_ground_floor: boolean | null
  surface_m2: number
  room_count: number
  bedroom_count: number
  bedroom_street_side: boolean | null
  orientation: Orientation[]
  is_quiet_street: boolean | null
  building_year: number | null
  dpe_rating: DpeRating | null
  // ── Attributs pivot ajoutés (harmonisation sémantique) — optionnels pour
  //    ne casser aucun builder existant ; absents ⇒ inconnus. ──
  has_vis_a_vis?: boolean | null
  is_renovated?: boolean | null
  has_fireplace?: boolean | null
  is_traversant?: boolean | null
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

export type CriterionStatus = 'matched' | 'unmatched' | 'unknown'

export interface CriterionScore {
  criterion_id: string
  display_label: string
  importance: CriterionImportance
  match_type: CriterionMatchType
  /** 0 to 1. Structured rules are strict 0/1; semantic returns the score
   *  directly; conditional returns 1 when the if-clause does not apply. */
  score: number
  /** Derived from `score` per match_type — see engine.ts for the rule.
   *  Conservé pour compat ; `status` fait foi (unknown ⇒ matched=false). */
  matched: boolean
  /** TRI-ÉTAT : 'unknown' = donnée du bien non renseignée → section
   *  « doutes » de la modale, petite pénalité (D1), jamais un échec. */
  status: CriterionStatus
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
   *  but heavily penalised in the global score). Statut 'unmatched'
   *  uniquement — les inconnus vont dans `doubts`. */
  mandatory_failures: string[]
  /** Labels des critères en statut 'unknown' (donnée non renseignée) —
   *  la section « doutes » de la modale d'explication. */
  doubts: string[]
  criteria_scores: CriterionScore[]
}
