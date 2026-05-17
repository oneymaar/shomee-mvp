/**
 * Unit tests for SpatialIntentParser — fully offline, no network, no LLM.
 *
 * Run: npx vitest run __tests__/spatial-intent-parser.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parseSpatialIntent } from '../lib/parsing/spatialIntentParser'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function entity(result: ReturnType<typeof parseSpatialIntent>, index = 0) {
  return result.primaryEntities[index]
}

function relation(result: ReturnType<typeof parseSpatialIntent>, index = 0) {
  return result.spatialRelations[index]
}

function exclusion(result: ReturnType<typeof parseSpatialIntent>, index = 0) {
  return result.exclusions[index]
}

// ─── "Neuilly côté bois" ──────────────────────────────────────────────────────

describe('Neuilly côté bois', () => {
  const result = parseSpatialIntent('Neuilly côté bois')

  it('resolves Neuilly as city com-92050', () => {
    expect(entity(result).type).toBe('city')
    expect(entity(result).resolvedId).toBe('com-92050')
    expect(entity(result).label).toBe('Neuilly-sur-Seine')
  })

  it('produces edge_of relation targeting Bois de Boulogne', () => {
    expect(relation(result).type).toBe('edge_of')
    expect(relation(result).targetText).toBe('Bois de Boulogne')
    expect(relation(result).targetType).toBe('poi')
  })

  it('does NOT produce a cardinal direction', () => {
    expect(relation(result).direction).toBeUndefined()
  })

  it('does NOT produce Nanterre, Suresnes, or Paris 16', () => {
    const allLabels = [
      ...result.primaryEntities.map(e => e.label ?? ''),
      ...result.exclusions.map(e => e.label ?? ''),
    ].map(l => l.toLowerCase())
    expect(allLabels.some(l => l.includes('nanterre'))).toBe(false)
    expect(allLabels.some(l => l.includes('suresnes'))).toBe(false)
    expect(allLabels.some(l => l.includes('paris 16'))).toBe(false)
  })

  it('requiresLLM = false', () => {
    expect(result.requiresLLM).toBe(false)
  })

  it('radiusM = 300', () => {
    expect(relation(result).radiusM).toBe(300)
  })

  it('has no exclusions', () => {
    expect(result.exclusions).toHaveLength(0)
  })
})

// ─── "proche République" ─────────────────────────────────────────────────────

describe('proche République', () => {
  const result = parseSpatialIntent('proche République')

  it('produces a near relation', () => {
    expect(relation(result).type).toBe('near')
  })

  it('radiusM = 100 for "proche"', () => {
    expect(relation(result).radiusM).toBe(100)
  })

  it('resolves République as a known entity (station or quartier)', () => {
    const e = entity(result)
    expect(e.type).not.toBe('unknown')
    expect(e.confidence).toBeGreaterThan(0.5)
  })

  it('requiresLLM = false', () => {
    expect(result.requiresLLM).toBe(false)
  })
})

// ─── "à deux pas de République" ──────────────────────────────────────────────

describe('à deux pas de République', () => {
  const result = parseSpatialIntent('à deux pas de République')

  it('produces a near relation', () => {
    expect(relation(result).type).toBe('near')
  })

  it('radiusM = 100 for "à deux pas"', () => {
    expect(relation(result).radiusM).toBe(100)
  })

  it('resolves République as a known entity', () => {
    const e = entity(result)
    expect(e.type).not.toBe('unknown')
  })

  it('requiresLLM = false', () => {
    expect(result.requiresLLM).toBe(false)
  })
})

// ─── "Charonne mais pas rue de Charonne" ─────────────────────────────────────

describe('Charonne mais pas rue de Charonne', () => {
  const result = parseSpatialIntent('Charonne mais pas rue de Charonne')

  it('primary entity is Charonne (quartier)', () => {
    expect(entity(result).type).toBe('quartier')
    expect(entity(result).resolvedId).toBe('charonne')
  })

  it('has exactly one exclusion', () => {
    expect(result.exclusions).toHaveLength(1)
  })

  it('exclusion is rue de Charonne (street type)', () => {
    expect(exclusion(result).type).toBe('street')
    expect(exclusion(result).rawText).toMatch(/charonne/i)
  })

  it('does not mix primary entity and exclusion', () => {
    const primary = entity(result).normalizedText
    const excl = exclusion(result).normalizedText
    expect(primary).not.toBe(excl)
  })

  it('requiresLLM = false', () => {
    expect(result.requiresLLM).toBe(false)
  })
})

// ─── "métro Pigalle" ─────────────────────────────────────────────────────────

describe('métro Pigalle', () => {
  const result = parseSpatialIntent('métro Pigalle')

  it('type is transport_station', () => {
    expect(entity(result).type).toBe('transport_station')
  })

  it('resolvedId is the Pigalle station ID', () => {
    expect(entity(result).resolvedId).toMatch(/pigalle/)
  })

  it('has high confidence', () => {
    expect(entity(result).confidence).toBeGreaterThanOrEqual(0.95)
  })

  it('requiresLLM = false', () => {
    expect(result.requiresLLM).toBe(false)
  })
})

// ─── "Pigalle" (bare name) ────────────────────────────────────────────────────

describe('Pigalle (bare name)', () => {
  const result = parseSpatialIntent('Pigalle')

  it('resolves to a known entity (quartier or station)', () => {
    expect(entity(result).type).not.toBe('unknown')
  })

  it('has no spatial relations', () => {
    expect(result.spatialRelations).toHaveLength(0)
  })

  it('requiresLLM = false', () => {
    expect(result.requiresLLM).toBe(false)
  })

  it('has no exclusions', () => {
    expect(result.exclusions).toHaveLength(0)
  })
})

// ─── "Neuilly côté Seine" ─────────────────────────────────────────────────────

describe('Neuilly côté Seine', () => {
  const result = parseSpatialIntent('Neuilly côté Seine')

  it('primary entity is Neuilly (city com-92050)', () => {
    expect(entity(result).type).toBe('city')
    expect(entity(result).resolvedId).toBe('com-92050')
  })

  it('produces edge_of relation targeting Seine', () => {
    expect(relation(result).type).toBe('edge_of')
    expect(relation(result).targetText).toBe('Seine')
  })

  it('does NOT emit a cardinal direction', () => {
    expect(relation(result).direction).toBeUndefined()
  })

  it('requiresLLM = false', () => {
    expect(result.requiresLLM).toBe(false)
  })
})

// ─── "Boulogne côté bois" ─────────────────────────────────────────────────────

describe('Boulogne côté bois', () => {
  const result = parseSpatialIntent('Boulogne côté bois')

  it('resolves Boulogne as city com-92012', () => {
    expect(entity(result).type).toBe('city')
    expect(entity(result).resolvedId).toBe('com-92012')
    expect(entity(result).label).toBe('Boulogne-Billancourt')
  })

  it('produces edge_of Bois de Boulogne', () => {
    expect(relation(result).type).toBe('edge_of')
    expect(relation(result).targetText).toBe('Bois de Boulogne')
  })

  it('does NOT produce Nanterre, Suresnes, or Paris 16', () => {
    const allLabels = [
      ...result.primaryEntities.map(e => e.label ?? ''),
      ...result.exclusions.map(e => e.label ?? ''),
    ].map(l => l.toLowerCase())
    expect(allLabels.some(l => l.includes('nanterre'))).toBe(false)
    expect(allLabels.some(l => l.includes('suresnes'))).toBe(false)
    expect(allLabels.some(l => l.includes('paris 16'))).toBe(false)
  })

  it('requiresLLM = false', () => {
    expect(result.requiresLLM).toBe(false)
  })
})

// ─── "entre République et Bastille" ──────────────────────────────────────────

describe('entre République et Bastille', () => {
  const result = parseSpatialIntent('entre République et Bastille')

  it('has two primary entities', () => {
    expect(result.primaryEntities).toHaveLength(2)
  })

  it('first entity is République (known)', () => {
    expect(entity(result, 0).type).not.toBe('unknown')
  })

  it('second entity is Bastille (known)', () => {
    expect(entity(result, 1).type).not.toBe('unknown')
  })

  it('produces a between relation', () => {
    expect(relation(result).type).toBe('between')
  })

  it('requiresLLM = false', () => {
    expect(result.requiresLLM).toBe(false)
  })
})

// ─── Lifestyle / subjective → requiresLLM = true ─────────────────────────────

describe('lifestyle queries require LLM', () => {
  it('"quartier vivant" → requiresLLM', () => {
    expect(parseSpatialIntent('quartier vivant').requiresLLM).toBe(true)
  })

  it('"coin un peu bobo mais familial" → requiresLLM', () => {
    expect(parseSpatialIntent('coin un peu bobo mais familial').requiresLLM).toBe(true)
  })

  it('"ambiance village" → requiresLLM', () => {
    expect(parseSpatialIntent('ambiance village').requiresLLM).toBe(true)
  })

  it('"pas trop craignos" → requiresLLM', () => {
    expect(parseSpatialIntent('pas trop craignos').requiresLLM).toBe(true)
  })

  it('"branché mais calme" → requiresLLM', () => {
    expect(parseSpatialIntent('branché mais calme').requiresLLM).toBe(true)
  })
})

// ─── Known cities / arrondissements ──────────────────────────────────────────

describe('city and district resolution', () => {
  it('Vincennes → city com-94078', () => {
    const r = parseSpatialIntent('Vincennes')
    expect(entity(r).type).toBe('city')
    expect(entity(r).resolvedId).toBe('com-94078')
  })

  it('Paris 11 → district arr-11', () => {
    const r = parseSpatialIntent('Paris 11')
    expect(entity(r).type).toBe('district')
    expect(entity(r).resolvedId).toBe('arr-11')
  })

  it('11e → district arr-11', () => {
    const r = parseSpatialIntent('11e')
    expect(entity(r).type).toBe('district')
    expect(entity(r).resolvedId).toBe('arr-11')
  })

  it('1er → district arr-1', () => {
    const r = parseSpatialIntent('1er')
    expect(entity(r).type).toBe('district')
    expect(entity(r).resolvedId).toBe('arr-1')
  })
})
