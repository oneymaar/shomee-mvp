import { describe, it } from 'vitest'
import { matchProperty } from '../matching/engine'
import { calibrateScore } from '../matching/calibration'
import type { UserCriteriaBrief, ParsedCriterion } from '../criteria/types'
import type { PropertyProfile } from '../matching/types'

let n = 0
const mk = (o: Record<string, unknown>): ParsedCriterion => ({
  id: `c${++n}`, display_label: 'x', category: 'living', polarity: 'positive',
  importance: 'mandatory', match_type: 'structured_rule', rule: null,
  semantic_hint: null, confidence: 1, source_text: '', importance_override: false,
  ...o,
}) as unknown as ParsedCriterion

const brief = {
  criteria: [], raw_tags: [], free_text: '',
  parsed_criteria: [
    mk({ display_label: 'Lumineux', importance: 'dealbreaker', match_type: 'semantic', semantic_hint: 'lumineux', category: 'ambiance' }),
    mk({ display_label: 'Surface >= 30 m2', rule: { attribute: 'surface_m2', operator: '>=', value: 30 } }),
    mk({ display_label: 'Prix >= 50000 EUR', rule: { attribute: 'price', operator: '>=', value: 50000 }, category: 'location' }),
    mk({ display_label: '1 pieces minimum', rule: { attribute: 'room_count', operator: '>=', value: 1 } }),
  ],
} as unknown as UserCriteriaBrief

const clamp01 = (v: number) => (!Number.isFinite(v) ? 0.5 : Math.max(0, Math.min(1, v)))

function run(lum: number | undefined, label: string) {
  const p = {
    property_id: label,
    structured: {
      price: 0, property_type: 'appartement', floor: 0, total_floors: 6,
      has_elevator: false, has_terrace: false, terrace_surface_m2: null,
      has_balcony: false, balcony_surface_m2: null, has_garden: false,
      garden_surface_m2: null, has_cellar: false, has_parking: false,
      has_concierge: false, is_ground_floor: true, surface_m2: 0,
      room_count: 0, bedroom_count: 1, bedroom_street_side: null,
      orientation: [], is_quiet_street: null, building_year: null, dpe_rating: 'G',
    },
    semantic: {
      luminosity: clamp01(lum as number), quietness: clamp01(lum as number),
      charm: clamp01(lum as number), spaciousness: null, living_quality: null,
      outdoor_usability: clamp01(lum as number),
    },
    raw_description: 'erreur LLM', enriched_at: new Date(),
  } as unknown as PropertyProfile
  const r = matchProperty(p, brief)
  const c = calibrateScore(r)
  console.log(`\n### ${label} — luminosity vue par le moteur = ${(p as any).semantic.luminosity}`)
  console.log('   exclu          :', r.is_excluded, JSON.stringify(r.exclusion_reasons))
  console.log('   echecs oblig.  :', JSON.stringify(r.mandatory_failures))
  console.log('   doutes         :', JSON.stringify(r.doubts))
  console.log('   score brut     :', r.global_score, '-> AFFICHE :', c.display + '%')
  console.log('   statuts        :', r.criteria_scores.map((s) => `${s.display_label}=${s.status}`).join(' | '))
}

describe('sim', () => {
  it('fiche vide', () => {
    run(undefined, 'champ luminosity ABSENT (cas reel)')
    run(0, 'champ luminosity = 0 explicite')
    run(0.85, 'fiche normale mais sombre absente -> 0.85')
  })
})
