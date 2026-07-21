/**
 * Harnais de non-régression — moteur de matching, calibration, normaliseur
 * d'attributs, parser de critères, estimateur de rareté.
 *
 * Exécution : `npx tsx scripts/matching-harness.ts` (depuis packages/core).
 * Sort en code 1 au moindre échec. À lancer avant/après toute modification
 * de matching/* ou criteria/*.
 */

import { matchProperty } from '../src/matching/engine'
import { calibrateScore } from '../src/matching/calibration'
import { normalizePropertyText } from '../src/matching/attributes'
import { parseCriterionText } from '../src/criteria/parser'
import { estimateRarity } from '../src/matching/estimator'
import type {
  PropertyProfile,
  PropertyStructuredAttributes,
} from '../src/matching/types'
import type { ParsedCriterion, UserCriteriaBrief } from '../src/criteria/types'

let failures = 0
let checks = 0
function check(label: string, cond: boolean, detail?: string) {
  checks++
  if (!cond) {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(t: string) { console.log(`\n═══ ${t} ═══`) }

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE: PropertyStructuredAttributes = {
  price: 750_000,
  property_type: 'appartement',
  floor: 3,
  total_floors: 6,
  has_elevator: false,
  has_terrace: null,
  terrace_surface_m2: null,
  has_balcony: null,
  balcony_surface_m2: null,
  has_garden: null,
  garden_surface_m2: null,
  has_cellar: null,
  has_parking: null,
  has_concierge: null,
  is_ground_floor: false,
  surface_m2: 62,
  room_count: 3,
  bedroom_count: 2,
  bedroom_street_side: null,
  orientation: [],
  is_quiet_street: null,
  building_year: null,
  dpe_rating: 'D',
}

function profile(over: Partial<PropertyStructuredAttributes>, id = 'p1'): PropertyProfile {
  return {
    property_id: id,
    structured: { ...BASE, ...over },
    semantic: { luminosity: null, quietness: null, charm: null, spaciousness: null, living_quality: null, outdoor_usability: null },
    raw_description: '',
    enriched_at: null,
  }
}

function brief(criteria: ParsedCriterion[]): UserCriteriaBrief {
  return {
    user_id: 'test',
    parsed_criteria: criteria,
    raw_tags: [],
    raw_text_input: '',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }
}

// ─── A. Parser de critères déterministe ─────────────────────────────────────

section('A — parser de critères (déterministe)')

const condCrit = parseCriterionText('ascenseur obligatoire à partir du 4e')
check('A1 conditionnel produit', condCrit?.match_type === 'conditional_rule',
  JSON.stringify(condCrit?.rule))
check('A1 importance mandatory', condCrit?.importance === 'mandatory')

const visCrit = parseCriterionText('pas de vis-à-vis')
check('A2 vis-à-vis structuré', visCrit?.match_type === 'structured_rule' &&
  JSON.stringify(visCrit.rule) === JSON.stringify({ attribute: 'vis_a_vis', operator: '=', value: false }),
  JSON.stringify(visCrit?.rule))
check('A2 polarité négative', visCrit?.polarity === 'negative')

const terCrit = parseCriterionText("terrasse d'au moins 15 m²")
check('A3 seuil terrasse', JSON.stringify(terCrit?.rule) === JSON.stringify({ attribute: 'terrace.surface_m2', operator: '>=', value: 15 }),
  JSON.stringify(terCrit?.rule))

const topCrit = parseCriterionText('dernier étage')
check('A4 dernier étage', JSON.stringify(topCrit?.rule) === JSON.stringify({ attribute: 'floor.is_top', operator: '=', value: true }))

const noLiftCrit = parseCriterionText('sans ascenseur')
check('A5 sans ascenseur → elevator=false', JSON.stringify(noLiftCrit?.rule) === JSON.stringify({ attribute: 'elevator', operator: '=', value: false }))

check('A6 texte non structurable → null', parseCriterionText('ambiance cosy de folie') === null)
console.log(failures === 0 ? '✓ parser OK' : '✗ voir ci-dessus')

// ─── B. Normaliseur d'attributs côté bien ───────────────────────────────────

section('B — normaliseur bien (features/tags/description)')

const norm1 = normalizePropertyText({
  features: ['3ème étage', "Pas d'ascenseur"],
  description: 'Charmant appartement sans vis-à-vis, refait à neuf, très lumineux.',
  tags: [{ label: 'cheminée', source: 'AI_VIDEO' }],
})
check('B1 étage extrait', norm1.assertions.floor === 3, String(norm1.assertions.floor))
check('B1 ascenseur affirmé ABSENT', norm1.assertions.has_elevator === false)
check('B1 vis-à-vis affirmé absent', norm1.assertions.has_vis_a_vis === false)
check('B1 refait à neuf', norm1.assertions.is_renovated === true)
check('B1 cheminée (IA vidéo)', norm1.assertions.has_fireplace === true && norm1.provenance.has_fireplace === 'ai_video')
check('B1 luminosité hint', (norm1.semanticHints.luminosity ?? 0) >= 0.7)

const norm2 = normalizePropertyText({ description: 'Belle terrasse au calme, rue calme.' })
check('B2 terrasse affirmée', norm2.assertions.has_terrace === true)
check('B2 calme', norm2.assertions.is_quiet_street === true)
check('B2 ascenseur INCONNU (pas mentionné)', norm2.assertions.has_elevator === undefined)
console.log('✓ normaliseur exécuté')

// ─── C. Moteur — tri-état ───────────────────────────────────────────────────

section('C — moteur tri-état (D1)')

// C1 — LE CAS DRAPEAU, de bout en bout : bien « 3e sans ascenseur » (normalisé)
// vs critère « ascenseur obligatoire à partir du 4e » (parsé) → MATCHÉ.
{
  const bienNorm = normalizePropertyText({ features: ['3ème étage', "pas d'ascenseur"] })
  const p = profile({ floor: bienNorm.assertions.floor ?? null, has_elevator: bienNorm.assertions.has_elevator ?? null })
  const r = matchProperty(p, brief([condCrit!]))
  const cs = r.criteria_scores[0]
  check('C1 vacuité : 3e sans ascenseur MATCHE', cs.status === 'matched', cs.explanation)
  check('C1 score plein', r.global_score === 100, String(r.global_score))
}

// C2 — 5e sans ascenseur → échec obligatoire.
{
  const r = matchProperty(profile({ floor: 5, has_elevator: false }), brief([condCrit!]))
  check('C2 5e sans ascenseur ÉCHOUE', r.criteria_scores[0].status === 'unmatched')
  check('C2 mandatory_failures', r.mandatory_failures.length === 1)
}

// C3 — étage INCONNU → doute, pas un échec.
{
  const r = matchProperty(profile({ floor: null, has_elevator: null }), brief([condCrit!]))
  check('C3 statut unknown', r.criteria_scores[0].status === 'unknown', r.criteria_scores[0].explanation)
  check('C3 dans doubts', r.doubts.length === 1)
  check('C3 PAS dans mandatory_failures', r.mandatory_failures.length === 0)
}

// C4 — rédhibitoire sur donnée inconnue → PAS d'exclusion (données ≠ désaccord).
{
  const db: ParsedCriterion = { ...visCrit!, importance: 'dealbreaker' }
  const r = matchProperty(profile({ has_vis_a_vis: null }), brief([db]))
  check('C4 pas exclu sur inconnu', r.is_excluded === false)
  check('C4 doute enregistré', r.doubts.length === 1)
  const r2 = matchProperty(profile({ has_vis_a_vis: true }), brief([db]))
  check('C4bis exclu quand vis-à-vis AFFIRMÉ', r2.is_excluded === true)
}

// C5 — ordre des scores : matché > inconnu > échoué (petite pénalité D1).
{
  const crit = parseCriterionText('ascenseur obligatoire')! // elevator = true, mandatory
  const desiredTer = parseCriterionText('terrasse')! // desired
  const bMatched = matchProperty(profile({ has_elevator: true, has_terrace: true }), brief([crit, desiredTer]))
  const bUnknown = matchProperty(profile({ has_elevator: null, has_terrace: true }), brief([crit, desiredTer]))
  const bFailed = matchProperty(profile({ has_elevator: false, has_terrace: true }), brief([crit, desiredTer]))
  check('C5 matché > inconnu', bMatched.global_score > bUnknown.global_score,
    `${bMatched.global_score} vs ${bUnknown.global_score}`)
  check('C5 inconnu > échoué', bUnknown.global_score > bFailed.global_score,
    `${bUnknown.global_score} vs ${bFailed.global_score}`)
  check('C5 pénalité PETITE (inconnu ≥ 75 % du matché)', bUnknown.global_score >= bMatched.global_score * 0.75,
    `${bUnknown.global_score} vs ${bMatched.global_score}`)
}

// C6 — sémantique manquante → doute (plus jamais « matché neutre »).
{
  const sem: ParsedCriterion = {
    id: 'sem1', display_label: 'Lumineux', category: 'ambiance', polarity: 'positive',
    importance: 'desired', match_type: 'semantic', rule: null, semantic_hint: 'lumineux',
    raw_input: 'lumineux', confidence: 1, importance_override: false,
  }
  const r = matchProperty(profile({}), brief([sem]))
  check('C6 sémantique manquante = unknown', r.criteria_scores[0].status === 'unknown')
  check('C6 doubts', r.doubts.includes('Lumineux'))
}
console.log('✓ moteur exécuté')

// ─── D. Calibration (D5) ────────────────────────────────────────────────────

section('D — calibration affichage (plancher 60, 90+ réservé)')
{
  const crit = parseCriterionText('ascenseur obligatoire')!
  const d1 = parseCriterionText('terrasse')!
  const d2 = parseCriterionText('cheminée')!
  const d3 = parseCriterionText('parking')!
  const d4 = parseCriterionText('cave')!
  const allDesired = [d1, d2, d3, d4].map((c) => ({ ...c, importance: 'desired' as const }))

  // Coup de cœur : obligatoire OK + 4/4 souhaités + 0 doute.
  const perfect = matchProperty(
    profile({ has_elevator: true, has_terrace: true, has_fireplace: true, has_parking: true, has_cellar: true }),
    brief([crit, ...allDesired]))
  const calPerfect = calibrateScore(perfect)
  check('D1 coup de cœur ≥ 90', calPerfect.display >= 90 && calPerfect.topTier,
    `display=${calPerfect.display} raw=${calPerfect.raw}`)

  // Bien moyen : obligatoire OK, 1/4 souhaités, 1 inconnu.
  const average = matchProperty(
    profile({ has_elevator: true, has_terrace: true, has_fireplace: false, has_parking: false, has_cellar: null }),
    brief([crit, ...allDesired]))
  const calAverage = calibrateScore(average)
  check('D2 bien moyen dans [60..89]', calAverage.display >= 60 && calAverage.display <= 89,
    `display=${calAverage.display} raw=${calAverage.raw}`)
  check('D2 pas topTier', calAverage.topTier === false)

  // Obligatoire ÉCHOUÉ → jamais 90+.
  const failed = matchProperty(
    profile({ has_elevator: false, has_terrace: true, has_fireplace: true, has_parking: true, has_cellar: true }),
    brief([crit, ...allDesired]))
  const calFailed = calibrateScore(failed)
  check('D3 obligatoire échoué < 90', calFailed.display < 90, `display=${calFailed.display}`)
  check('D3 plancher 60 respecté', calFailed.display >= 60)
}
console.log('✓ calibration exécutée')

// ─── E. Estimateur de rareté ────────────────────────────────────────────────

section('E — estimateur (récap onboarding)')
{
  // Fenêtre non représentative (seed massif) → rotation du stock.
  const seedy = estimateRarity({ matchingCount: 120, matchingLast28d: 120, poolCount: 1500, poolLast28d: 1450 })
  check('E1 fallback rotation', seedy.fromRealWindow === false)
  check('E1 bande cohérente (120×2.5% = 3/sem → selective)', seedy.band === 'selective', seedy.band)

  // Fenêtre représentative → comptage réel.
  const real = estimateRarity({ matchingCount: 200, matchingLast28d: 48, poolCount: 2000, poolLast28d: 400 })
  check('E2 fenêtre réelle', real.fromRealWindow === true)
  check('E2 12/sem → abundant', real.band === 'abundant', `${real.perWeekMin}-${real.perWeekMax} ${real.band}`)

  const rare = estimateRarity({ matchingCount: 8, matchingLast28d: null, poolCount: 1500, poolLast28d: null })
  check('E3 critères serrés → rare', rare.band === 'rare', rare.band)
  check('E3 message préparant à la rareté', /précis|pépite/i.test(rare.message))
}
console.log('✓ estimateur exécuté')

console.log(`\n${checks} vérifications, ${failures} échec(s).`)
process.exit(failures > 0 ? 1 : 0)
