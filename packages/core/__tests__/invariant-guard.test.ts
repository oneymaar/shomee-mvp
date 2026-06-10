/**
 * Verify the INVARIANT GUARD: if any admin inside constraint exists,
 * the final result is ALWAYS a subset of those admin zones' IRIS.
 *
 * This is the bulletproof safety net for "Paris 16 proche périph"
 * never returning IRIS from outside Paris 16.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  fetchParisQuartiers,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '@shomee/core/geo/geoDataService'
import { resolveConstraints, type GeoConstraint } from '@shomee/core/geo/geoConstraintService'
import { parseSpatialIntent } from '@shomee/core/parsing/spatialIntentParser'
import { intentToGeoConstraints } from '@shomee/core/parsing/spatialIntentToGeoConstraints'

let iris: GeoZone[] = []
let quartiers: GeoZone[] = []
let communes: GeoZone[] = []

beforeAll(async () => {
  quartiers = await fetchParisQuartiers()
  communes = await fetchSuburbanCommunes()
  iris = await fetchParisIris(quartiers, communes)
}, 120_000)

describe('INVARIANT GUARD — admin inside boundary enforcement', () => {
  it('Paris 16 proche périph: returns ONLY Paris 16 IRIS (not 167)', () => {
    const intent = parseSpatialIntent('Paris 16 proche périph')
    const cs = intentToGeoConstraints(intent)
    const result = resolveConstraints(cs, iris, quartiers, communes)
    const codes = result.irisIds.map(id => id.replace('iris-', ''))
    const outside = codes.filter(c => !c.startsWith('75116'))
    expect(outside.length).toBe(0)
    expect(result.irisIds.length).toBeLessThan(40)
    expect(result.irisIds.length).toBeGreaterThan(0)
  })

  it('Paris 13 proche périph: returns ONLY Paris 13 IRIS', () => {
    const intent = parseSpatialIntent('Paris 13 proche périph')
    const cs = intentToGeoConstraints(intent)
    const result = resolveConstraints(cs, iris, quartiers, communes)
    const codes = result.irisIds.map(id => id.replace('iris-', ''))
    const outside = codes.filter(c => !c.startsWith('75113'))
    console.log(`Paris 13: ${result.irisIds.length} IRIS, ${outside.length} outside`)
    expect(outside.length).toBe(0)
  })

  it('Paris 12 proche périph: returns ONLY Paris 12 IRIS', () => {
    const intent = parseSpatialIntent('Paris 12 proche périph')
    const cs = intentToGeoConstraints(intent)
    const result = resolveConstraints(cs, iris, quartiers, communes)
    const codes = result.irisIds.map(id => id.replace('iris-', ''))
    const outside = codes.filter(c => !c.startsWith('75112'))
    expect(outside.length).toBe(0)
  })

  it('Paris 18 proche périph: returns ONLY Paris 18 IRIS', () => {
    const intent = parseSpatialIntent('Paris 18 proche périph')
    const cs = intentToGeoConstraints(intent)
    const result = resolveConstraints(cs, iris, quartiers, communes)
    const codes = result.irisIds.map(id => id.replace('iris-', ''))
    const outside = codes.filter(c => !c.startsWith('75118'))
    expect(outside.length).toBe(0)
  })

  it('Boulogne proche périph: returns ONLY Boulogne IRIS', () => {
    const intent = parseSpatialIntent('Boulogne proche périph')
    const cs = intentToGeoConstraints(intent)
    const result = resolveConstraints(cs, iris, quartiers, communes)
    const codes = result.irisIds.map(id => id.replace('iris-', ''))
    const outside = codes.filter(c => !c.startsWith('92012'))
    console.log(`Boulogne: ${result.irisIds.length} IRIS, ${outside.length} outside`)
    expect(outside.length).toBe(0)
  })

  it('SYNTHETIC: even if filter step leaks wrong IRIS, guard removes them', () => {
    // Synthetically inject a zone-periph constraint as INSIDE (would normally return all 167)
    // The invariant guard must filter to only arr-16 IRIS.
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', label: 'Paris 16', operator: 'inside', confidence: 0.98, zoneId: 'arr-16' },
      // This SHOULDN'T be promoted but let's simulate worst case
      { type: 'semantic_neighborhood', label: 'Boulevard Périphérique', operator: 'inside', confidence: 0.88, neighborhoodId: 'zone-periph' },
    ]
    const result = resolveConstraints(constraints, iris, quartiers, communes)
    const codes = result.irisIds.map(id => id.replace('iris-', ''))
    const outside = codes.filter(c => !c.startsWith('75116'))
    console.log(`Synthetic test: ${result.irisIds.length} IRIS, ${outside.length} outside`)
    // Even though zone-periph IRIS were added as 'inside', the guard MUST filter them out
    expect(outside.length).toBe(0)
  })
})
