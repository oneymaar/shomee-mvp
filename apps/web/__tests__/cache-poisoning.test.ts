/**
 * Verify the fetchParisIris cache behavior when called early with empty params.
 */
import { describe, it, expect } from 'vitest'
import {
  fetchParisQuartiers,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '../lib/services/geoDataService'
import { resolveConstraints, type GeoConstraint } from '../lib/services/geoConstraintService'

describe('fetchParisIris cache behavior', () => {
  it('CRITICAL: cache should NOT poison parentIds when called with empty params first', async () => {
    // Simulate: an early loadIris() runs before quartiers/communes are loaded
    const earlyIris = await fetchParisIris([], [])
    const paris16WithEmptyQuartiers = earlyIris.filter(z => z.id.startsWith('iris-75116'))
    console.log(`Early fetchParisIris (empty quartiers): ${earlyIris.length} total, ${paris16WithEmptyQuartiers.length} Paris 16`)
    console.log(`  Sample Paris 16 IRIS parentIds:`, paris16WithEmptyQuartiers.slice(0, 5).map(z => `${z.id}/${z.parentId}`))

    // Now load quartiers/communes
    const quartiers = await fetchParisQuartiers()
    const communes = await fetchSuburbanCommunes()
    
    // Second call with CORRECT params — returns CACHED data
    const lateIris = await fetchParisIris(quartiers, communes)
    const paris16WithCorrectQuartiers = lateIris.filter(z => z.id.startsWith('iris-75116'))
    console.log(`Late fetchParisIris (correct quartiers): ${lateIris.length} total, ${paris16WithCorrectQuartiers.length} Paris 16`)
    console.log(`  Sample Paris 16 IRIS parentIds:`, paris16WithCorrectQuartiers.slice(0, 5).map(z => `${z.id}/${z.parentId}`))

    // The cache returns the SAME data — both calls see the SAME parentIds
    expect(lateIris).toBe(earlyIris)

    // Now try resolveConstraints with arr-16 inside + zone-periph near
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', label: 'Paris 16', operator: 'inside', confidence: 0.98, zoneId: 'arr-16' },
      { type: 'semantic_neighborhood', label: 'Boulevard Périphérique', operator: 'near', confidence: 0.88, neighborhoodId: 'zone-periph' },
    ]
    const result = resolveConstraints(constraints, lateIris, quartiers, communes)
    console.log(`resolveConstraints result: ${result.irisIds.length} IRIS, wasNarrowed=${result.wasNarrowed}`)
    
    const codes = result.irisIds.map(id => id.replace('iris-', ''))
    const nonParis16 = codes.filter(c => !c.startsWith('75116'))
    console.log(`  Non-Paris-16: ${nonParis16.length}`)
    
    // This is what should happen: ONLY Paris 16 IRIS
    expect(nonParis16.length).toBe(0)
  }, 120_000)
})
