/**
 * Unit tests for the inside+near constraint invariant in resolveConstraints.
 *
 * Critical invariant: inside(A) AND near(B) must NEVER produce IRIS outside A.
 *
 * Uses mock GeoZone objects with simple rectangular polygons — no network needed.
 *
 * Run: npx vitest run __tests__/geo-constraint-inside-near.test.ts
 */

import { describe, it, expect } from 'vitest'
import { resolveConstraints, type GeoConstraint } from '../lib/services/geoConstraintService'
import type { GeoZone } from '../lib/services/geoDataService'

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeIris(id: string, parentId: string, minLng: number, maxLng: number, minLat: number, maxLat: number): GeoZone {
  return {
    id, name: id, shortName: id, type: 'iris', parentId,
    feature: {
      type: 'Feature', properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[minLng, minLat],[maxLng, minLat],[maxLng, maxLat],[minLng, maxLat],[minLng, minLat]]],
      },
    } as GeoJSON.Feature,
  }
}

function makePolygon(minLng: number, maxLng: number, minLat: number, maxLat: number): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [[[minLng, minLat],[maxLng, minLat],[maxLng, maxLat],[minLng, maxLat],[minLng, minLat]]],
  }
}

// ─── Geometry representing actual Neuilly / Paris-16 / Bois layout ────────────
//
// Simplified mock geometry with a clear 1km+ gap between Neuilly and the Bois:
//
//   Neuilly-sur-Seine  : lng 2.280–2.296, lat 48.878–48.892  (east)
//   Paris 16e strip    : lng 2.268–2.280, lat 48.858–48.892  (between Neuilly and Bois)
//   Bois de Boulogne   : lng 2.240–2.268, lat 48.832–48.878  (west, no shared border with Neuilly)
//   Boulogne-BC        : lng 2.224–2.250, lat 48.832–48.858
//
// Neuilly–Bois gap: (2.280 - 2.268) * 73000 ≈ 876m — well above radiusM=300m.

const neuillyIris1 = makeIris('neuilly-1', 'com-92051', 2.280, 2.288, 48.878, 48.886)
const neuillyIris2 = makeIris('neuilly-2', 'com-92051', 2.288, 2.296, 48.878, 48.892)
const paris16Iris  = makeIris('paris16-1', 'arr-16',    2.268, 2.280, 48.858, 48.878)
const boulognIris  = makeIris('boulogne-1','com-92012', 2.224, 2.255, 48.832, 48.858)

const ALL_IRIS = [neuillyIris1, neuillyIris2, paris16Iris, boulognIris]

// Bois de Boulogne polygon: adjacent to Paris 16 and Boulogne, NOT adjacent to Neuilly
// maxLng 2.268 = minLng of Paris 16 → direct adjacency. Neuilly starts at lng 2.280 → 876m gap.

// ─── Invariant: inside(A) + near(poi) → result ⊆ A ───────────────────────────

describe('inside(A) AND near(B): result must always be ⊆ A', () => {
  it('inside(Neuilly) + near(Bois) → only Neuilly IRIS, never Paris 16 or Boulogne', () => {
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', zoneId: 'com-92051', operator: 'inside', label: 'Neuilly', confidence: 1 },
      { type: 'poi', label: 'Bois de Boulogne', operator: 'near', poiType: 'park', radiusM: 300, confidence: 0.9,
        geometry: makePolygon(2.240, 2.268, 48.832, 48.878), lat: 48.860, lng: 2.254 },
    ]

    const result = resolveConstraints(constraints, ALL_IRIS, [], [])

    // All selected IRIS must be Neuilly
    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId, `IRIS ${id} should be in Neuilly (com-92051)`).toBe('com-92051')
    }

    // Paris 16 and Boulogne must not appear
    expect(result.irisIds).not.toContain('paris16-1')
    expect(result.irisIds).not.toContain('boulogne-1')

    // wasNarrowed: true (near constraint is present, even if filter returns 0)
    expect(result.wasNarrowed).toBe(true)
  })

  it('inside(Paris 16) + near(Bois adjacent) → only Paris 16 IRIS', () => {
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', zoneId: 'arr-16', operator: 'inside', label: 'Paris 16', confidence: 1 },
      { type: 'poi', label: 'Bois de Boulogne', operator: 'near', poiType: 'park', radiusM: 300, confidence: 0.9,
        geometry: makePolygon(2.240, 2.268, 48.832, 48.878), lat: 48.860, lng: 2.254 },
    ]

    const result = resolveConstraints(constraints, ALL_IRIS, [], [])

    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId, `IRIS ${id} should be in Paris 16 (arr-16)`).toBe('arr-16')
    }
    expect(result.irisIds).not.toContain('neuilly-1')
    expect(result.irisIds).not.toContain('neuilly-2')
    expect(result.irisIds).not.toContain('boulogne-1')
  })

  it('inside(Neuilly) + near(poi adjacent) → Neuilly IRIS filtered to those close to poi', () => {
    // Poi is ADJACENT to neuilly-1 (minLng 2.278) → neuilly-1 should be kept, neuilly-2 might be excluded
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', zoneId: 'com-92051', operator: 'inside', label: 'Neuilly', confidence: 1 },
      // Poi is at lng 2.270–2.280, adjacent to neuilly-1's western border
      { type: 'poi', label: 'nearby-poi', operator: 'near', poiType: 'landmark', radiusM: 200, confidence: 0.9,
        // Poi is directly adjacent to neuilly-1's western border (lng 2.280)
        geometry: makePolygon(2.274, 2.280, 48.878, 48.886), lat: 48.882, lng: 2.277 },
    ]

    const result = resolveConstraints(constraints, ALL_IRIS, [], [])

    // Must only include Neuilly IRIS — no Paris 16, no Boulogne
    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(zone?.parentId).toBe('com-92051')
    }
    expect(result.irisIds).not.toContain('paris16-1')
    expect(result.irisIds).not.toContain('boulogne-1')
    // neuilly-1 is adjacent to the poi → should be included
    expect(result.irisIds).toContain('neuilly-1')
  })

  it('inside(A) + inside(B) + near(poi) → result ⊆ A∪B', () => {
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', zoneId: 'com-92051', operator: 'inside', label: 'Neuilly', confidence: 1 },
      { type: 'administrative_area', zoneId: 'arr-16', operator: 'inside', label: 'Paris 16', confidence: 1 },
      { type: 'poi', label: 'Bois de Boulogne', operator: 'near', poiType: 'park', radiusM: 300, confidence: 0.9,
        geometry: makePolygon(2.240, 2.268, 48.832, 48.878), lat: 48.860, lng: 2.254 },
    ]

    const result = resolveConstraints(constraints, ALL_IRIS, [], [])

    for (const id of result.irisIds) {
      const zone = ALL_IRIS.find(z => z.id === id)
      expect(['com-92051', 'arr-16']).toContain(zone?.parentId)
    }
    // Boulogne must never appear
    expect(result.irisIds).not.toContain('boulogne-1')
  })
})

// ─── near-only (no inside): standalone path allowed to go wide ────────────────

describe('near-only (no inside): standalone path selects from full IRIS set', () => {
  it('near(Bois) alone → selects IRIS adjacent to Bois from any zone', () => {
    const constraints: GeoConstraint[] = [
      { type: 'poi', label: 'Bois de Boulogne', operator: 'near', poiType: 'park', radiusM: 200, confidence: 0.9,
        geometry: makePolygon(2.240, 2.268, 48.832, 48.878), lat: 48.860, lng: 2.254 },
    ]

    const result = resolveConstraints(constraints, ALL_IRIS, [], [])
    // Paris 16 is adjacent → should appear
    expect(result.irisIds).toContain('paris16-1')
    // Neuilly (far from Bois) should NOT appear
    expect(result.irisIds).not.toContain('neuilly-1')
    expect(result.irisIds).not.toContain('neuilly-2')
  })
})
