/**
 * Tests for the standalone-path guard.
 * The standalone path MUST NOT run when includeConstraints is non-empty,
 * even if the pool resolution returns empty.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  fetchParisQuartiers,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '@shomee/core/geo/geoDataService'
import { resolveConstraints, type GeoConstraint } from '@shomee/core/geo/geoConstraintService'

let iris: GeoZone[] = []
let quartiers: GeoZone[] = []
let communes: GeoZone[] = []

beforeAll(async () => {
  quartiers = await fetchParisQuartiers()
  communes = await fetchSuburbanCommunes()
  iris = await fetchParisIris(quartiers, communes)
}, 120_000)

describe('standalone path must not run when includeConstraints is non-empty', () => {
  it('with empty quartiers (simulates race condition), arr-16 still resolves correctly', () => {
    // Simulate: quartiers not yet loaded when resolveConstraints runs
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', label: 'Paris 16', operator: 'inside', confidence: 0.98, zoneId: 'arr-16' },
      { type: 'semantic_neighborhood', label: 'Boulevard Périphérique', operator: 'near', confidence: 0.88, neighborhoodId: 'zone-periph' },
    ]
    // Pass empty quartiers — simulates the worst case where quartiers ref is stale
    const result = resolveConstraints(constraints, iris, [], communes)
    const codes = result.irisIds.map(id => id.replace('iris-', ''))
    const nonParis16 = codes.filter(c => !c.startsWith('75116'))
    console.log(`Empty quartiers: ${result.irisIds.length} IRIS, wasNarrowed=${result.wasNarrowed}`)
    console.log(`  non-Paris-16: ${nonParis16.length}, examples: ${nonParis16.slice(0,5).join(', ')}`)
    // With empty quartiers, Paris IRIS get parentId='arr-16' directly (fallback in parseIris),
    // so getIrisInZone('arr-16', iris, []) returns ALL Paris 16 IRIS. Filter still works.
    expect(nonParis16.length).toBe(0)
  })

  it('with NO inside constraint, standalone path should return zone-periph IRIS', () => {
    // This is the LEGITIMATE standalone case: query like "proche périph" without specifying a zone
    const constraints: GeoConstraint[] = [
      { type: 'semantic_neighborhood', label: 'Boulevard Périphérique', operator: 'near', confidence: 0.88, neighborhoodId: 'zone-periph' },
    ]
    const result = resolveConstraints(constraints, iris, quartiers, communes)
    console.log(`Standalone only: ${result.irisIds.length} IRIS, wasNarrowed=${result.wasNarrowed}`)
    // Should return many periph IRIS (this is the intended behavior for standalone)
    expect(result.irisIds.length).toBeGreaterThan(100)
  })

  it('with arr-16 inside that resolves to EMPTY pool, must return empty (not standalone)', () => {
    // Simulate corruption: pass a non-existent zoneId
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', label: 'BogusArr', operator: 'inside', confidence: 0.98, zoneId: 'arr-999' },
      { type: 'semantic_neighborhood', label: 'Boulevard Périphérique', operator: 'near', confidence: 0.88, neighborhoodId: 'zone-periph' },
    ]
    const result = resolveConstraints(constraints, iris, quartiers, communes)
    console.log(`Bogus arr inside: ${result.irisIds.length} IRIS, wasNarrowed=${result.wasNarrowed}`)
    expect(result.irisIds.length).toBe(0)
    expect(result.wasNarrowed).toBe(false)
  })
})
