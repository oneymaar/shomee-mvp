/**
 * Unit tests for spatialIntentToGeoConstraints adapter.
 * Fully offline — no network, no LLM.
 *
 * Run: npx vitest run __tests__/spatial-intent-adapter.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parseSpatialIntent } from '../lib/parsing/spatialIntentParser'
import { intentToGeoConstraints, intentToAnalysisResponse } from '../lib/parsing/spatialIntentToGeoConstraints'

function parse(q: string) {
  return parseSpatialIntent(q)
}

function adapt(q: string) {
  return intentToGeoConstraints(parseSpatialIntent(q))
}

// ─── Neuilly côté bois ────────────────────────────────────────────────────────

describe('adapter: Neuilly côté bois', () => {
  const gc = adapt('Neuilly côté bois')

  it('produces exactly 2 constraints', () => {
    expect(gc).toHaveLength(2)
  })

  it('first constraint: administrative_area inside com-92051', () => {
    expect(gc[0].type).toBe('administrative_area')
    expect(gc[0].operator).toBe('inside')
    expect(gc[0].zoneId).toBe('com-92051')
    expect(gc[0].label).toBe('Neuilly-sur-Seine')
  })

  it('second constraint: poi near Bois de Boulogne', () => {
    expect(gc[1].type).toBe('poi')
    expect(gc[1].operator).toBe('near')
    expect(gc[1].label).toBe('Bois de Boulogne')
    expect(gc[1].radiusM).toBe(300)
  })

  it('second constraint poiType is park (from COTE_EXPANSIONS targetType)', () => {
    expect(gc[1].poiType).toBe('park')
  })

  it('does NOT produce a direction field on any constraint', () => {
    expect(gc.every(c => !('direction' in c) || c.direction == null)).toBe(true)
  })
})

// ─── proche République ────────────────────────────────────────────────────────

describe('adapter: proche République', () => {
  const gc = adapt('proche République')

  it('produces exactly 1 constraint', () => {
    expect(gc).toHaveLength(1)
  })

  it('operator is near (not inside)', () => {
    expect(gc[0].operator).toBe('near')
  })

  it('radiusM = 100', () => {
    expect(gc[0].radiusM).toBe(100)
  })

  it('entity is known (not poi unknown)', () => {
    expect(['transport_station', 'semantic_neighborhood', 'poi']).toContain(gc[0].type)
  })
})

// ─── à deux pas de République ─────────────────────────────────────────────────

describe('adapter: à deux pas de République', () => {
  const gc = adapt('à deux pas de République')

  it('produces exactly 1 constraint', () => {
    expect(gc).toHaveLength(1)
  })

  it('radiusM = 100', () => {
    expect(gc[0].radiusM).toBe(100)
  })

  it('operator is near', () => {
    expect(gc[0].operator).toBe('near')
  })
})

// ─── métro Pigalle ────────────────────────────────────────────────────────────

describe('adapter: métro Pigalle', () => {
  const gc = adapt('métro Pigalle')

  it('produces exactly 1 constraint', () => {
    expect(gc).toHaveLength(1)
  })

  it('type is transport_station', () => {
    expect(gc[0].type).toBe('transport_station')
  })

  it('stationName matches Pigalle', () => {
    expect(gc[0].stationName?.toLowerCase()).toContain('pigalle')
  })

  it('operator is near', () => {
    expect(gc[0].operator).toBe('near')
  })
})

// ─── Pigalle (bare name) ──────────────────────────────────────────────────────

describe('adapter: Pigalle (bare name)', () => {
  const gc = adapt('Pigalle')

  it('produces exactly 1 constraint', () => {
    expect(gc).toHaveLength(1)
  })

  it('type is semantic_neighborhood or transport_station', () => {
    expect(['semantic_neighborhood', 'transport_station']).toContain(gc[0].type)
  })

  it('resolvedId or stationName is set', () => {
    const hasId = gc[0].neighborhoodId != null || gc[0].stationName != null
    expect(hasId).toBe(true)
  })
})

// ─── Charonne mais pas rue de Charonne ────────────────────────────────────────

describe('adapter: Charonne mais pas rue de Charonne', () => {
  const gc = adapt('Charonne mais pas rue de Charonne')

  it('produces exactly 2 constraints', () => {
    expect(gc).toHaveLength(2)
  })

  it('first constraint: semantic_neighborhood inside', () => {
    expect(gc[0].type).toBe('semantic_neighborhood')
    expect(gc[0].operator).toBe('inside')
    expect(gc[0].neighborhoodId).toBe('charonne')
  })

  it('second constraint: poi exclude', () => {
    expect(gc[1].type).toBe('poi')
    expect(gc[1].operator).toBe('exclude')
  })

  it('excluded poi is rue de charonne', () => {
    expect(gc[1].label.toLowerCase()).toContain('charonne')
  })

  it('excluded poi poiType is street', () => {
    expect(gc[1].poiType).toBe('street')
  })
})

// ─── entre République et Bastille ────────────────────────────────────────────

describe('adapter: entre République et Bastille', () => {
  const gc = adapt('entre République et Bastille')

  it('produces exactly 2 constraints', () => {
    expect(gc).toHaveLength(2)
  })

  it('both constraints have operator between', () => {
    expect(gc[0].operator).toBe('between')
    expect(gc[1].operator).toBe('between')
  })

  it('both entities are known (not type poi unknown)', () => {
    expect(['transport_station', 'semantic_neighborhood', 'administrative_area']).toContain(gc[0].type)
    expect(['transport_station', 'semantic_neighborhood', 'administrative_area']).toContain(gc[1].type)
  })
})

// ─── Neuilly côté Seine ───────────────────────────────────────────────────────

describe('adapter: Neuilly côté Seine', () => {
  const gc = adapt('Neuilly côté Seine')

  it('primary entity is Neuilly (inside)', () => {
    expect(gc[0].zoneId).toBe('com-92051')
    expect(gc[0].operator).toBe('inside')
  })

  it('second constraint targets Seine (near)', () => {
    expect(gc[1].operator).toBe('near')
    expect(gc[1].label).toContain('Seine')
  })
})

// ─── "neuilly proche bois" — inline proximity → same GeoConstraints as côté ──

describe('adapter: neuilly proche bois', () => {
  const gc = adapt('neuilly proche bois')

  it('produces exactly 2 constraints', () => {
    expect(gc).toHaveLength(2)
  })

  it('first constraint: administrative_area inside com-92051', () => {
    expect(gc[0].type).toBe('administrative_area')
    expect(gc[0].operator).toBe('inside')
    expect(gc[0].zoneId).toBe('com-92051')
  })

  it('second constraint: poi near Bois de Boulogne', () => {
    expect(gc[1].type).toBe('poi')
    expect(gc[1].operator).toBe('near')
    expect(gc[1].label).toBe('Bois de Boulogne')
    expect(gc[1].radiusM).toBe(300)
  })

  it('same output as "Neuilly côté bois"', () => {
    const gcCote = adapt('Neuilly côté bois')
    expect(gc[0].zoneId).toBe(gcCote[0].zoneId)
    expect(gc[1].label).toBe(gcCote[1].label)
    expect(gc[1].operator).toBe(gcCote[1].operator)
  })
})

// ─── Full response shape ──────────────────────────────────────────────────────

describe('intentToAnalysisResponse shape', () => {
  it('Neuilly côté bois: parserSource is spatial_intent_parser', () => {
    const intent = parse('Neuilly côté bois')
    const resp = intentToAnalysisResponse(intent)
    expect(resp.parserSource).toBe('spatial_intent_parser')
  })

  it('Neuilly côté bois: status is clear', () => {
    const resp = intentToAnalysisResponse(parse('Neuilly côté bois'))
    expect(resp.status).toBe('clear')
  })

  it('Neuilly côté bois: resolutionStrategy is point_radius_intersection', () => {
    const resp = intentToAnalysisResponse(parse('Neuilly côté bois'))
    expect(resp.resolutionStrategy).toBe('point_radius_intersection')
  })

  it('Neuilly côté bois: preselectQueries includes Neuilly-sur-Seine', () => {
    const resp = intentToAnalysisResponse(parse('Neuilly côté bois'))
    expect(resp.mapAction.preselectQueries).toContain('Neuilly-sur-Seine')
  })

  it('Paris 11: preselectQueries is ["Paris 11"]', () => {
    const resp = intentToAnalysisResponse(parse('Paris 11'))
    expect(resp.mapAction.preselectQueries).toEqual(['Paris 11'])
  })

  it('entre République et Bastille: resolutionStrategy is between_entities', () => {
    const resp = intentToAnalysisResponse(parse('entre République et Bastille'))
    expect(resp.resolutionStrategy).toBe('between_entities')
  })

  it('Charonne mais pas rue de Charonne: resolutionStrategy is exclude_from_area', () => {
    const resp = intentToAnalysisResponse(parse('Charonne mais pas rue de Charonne'))
    expect(resp.resolutionStrategy).toBe('exclude_from_area')
  })

  it('has required top-level fields', () => {
    const resp = intentToAnalysisResponse(parse('Neuilly'))
    expect(resp).toHaveProperty('status')
    expect(resp).toHaveProperty('geoConstraints')
    expect(resp).toHaveProperty('explicitLocations')
    expect(resp).toHaveProperty('inferredConstraints')
    expect(resp).toHaveProperty('resolutionStrategy')
    expect(resp).toHaveProperty('mapAction')
    expect(resp).toHaveProperty('parserSource')
  })
})

// ─── LLM gate: lifestyle → NOT handled by adapter ────────────────────────────

describe('fast-path gate: lifestyle queries are NOT adapted', () => {
  const LIFESTYLE_QUERIES = [
    'quartier vivant',
    'coin un peu bobo mais familial',
    'ambiance village',
    'pas trop craignos',
  ]

  for (const q of LIFESTYLE_QUERIES) {
    it(`"${q}" → requiresLLM=true → adapter never called`, () => {
      const intent = parse(q)
      expect(intent.requiresLLM).toBe(true)
      // Adapter should not be called, but verify confidence < 0.75 too
      expect(intent.confidence).toBeLessThan(0.75)
    })
  }
})
