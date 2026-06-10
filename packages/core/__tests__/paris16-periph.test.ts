/**
 * Specific test for "Paris 16 proche périph" — verify zone-periph filter works correctly.
 *
 * Expected behavior: result should be ONLY Paris 16 IRIS that intersect with zone-periph
 * (codes starting with 75116). NOT all 167 zone-periph IRIS from across IDF.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  fetchParisQuartiers,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '@shomee/core/geo/geoDataService'
import { resolveConstraints } from '@shomee/core/geo/geoConstraintService'
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

describe('"Paris 16 proche périph" — zone-periph filtering', () => {
  it('parser generates correct constraints', () => {
    const intent = parseSpatialIntent('Paris 16 proche périph')
    console.log('Intent:', JSON.stringify(intent, null, 2))
    expect(intent.requiresLLM).toBe(false)
    expect(intent.primaryEntities[0].type).toBe('district')
    expect(intent.primaryEntities[0].resolvedId).toBe('arr-16')
    expect(intent.spatialRelations[0]?.targetType).toBe('neighborhood')
    expect(intent.spatialRelations[0]?.neighborhoodId).toBe('zone-periph')
  })

  it('adapter generates [arr-16 inside, zone-periph semantic_neighborhood near]', () => {
    const intent = parseSpatialIntent('Paris 16 proche périph')
    const cs = intentToGeoConstraints(intent)
    console.log('Constraints:', JSON.stringify(cs, null, 2))
    expect(cs).toHaveLength(2)
    const inside = cs.find(c => c.operator === 'inside')
    const near = cs.find(c => c.operator === 'near')
    expect(inside?.type).toBe('administrative_area')
    expect(inside?.zoneId).toBe('arr-16')
    expect(near?.type).toBe('semantic_neighborhood')
    expect(near?.neighborhoodId).toBe('zone-periph')
  })

  it('resolveConstraints returns ONLY Paris 16 IRIS that intersect zone-periph', () => {
    const intent = parseSpatialIntent('Paris 16 proche périph')
    const cs = intentToGeoConstraints(intent)
    const result = resolveConstraints(cs, iris, quartiers, communes)

    const codes = result.irisIds.map(id => id.replace('iris-', ''))
    const parisIds = codes.filter(c => c.startsWith('75116'))
    const otherIds = codes.filter(c => !c.startsWith('75116'))

    console.log(`Result: ${result.irisIds.length} IRIS, wasNarrowed=${result.wasNarrowed}`)
    console.log(`  Paris 16 codes (75116*): ${parisIds.length}`)
    console.log(`  Other codes: ${otherIds.length}`)
    if (otherIds.length > 0) {
      console.log(`  Other examples: ${otherIds.slice(0, 10).join(', ')}`)
    }

    // CRITICAL ASSERTIONS:
    expect(result.wasNarrowed).toBe(true)
    expect(result.irisIds.length).toBeGreaterThan(0)
    expect(result.irisIds.length).toBeLessThan(40)  // ~15-20 expected, definitely not 167
    expect(otherIds.length).toBe(0)  // ZERO non-Paris-16 IRIS
    expect(parisIds.length).toBeGreaterThan(5)  // at least a handful of Paris 16 periph IRIS
  })

  it('does NOT return all 167 zone-periph IRIS', () => {
    const intent = parseSpatialIntent('Paris 16 proche périph')
    const cs = intentToGeoConstraints(intent)
    const result = resolveConstraints(cs, iris, quartiers, communes)
    expect(result.irisIds.length).toBeLessThan(167)
  })
})
