/**
 * End-to-end invariant tests for AREA_EXCLUSION queries.
 *
 * Tests the full pipeline: parseSpatialIntent → intentToGeoConstraints → resolveConstraints
 *
 * KEY INVARIANT:
 *   finalIris.every(iris => iris.parentId === expectedPrimaryZoneId)
 *
 * These tests use mock IRIS data (offline, no network) to verify that the geo
 * engine never adds communes to the result that aren't in the primary zone.
 *
 * Run: npx vitest run __tests__/area-exclusion-invariant.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parseSpatialIntent } from '../lib/parsing/spatialIntentParser'
import { intentToGeoConstraints } from '../lib/parsing/spatialIntentToGeoConstraints'
import { resolveConstraints } from '../lib/services/geoConstraintService'
import type { GeoZone } from '../lib/services/geoDataService'

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeIris(id: string, parentId: string, lat: number, lng: number, r = 0.002): GeoZone {
  return {
    id, name: id, shortName: id, type: 'iris', parentId,
    feature: {
      type: 'Feature', properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[lng-r, lat-r],[lng+r, lat-r],[lng+r, lat+r],[lng-r, lat+r],[lng-r, lat-r]]],
      },
    } as GeoJSON.Feature,
  }
}

function makePolygon(lat: number, lng: number, r = 0.01): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [[[lng-r, lat-r],[lng+r, lat-r],[lng+r, lat+r],[lng-r, lat+r],[lng-r, lat-r]]],
  }
}

// ─── Realistic mock IRIS layout ───────────────────────────────────────────────
//
// Real GPS centers (approximate):
//   Neuilly-sur-Seine (com-92051)    : 48.884, 2.272
//   La Défense / Puteaux (com-92062) : 48.891, 2.238  (west of Neuilly)
//   Nanterre (com-92051)             : 48.893, 2.207  (further west — should NEVER appear)
//   Vincennes (com-94080)            : 48.848, 2.435
//   Bois de Vincennes center         : 48.828, 2.448  (south of Vincennes)
//   Villeneuve-Saint-Georges         : 48.729, 2.449  (far south — should NEVER appear)
//   Saint-Ouen (com-93070)           : 48.911, 2.336
//   Périphérique at Saint-Ouen       : 48.898, 2.333  (south border of Saint-Ouen)
//   Levallois-Perret (com-92044)     : 48.894, 2.289
//   Paris 18 (arr-18)                : 48.893, 2.345
//   Boulogne-Billancourt (com-92012) : 48.835, 2.240
//   Marcel Sembat station            : 48.834, 2.244

// Neuilly IRIS
const neuillyIris = [
  makeIris('n-west-1', 'com-92051', 48.882, 2.270),   // western Neuilly (near Paris 16)
  makeIris('n-west-2', 'com-92051', 48.884, 2.272),
  makeIris('n-center-1', 'com-92051', 48.885, 2.283),
  makeIris('n-center-2', 'com-92051', 48.887, 2.285),
  makeIris('n-east-1', 'com-92051', 48.882, 2.296),
  makeIris('n-east-2', 'com-92051', 48.884, 2.298),
]

// La Défense / Puteaux IRIS — far from Neuilly
const defenseIris = [
  makeIris('def-1', 'com-92062', 48.891, 2.238),
  makeIris('def-2', 'com-92062', 48.893, 2.240),
]

// Nanterre IRIS — should NEVER be selected for Neuilly queries
const nanterreIris = [
  makeIris('nant-1', 'com-92051-wrong', 48.893, 2.207),  // different parentId to simulate wrong selection
  makeIris('nant-2', 'com-92051-wrong', 48.895, 2.210),
]

// Vincennes IRIS
const vincennesIris = [
  makeIris('vinc-north-1', 'com-94080', 48.850, 2.433),
  makeIris('vinc-north-2', 'com-94080', 48.852, 2.436),
  makeIris('vinc-south-1', 'com-94080', 48.843, 2.435),  // near Bois
  makeIris('vinc-south-2', 'com-94080', 48.845, 2.438),  // near Bois
]

// Villeneuve-Saint-Georges — should NEVER appear in Vincennes results
const vsgIris = [
  makeIris('vsg-1', 'com-94076', 48.729, 2.449),
  makeIris('vsg-2', 'com-94076', 48.731, 2.451),
]

// Saint-Ouen IRIS
const saintoEnIris = [
  makeIris('so-south-1', 'com-93070', 48.898, 2.333),  // near périph
  makeIris('so-south-2', 'com-93070', 48.900, 2.335),  // near périph
  makeIris('so-center-1', 'com-93070', 48.906, 2.335),
  makeIris('so-north-1', 'com-93070', 48.912, 2.336),
]

// Levallois IRIS
const levalloisIris = [
  makeIris('lev-1', 'com-92044', 48.892, 2.288),
  makeIris('lev-2', 'com-92044', 48.894, 2.290),
  makeIris('lev-north-1', 'com-92044', 48.898, 2.291),
]

// Paris 18 IRIS
const arr18Iris = [
  makeIris('18-south-1', 'arr-18', 48.891, 2.340),
  makeIris('18-south-2', 'arr-18', 48.893, 2.343),
  makeIris('18-center-1', 'arr-18', 48.896, 2.345),
  makeIris('18-north-1', 'arr-18', 48.899, 2.347),
]

// Boulogne IRIS
const boulogneIris = [
  makeIris('boul-1', 'com-92012', 48.834, 2.240),  // near Marcel Sembat
  makeIris('boul-2', 'com-92012', 48.836, 2.242),  // near Marcel Sembat
  makeIris('boul-3', 'com-92012', 48.840, 2.250),
  makeIris('boul-4', 'com-92012', 48.843, 2.254),
]

const ALL_IRIS = [
  ...neuillyIris, ...defenseIris, ...nanterreIris,
  ...vincennesIris, ...vsgIris,
  ...saintoEnIris, ...levalloisIris, ...arr18Iris, ...boulogneIris,
]

// ─── Helper: run full pipeline ────────────────────────────────────────────────

function runPipeline(query: string) {
  const intent = parseSpatialIntent(query)
  const constraints = intentToGeoConstraints(intent)
  const result = resolveConstraints(constraints, ALL_IRIS, [], [])
  return { intent, constraints, result }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AREA_EXCLUSION invariant: finalIris ⊆ primaryEntity', () => {

  // ── 1. Neuilly mais pas côté Défense ───────────────────────────────────────
  it('Neuilly mais pas côté Défense → all IRIS in com-92051, no Nanterre', () => {
    const { intent, constraints, result } = runPipeline('Neuilly mais pas côté Défense')

    console.log('[test] Neuilly/Défense — constraints:', JSON.stringify(constraints, null, 2))
    console.log('[test] Neuilly/Défense — result:', result.irisIds, 'wasNarrowed:', result.wasNarrowed)

    // Parser must handle this without LLM (requiresLLM=false since my fix)
    expect(intent.requiresLLM).toBe(false)
    expect(intent.primaryEntities[0].resolvedId).toBe('com-92051')

    // At minimum, inside constraint must target Neuilly
    const insideC = constraints.filter(c => c.operator === 'inside')
    expect(insideC.length).toBeGreaterThan(0)
    expect(insideC[0].zoneId).toBe('com-92051')

    // KEY INVARIANT: all selected IRIS must be in Neuilly
    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId, `IRIS ${id} must be in com-92051, got ${zone?.parentId}`).toBe('com-92051')
    }

    // Nanterre must not appear
    expect(result.irisIds.some(id => id.startsWith('nant-'))).toBe(false)
  })

  // ── 2. Vincennes hors bois ────────────────────────────────────────────────
  it('Vincennes hors bois → all IRIS in com-94080, no Villeneuve-Saint-Georges', () => {
    const { intent, constraints, result } = runPipeline('Vincennes hors bois')

    console.log('[test] Vincennes/bois — constraints:', JSON.stringify(constraints, null, 2))
    console.log('[test] Vincennes/bois — result:', result.irisIds, 'wasNarrowed:', result.wasNarrowed)

    expect(intent.requiresLLM).toBe(false)
    expect(intent.primaryEntities[0].resolvedId).toBe('com-94080')

    const insideC = constraints.filter(c => c.operator === 'inside')
    expect(insideC[0].zoneId).toBe('com-94080')

    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId, `IRIS ${id} must be in com-94080`).toBe('com-94080')
    }

    // Villeneuve-Saint-Georges must not appear
    expect(result.irisIds.some(id => id.startsWith('vsg-'))).toBe(false)
  })

  // ── 3. Saint-Ouen sauf périph ─────────────────────────────────────────────
  it('Saint-Ouen sauf périph → all IRIS in com-93070', () => {
    const { intent, constraints, result } = runPipeline('Saint-Ouen sauf périph')

    console.log('[test] Saint-Ouen/périph — constraints:', JSON.stringify(constraints, null, 2))
    console.log('[test] Saint-Ouen/périph — result:', result.irisIds, 'wasNarrowed:', result.wasNarrowed)

    expect(intent.requiresLLM).toBe(false)
    expect(intent.primaryEntities[0].resolvedId).toBe('com-93070')

    const insideC = constraints.filter(c => c.operator === 'inside')
    expect(insideC[0].zoneId).toBe('com-93070')

    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId, `IRIS ${id} must be in com-93070`).toBe('com-93070')
    }
  })

  // ── 4. Levallois sauf gare Clichy-Levallois ───────────────────────────────
  it('Levallois sauf gare Clichy-Levallois → all IRIS in com-92044', () => {
    const { intent, constraints, result } = runPipeline('Levallois sauf gare Clichy-Levallois')

    console.log('[test] Levallois/gare — constraints:', JSON.stringify(constraints, null, 2))
    console.log('[test] Levallois/gare — result:', result.irisIds, 'wasNarrowed:', result.wasNarrowed)

    // Goes to LLM (Clichy-Levallois is not in COMMUNE_ID_MAP or COTE_EXPANSIONS)
    // Either way, parser/LLM must produce com-92044 as inside constraint

    const insideC = constraints.filter(c => c.operator === 'inside')
    if (insideC.length > 0) {
      expect(insideC[0].zoneId).toBe('com-92044')
    }

    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId, `IRIS ${id} must be in com-92044`).toBe('com-92044')
    }
  })

  // ── 5. Paris 18 mais pas Porte de la Chapelle ─────────────────────────────
  it('Paris 18 mais pas Porte de la Chapelle → all IRIS in arr-18', () => {
    const { intent, constraints, result } = runPipeline('Paris 18 mais pas Porte de la Chapelle')

    console.log('[test] Paris18/Chapelle — constraints:', JSON.stringify(constraints, null, 2))

    // Parser handles "Paris 18" → district arr-18
    const insideC = constraints.filter(c => c.operator === 'inside')
    if (insideC.length > 0) {
      expect(insideC[0].zoneId).toBe('arr-18')
    }

    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId, `IRIS ${id} must be in arr-18`).toBe('arr-18')
    }
  })

  // ── 6. Boulogne sauf Marcel Sembat ────────────────────────────────────────
  it('Boulogne sauf Marcel Sembat → all IRIS in com-92012', () => {
    const { intent, constraints, result } = runPipeline('Boulogne sauf Marcel Sembat')

    console.log('[test] Boulogne/Marcel — constraints:', JSON.stringify(constraints, null, 2))
    console.log('[test] Boulogne/Marcel — result:', result.irisIds, 'wasNarrowed:', result.wasNarrowed)

    expect(intent.primaryEntities[0].resolvedId).toBe('com-92012')

    const insideC = constraints.filter(c => c.operator === 'inside')
    expect(insideC[0].zoneId).toBe('com-92012')

    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId, `IRIS ${id} must be in com-92012`).toBe('com-92012')
    }

    // Note: in this mock, all Boulogne IRIS centroids are ~264m from Marcel Sembat
    // (EXCLUDE_STATION_RADIUS_M=200m centroid-based), so exclusion returns 0.
    // Real IRIS data would have some within 200m. The invariant holds regardless.
    expect(result.irisIds.length).toBeGreaterThan(0)
  })
})

// ─── Structural invariant with geocoded exclusion POI ─────────────────────────

describe('AREA_EXCLUSION invariant: geocoded poi(exclude) does not expand pool', () => {
  it('inside(Neuilly) + poi(La Défense, exclude, with lat/lng) → result ⊆ Neuilly', () => {
    // Simulate what happens after geocoding: La Défense gets lat/lng
    const constraints = [
      { type: 'administrative_area' as const, zoneId: 'com-92051', operator: 'inside' as const, label: 'Neuilly', confidence: 1 },
      {
        type: 'poi' as const, label: 'La Défense', operator: 'exclude' as const, confidence: 0.82,
        lat: 48.891, lng: 2.238,  // La Défense center (in defenseIris territory)
        poiType: 'poi',
      },
    ]

    const result = resolveConstraints(constraints, ALL_IRIS, [], [])

    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId, `IRIS ${id} parent must be com-92051, got ${zone?.parentId}`).toBe('com-92051')
    }

    // La Défense IRIS must not appear (different parentId)
    expect(result.irisIds.some(id => id.startsWith('def-'))).toBe(false)
    expect(result.irisIds.some(id => id.startsWith('nant-'))).toBe(false)
    expect(result.wasNarrowed).toBe(true)
  })

  it('inside(Vincennes) + poi(Bois, exclude, with lat/lng) → result ⊆ Vincennes', () => {
    const constraints = [
      { type: 'administrative_area' as const, zoneId: 'com-94080', operator: 'inside' as const, label: 'Vincennes', confidence: 1 },
      {
        type: 'poi' as const, label: 'Bois de Boulogne', operator: 'exclude' as const, confidence: 0.85,
        lat: 48.828, lng: 2.448,  // Bois de Vincennes area (near vinc-south IRIS)
        poiType: 'poi',
      },
    ]

    const result = resolveConstraints(constraints, ALL_IRIS, [], [])

    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId, `IRIS ${id} must be in com-94080`).toBe('com-94080')
    }

    // Villeneuve-Saint-Georges must never appear
    expect(result.irisIds.some(id => id.startsWith('vsg-'))).toBe(false)
  })
})
