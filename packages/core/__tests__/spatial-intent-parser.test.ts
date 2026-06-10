/**
 * Unit tests for SpatialIntentParser — fully offline, no network, no LLM.
 *
 * Run: npx vitest run __tests__/spatial-intent-parser.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parseSpatialIntent } from '@shomee/core/parsing/spatialIntentParser'

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

  it('resolves Neuilly as city com-92051', () => {
    expect(entity(result).type).toBe('city')
    expect(entity(result).resolvedId).toBe('com-92051')
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

  it('primary entity is Neuilly (city com-92051)', () => {
    expect(entity(result).type).toBe('city')
    expect(entity(result).resolvedId).toBe('com-92051')
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

// ─── Inline proximity "X proche/près Y" ──────────────────────────────────────

describe('inline proximity: "X proche Y" with known geographic reference', () => {
  it('"neuilly proche bois" → edge_of Bois de Boulogne, requiresLLM=false', () => {
    const r = parseSpatialIntent('neuilly proche bois')
    expect(entity(r).type).toBe('city')
    expect(entity(r).resolvedId).toBe('com-92051')
    expect(relation(r).type).toBe('edge_of')
    expect(relation(r).targetText).toBe('Bois de Boulogne')
    expect(r.requiresLLM).toBe(false)
  })

  it('"neuilly proche seine" → edge_of Seine', () => {
    const r = parseSpatialIntent('neuilly proche seine')
    expect(entity(r).resolvedId).toBe('com-92051')
    expect(relation(r).type).toBe('edge_of')
    expect(relation(r).targetText).toBe('Seine')
    expect(r.requiresLLM).toBe(false)
  })

  it('"16e proche bois" → edge_of Bois de Boulogne, arr-16', () => {
    const r = parseSpatialIntent('16e proche bois')
    expect(entity(r).type).toBe('district')
    expect(entity(r).resolvedId).toBe('arr-16')
    expect(relation(r).targetText).toBe('Bois de Boulogne')
    expect(r.requiresLLM).toBe(false)
  })

  it('"Boulogne proche bois" → edge_of Bois de Boulogne, com-92012', () => {
    const r = parseSpatialIntent('Boulogne proche bois')
    expect(entity(r).resolvedId).toBe('com-92012')
    expect(relation(r).targetText).toBe('Bois de Boulogne')
    expect(r.requiresLLM).toBe(false)
  })

  it('"neuilly proche metro" → unknown ref → requiresLLM=true', () => {
    const r = parseSpatialIntent('neuilly proche metro')
    expect(r.requiresLLM).toBe(true)
  })

  it('"neuilly proche centre" → unknown ref → requiresLLM=true', () => {
    const r = parseSpatialIntent('neuilly proche centre')
    expect(r.requiresLLM).toBe(true)
  })

  it('does NOT emit a cardinal direction for inline proximity', () => {
    const r = parseSpatialIntent('neuilly proche bois')
    expect(relation(r).direction).toBeUndefined()
  })
})

// ─── Exclusion target resolution — COTE_EXPANSIONS + "côté X" ───────────────

describe('resolveExclusionTarget: COTE_EXPANSIONS in exclusion context', () => {
  it('"Saint-Ouen sauf périph" → quartier(exclude) "Boulevard Périphérique", requiresLLM=false', () => {
    const r = parseSpatialIntent('Saint-Ouen sauf périph')
    expect(r.requiresLLM).toBe(false)
    expect(r.primaryEntities[0].type).toBe('city')
    expect(r.primaryEntities[0].resolvedId).toBe('com-93070')
    expect(r.exclusions).toHaveLength(1)
    expect(r.exclusions[0].type).toBe('quartier')
    expect(r.exclusions[0].resolvedId).toBe('zone-periph')
    expect(r.exclusions[0].label).toBe('Boulevard Périphérique')
  })

  it('"Vincennes hors bois" → poi(exclude) "Bois de Boulogne", requiresLLM=false', () => {
    const r = parseSpatialIntent('Vincennes hors bois')
    expect(r.requiresLLM).toBe(false)
    expect(r.primaryEntities[0].resolvedId).toBe('com-94080')
    expect(r.exclusions[0].type).toBe('poi')
    expect(r.exclusions[0].label).toBe('Bois de Boulogne')
  })

  it('"Neuilly mais pas côté Défense" → poi(exclude) "La Défense", requiresLLM=false', () => {
    const r = parseSpatialIntent('Neuilly mais pas côté Défense')
    expect(r.requiresLLM).toBe(false)
    expect(r.primaryEntities[0].resolvedId).toBe('com-92051')
    expect(r.exclusions[0].type).toBe('poi')
    expect(r.exclusions[0].label).toBe('La Défense')
  })

  it('"Neuilly sauf côté bois" → poi(exclude) "Bois de Boulogne"', () => {
    const r = parseSpatialIntent('Neuilly sauf côté bois')
    expect(r.exclusions[0].label).toBe('Bois de Boulogne')
  })

  it('"Charonne mais pas rue de Charonne" unaffected (street exclusion unchanged)', () => {
    const r = parseSpatialIntent('Charonne mais pas rue de Charonne')
    expect(r.exclusions[0].type).toBe('street')
  })

  it('"Paris 11 mais pas Belleville" unaffected (quartier vécu exclusion unchanged)', () => {
    const r = parseSpatialIntent('Paris 11 mais pas Belleville')
    // Belleville is not a COTE_EXPANSIONS key → resolves as quartier normally
    expect(r.exclusions[0].type).not.toBe('poi')  // keeps its natural type
    expect(r.requiresLLM).toBe(false)
  })
})

// ─── Negated proximity "X pas proche/loin Y" → exclusion ────────────────────

describe('negated proximity: "X pas proche/loin Y" → quartier(exclude) for static zones', () => {
  it('"Saint-Ouen pas proche périph" → inside(com-93070) + quartier(exclude, zone-periph)', () => {
    const r = parseSpatialIntent('Saint-Ouen pas proche périph')
    expect(r.requiresLLM).toBe(false)
    expect(entity(r).resolvedId).toBe('com-93070')
    expect(r.spatialRelations).toHaveLength(0)  // no positive spatial relation
    expect(r.exclusions).toHaveLength(1)
    expect(r.exclusions[0].type).toBe('quartier')
    expect(r.exclusions[0].resolvedId).toBe('zone-periph')
    expect(r.exclusions[0].label).toBe('Boulevard Périphérique')
  })

  it('"Neuilly loin du bois" → inside(com-92051) + poi(exclude, Bois de Boulogne)', () => {
    const r = parseSpatialIntent('Neuilly loin du bois')
    expect(r.requiresLLM).toBe(false)
    expect(entity(r).resolvedId).toBe('com-92051')
    expect(r.exclusions[0].label).toBe('Bois de Boulogne')
  })

  it('"Boulogne pas côté bois" → inside(com-92012) + poi(exclude)', () => {
    const r = parseSpatialIntent('Boulogne pas côté bois')
    expect(r.requiresLLM).toBe(false)
    expect(entity(r).resolvedId).toBe('com-92012')
    expect(r.exclusions[0].label).toBe('Bois de Boulogne')
  })

  it('"Saint-Ouen pas proche canal" → unknwon ref → NOT matched (canal not direction of exclusion here)', () => {
    // canal IS in COTE_EXPANSIONS so this resolves to exclusion
    const r = parseSpatialIntent('Saint-Ouen pas proche canal')
    expect(r.requiresLLM).toBe(false)
    expect(r.exclusions[0].label).toBe('Canal Saint-Martin')
  })

  it('"Saint-Ouen pas proche metro" → unknown ref → requiresLLM=true', () => {
    const r = parseSpatialIntent('Saint-Ouen pas proche metro')
    expect(r.requiresLLM).toBe(true)
  })

  it('does NOT emit a spatial relation for negated proximity', () => {
    const r = parseSpatialIntent('Neuilly loin du bois')
    expect(r.spatialRelations).toHaveLength(0)
  })

  it('"neuilly loin de la seine" → poi(exclude, Seine)', () => {
    const r = parseSpatialIntent('Neuilly loin de la Seine')
    expect(r.requiresLLM).toBe(false)
    expect(r.exclusions[0].label).toBe('Seine')
  })
})

// ─── Known cities / arrondissements ──────────────────────────────────────────

describe('city and district resolution', () => {
  it('Vincennes → city com-94080', () => {
    const r = parseSpatialIntent('Vincennes')
    expect(entity(r).type).toBe('city')
    expect(entity(r).resolvedId).toBe('com-94080')
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
