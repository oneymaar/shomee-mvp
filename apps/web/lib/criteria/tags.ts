/**
 * Shomee — tag-to-criteria mapper.
 *
 * Predefined tags chosen by the user during onboarding (e.g. "Ascenseur",
 * "Cave", "Terrasse") are lifted to the same `ParsedCriterion` shape as
 * free-text criteria so the downstream matching engine only deals with
 * one type. Each tag yields a single positive, `desired` criterion with
 * a structured boolean rule.
 *
 * Unknown tags fall back to a semantic criterion carrying the tag label
 * as a hint — better than dropping user input silently.
 */

import { randomUUID } from 'crypto'
import type {
  CriterionCategory,
  ParsedCriterion,
  StructuredRule,
} from '@shomee/core/criteria/types'

interface TagMapping {
  category: CriterionCategory
  attribute: string
  /** Display reformulation. If absent, the tag itself is used. */
  display?: string
}

/**
 * Canonical tag mappings. Keys are matched case- and accent-insensitively
 * via {@link normalizeTag}. New onboarding tags are added here.
 */
const TAG_MAP: Record<string, TagMapping> = {
  // Le bien
  exterieur:           { category: 'outdoor',  attribute: 'has_outdoor_space',  display: 'Extérieur' },
  terrasse:            { category: 'outdoor',  attribute: 'terrace.exists',     display: 'Terrasse' },
  balcon:              { category: 'outdoor',  attribute: 'balcony.exists',     display: 'Balcon' },
  'dernier etage':     { category: 'building', attribute: 'floor.is_top',       display: 'Dernier étage' },
  traversant:          { category: 'living',   attribute: 'is_through',         display: 'Traversant' },
  lumineux:            { category: 'living',   attribute: 'living.luminosity',  display: 'Lumineux' },
  calme:               { category: 'ambiance', attribute: 'noise.low',          display: 'Calme' },
  'vue degagee':       { category: 'living',   attribute: 'view.unobstructed',  display: 'Vue dégagée' },
  'cuisine ouverte':   { category: 'living',   attribute: 'kitchen.open_plan',  display: 'Cuisine ouverte' },
  'charme cachet':     { category: 'ambiance', attribute: 'character.heritage', display: 'Charme / cachet' },

  // L'immeuble
  ascenseur:                       { category: 'building', attribute: 'elevator',                display: 'Ascenseur' },
  gardien:                         { category: 'building', attribute: 'guardian',                display: 'Gardien' },
  parking:                         { category: 'building', attribute: 'parking',                 display: 'Parking' },
  cave:                            { category: 'building', attribute: 'cellar',                  display: 'Cave' },
  'local velo':                    { category: 'building', attribute: 'bike_room',               display: 'Local vélo' },
  'faibles charges':               { category: 'building', attribute: 'charges.low',             display: 'Faibles charges' },
  'petite copropriete':            { category: 'building', attribute: 'building.small_copro',    display: 'Petite copropriété' },
  'immeuble recent':               { category: 'building', attribute: 'building.recent',         display: 'Immeuble récent' },
  standing:                        { category: 'building', attribute: 'building.standing',       display: 'Standing' },
  'parties communes renovees':     { category: 'building', attribute: 'building.common_renewed', display: 'Parties communes rénovées' },
}

/**
 * Convert a list of selected onboarding tags into `ParsedCriterion[]`.
 * Each tag becomes a `desired` positive criterion with a boolean
 * `structured_rule`. Unknown tags fall back to a `semantic` criterion so
 * we never drop user input on the floor.
 *
 * @param tags     Raw tag strings as picked in the UI.
 * @param rawInput Optional context string copied into each criterion's
 *                 `raw_input` field for traceability (defaults to the tag).
 */
export function tagsToCriteria(tags: string[], rawInput?: string): ParsedCriterion[] {
  const unique = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)))
  return unique.map((tag) => {
    const normalized = normalizeTag(tag)
    const mapping = TAG_MAP[normalized]
    if (mapping) {
      const rule: StructuredRule = {
        attribute: mapping.attribute,
        operator: '=',
        value: true,
      }
      return baseCriterion({
        display_label: mapping.display ?? tag,
        category: mapping.category,
        match_type: 'structured_rule',
        rule,
        raw_input: rawInput ?? tag,
        confidence: 1,
      })
    }

    // Unknown tag — keep it as a semantic hint so the matcher can still try.
    return baseCriterion({
      display_label: tag,
      category: 'ambiance',
      match_type: 'semantic',
      rule: null,
      semantic_hint: tag,
      raw_input: rawInput ?? tag,
      confidence: 0.6,
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function baseCriterion(opts: {
  display_label: string
  category: CriterionCategory
  match_type: ParsedCriterion['match_type']
  rule: ParsedCriterion['rule']
  semantic_hint?: string | null
  raw_input: string
  confidence: number
}): ParsedCriterion {
  return {
    id: randomUUID(),
    display_label: opts.display_label,
    category: opts.category,
    polarity: 'positive',
    importance: 'desired',
    match_type: opts.match_type,
    rule: opts.rule,
    semantic_hint: opts.semantic_hint ?? null,
    raw_input: opts.raw_input,
    confidence: opts.confidence,
    importance_override: false,
  }
}

/**
 * Normalise a tag for lookup: lowercase, strip diacritics, collapse all
 * non-alphanumeric runs to single spaces, trim. So "Vue dégagée",
 * "vue dégagée " and "VUE DÉGAGÉE" all hit the same key.
 */
function normalizeTag(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
