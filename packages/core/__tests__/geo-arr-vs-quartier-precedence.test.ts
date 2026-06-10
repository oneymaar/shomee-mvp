/**
 * Precision rule: when an inside `administrative_area` (whole arrondissement)
 * coexists with an inside `semantic_neighborhood` (quartier), the
 * arrondissement IRIS must drop out of the result — the arrondissement
 * becomes disambiguation context, not a selected zone.
 *
 * If precise scopes resolve to nothing, the arrondissement is reinstated
 * as a fallback.
 *
 * Uses real Aligre / Bercy entries from `src/data/quartiers.json` so the
 * semantic_neighborhood resolution exercises the same code path as
 * production.
 *
 * Run: npx vitest run __tests__/geo-arr-vs-quartier-precedence.test.ts
 */

import { describe, it, expect, vi } from 'vitest'
import { resolveConstraints, type GeoConstraint } from '@shomee/core/geo/geoConstraintService'
import type { GeoZone } from '@shomee/core/geo/geoDataService'

// ─── Fixture ──────────────────────────────────────────────────────────────────
//
// arr-12  ── qa-12a (3 IRIS: 2 named after Aligre's irisNames, 1 other)
//         ── qa-12b (3 IRIS: 2 named after Bercy's irisNames, 1 other)
// arr-11  ── qa-11a (1 IRIS)
//
// The Aligre / Bercy entries in src/data/quartiers.json provide the
// canonical irisNames that resolve via findQuartierById, so the semantic
// names below must match those entries verbatim.

function makeIris(id: string, name: string, parentId: string): GeoZone {
  return {
    id, name, shortName: name, type: 'iris', parentId,
    feature: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } } as GeoJSON.Feature,
  }
}
function makeQuartier(id: string, parentId: string): GeoZone {
  return {
    id, name: id, shortName: id, type: 'quartier', parentId,
    feature: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } } as GeoJSON.Feature,
  }
}

// IRIS names taken from src/data/quartiers.json — Aligre lists "Quinze-vingts 6..10",
// Bercy lists "Bercy 1..3, 6, 7, Jardin de bercy". We seed two of each plus a stray
// "Other" IRIS per quartier to prove that the arrondissement-wide pool is broader.
const IRIS_ALIGRE_1 = makeIris('iris-a1', 'Quinze-vingts 6', 'qa-12a')
const IRIS_ALIGRE_2 = makeIris('iris-a2', 'Quinze-vingts 7', 'qa-12a')
const IRIS_OTHER_12A = makeIris('iris-o12a', 'Other 12A', 'qa-12a')
const IRIS_BERCY_1 = makeIris('iris-b1', 'Bercy 1', 'qa-12b')
const IRIS_BERCY_2 = makeIris('iris-b2', 'Bercy 2', 'qa-12b')
const IRIS_OTHER_12B = makeIris('iris-o12b', 'Other 12B', 'qa-12b')
const IRIS_11A = makeIris('iris-11a', 'Eleven A', 'qa-11a')

const ALL_IRIS = [
  IRIS_ALIGRE_1, IRIS_ALIGRE_2, IRIS_OTHER_12A,
  IRIS_BERCY_1, IRIS_BERCY_2, IRIS_OTHER_12B,
  IRIS_11A,
]
const QUARTIERS = [
  makeQuartier('qa-12a', 'arr-12'),
  makeQuartier('qa-12b', 'arr-12'),
  makeQuartier('qa-11a', 'arr-11'),
]

vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

const arrIn = (zoneId: string, label: string): GeoConstraint => ({
  type: 'administrative_area', label, operator: 'inside', confidence: 0.9, zoneId,
})
const quartierIn = (neighborhoodId: string, label: string): GeoConstraint => ({
  type: 'semantic_neighborhood', label, operator: 'inside', confidence: 0.9, neighborhoodId,
})
const quartierExclude = (neighborhoodId: string, label: string): GeoConstraint => ({
  type: 'semantic_neighborhood', label, operator: 'exclude', confidence: 0.9, neighborhoodId,
})

// ─── Cases ────────────────────────────────────────────────────────────────────

describe('arr + quartier precision rule', () => {
  it('"Paris 12 quartier Aligre" → only Aligre IRIS, not all of arr-12', () => {
    const res = resolveConstraints(
      [arrIn('arr-12', 'Paris 12'), quartierIn('aligre', 'Aligre')],
      ALL_IRIS, QUARTIERS, [],
    )
    expect(res.irisIds.sort()).toEqual(['iris-a1', 'iris-a2'])
  })

  it('"Paris 12" alone → all IRIS of arr-12 (unchanged)', () => {
    const res = resolveConstraints([arrIn('arr-12', 'Paris 12')], ALL_IRIS, QUARTIERS, [])
    expect(res.irisIds.sort()).toEqual([
      'iris-a1', 'iris-a2', 'iris-b1', 'iris-b2', 'iris-o12a', 'iris-o12b',
    ])
  })

  it('"Paris 12 et Paris 11" → IRIS of both arrondissements (unchanged)', () => {
    const res = resolveConstraints(
      [arrIn('arr-12', 'Paris 12'), arrIn('arr-11', 'Paris 11')],
      ALL_IRIS, QUARTIERS, [],
    )
    expect(res.irisIds.sort()).toEqual([
      'iris-11a', 'iris-a1', 'iris-a2', 'iris-b1', 'iris-b2', 'iris-o12a', 'iris-o12b',
    ])
  })

  it('"Paris 12 sauf Bercy" → arr-12 IRIS minus Bercy (unchanged)', () => {
    const res = resolveConstraints(
      [arrIn('arr-12', 'Paris 12'), quartierExclude('bercy', 'Bercy')],
      ALL_IRIS, QUARTIERS, [],
    )
    expect(res.irisIds.sort()).toEqual([
      'iris-a1', 'iris-a2', 'iris-o12a', 'iris-o12b',
    ])
  })

  it('Precise scope resolves to 0 IRIS → arrondissement reinstated as fallback', () => {
    // Unknown neighborhoodId → semantic_neighborhood inside resolves to 0 IRIS.
    // The arrondissement contribution must come back so the user still sees something.
    const res = resolveConstraints(
      [arrIn('arr-12', 'Paris 12'), quartierIn('does-not-exist', 'Ghost')],
      ALL_IRIS, QUARTIERS, [],
    )
    expect(res.irisIds.sort()).toEqual([
      'iris-a1', 'iris-a2', 'iris-b1', 'iris-b2', 'iris-o12a', 'iris-o12b',
    ])
  })
})
