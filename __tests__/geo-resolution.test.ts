/**
 * Integration tests for the geographic resolution pipeline.
 *
 * These tests simulate the full pipeline from user query to IRIS selection:
 *   1. Entity recognition (no network)
 *   2. LLM constraint (mocked with known output)
 *   3. Geocoding: Overpass (complete street geometry) + Nominatim (lat/lng)
 *   4. IRIS data loading from OpenDataSoft (network, ~20-30s on first run)
 *   5. Constraint resolution → IRIS IDs
 *   6. Assert against expected IRIS names
 *
 * Run: npx vitest run __tests__/geo-resolution.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { findQuartierById } from '../lib/services/quartierMatchingService'
import {
  fetchParisQuartiers,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '../lib/services/geoDataService'
import {
  resolveConstraints,
  type GeoConstraint,
  poiRadius,
} from '../lib/services/geoConstraintService'

// ─── Shared geo data (loaded once for all tests) ────────────────────────────

let iris: GeoZone[] = []
let quartiers: GeoZone[] = []
let communes: GeoZone[] = []

beforeAll(async () => {
  console.log('\n[setup] Loading IRIS data from OpenDataSoft (may take 20-30s)…')
  const t0 = Date.now()
  quartiers = await fetchParisQuartiers()
  communes = await fetchSuburbanCommunes()
  iris = await fetchParisIris(quartiers, communes)
  console.log(`[setup] ✓ ${iris.length} IRIS loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}, 120_000)

// ─── Geocoding helpers (replicate geocode route logic) ───────────────────────

const SEARCH_OVERPASS_BBOX = '48.77,2.18,48.96,2.55'

async function fetchStreetWaysOverpass(streetName: string): Promise<GeoJSON.LineString[]> {
  const escaped = streetName.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')
  const query = `[out:json][timeout:20];way["name"~"^${escaped}$",i]["highway"](${SEARCH_OVERPASS_BBOX});out geom;`
  const res = await fetch(
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': 'SHOMEE-MVP/1.0 (contact@shomee.fr)' }, signal: AbortSignal.timeout(15_000) }
  )
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`)
  const data: { elements?: Array<{ type: string; geometry?: Array<{ lat: number; lon: number }> }> } = await res.json()
  return (data.elements ?? [])
    .filter(e => e.type === 'way' && Array.isArray(e.geometry) && (e.geometry?.length ?? 0) >= 2)
    .map(e => ({
      type: 'LineString' as const,
      coordinates: e.geometry!.map(p => [p.lon, p.lat] as [number, number]),
    }))
}

async function nominatimGeocode(q: string): Promise<{ lat: number; lng: number; parentArrIds: string[] }> {
  const params = new URLSearchParams({ q, format: 'json', limit: '5', countrycodes: 'fr', polygon_geojson: '0' })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'SHOMEE-MVP/1.0 (contact@shomee.fr)' },
    signal: AbortSignal.timeout(8_000),
  })
  const data: Array<{ lat: string; lon: string; display_name?: string }> = await res.json()
  if (!data.length) throw new Error('Nominatim: no result')

  // Extract arr IDs from display_names: "... Paris 17e Arrondissement ..."
  const arrIds = [...new Set(
    data
      .map(r => {
        const m = (r.display_name ?? '').match(/Paris\s+(\d+)e?r?\s+Arrondissement/i)
        return m ? `arr-${parseInt(m[1])}` : null
      })
      .filter((id): id is string => id !== null)
  )]
  console.log(`  [nominatim] display_name="${data[0].display_name?.slice(0, 80)}"`)
  console.log(`  [nominatim] parentArrIds=${arrIds.join(', ') || 'none (suburban)'}`)

  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), parentArrIds: arrIds }
}

async function geocodeStreet(label: string, poiType: string): Promise<GeoConstraint> {
  const overpassWays = await fetchStreetWaysOverpass(label)
  console.log(`  [overpass] label="${label}" → ${overpassWays.length} ways`)

  let geometry: GeoJSON.Geometry | null = null
  let bbox: [number, number, number, number] | null = null

  if (overpassWays.length > 0) {
    const allCoords = overpassWays.map(w => w.coordinates)
    geometry = allCoords.length === 1
      ? { type: 'LineString', coordinates: allCoords[0] }
      : { type: 'MultiLineString', coordinates: allCoords }
    const pts = allCoords.flat()
    const lats = pts.map(p => p[1])
    const lngs = pts.map(p => p[0])
    bbox = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
    console.log(`  [overpass] bbox lat=[${bbox[0].toFixed(4)},${bbox[1].toFixed(4)}] lng=[${bbox[2].toFixed(4)},${bbox[3].toFixed(4)}]`)
  }

  const { lat, lng, parentArrIds } = await nominatimGeocode(`${label}, Paris`)
  console.log(`  [nominatim] lat=${lat.toFixed(5)} lng=${lng.toFixed(5)}`)

  return {
    type: 'poi', label, operator: 'inside', confidence: 1.0,
    poiType, lat, lng,
    geometry: geometry ?? undefined,
    bbox: bbox ?? undefined,
    radiusM: poiRadius(poiType),
    parentArrIds: parentArrIds.length ? parentArrIds : undefined,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function selectedNames(result: ReturnType<typeof resolveConstraints>): string[] {
  return iris.filter(z => result.irisIds.includes(z.id)).map(z => z.name)
}

/** Build a semantic_neighborhood constraint from quartiers.json irisNames (no network). */
function quartierConstraint(id: string, label: string): GeoConstraint {
  const qt = findQuartierById(id)
  return {
    type: 'semantic_neighborhood', label, operator: 'near', confidence: 0.95,
    neighborhoodId: id, radiusM: 500, irisNames: qt?.irisNames,
  }
}

// ─── Test cases ──────────────────────────────────────────────────────────────

describe('geo-resolution pipeline', () => {
  /**
   * Avenue des Ternes (17e) — long E-W avenue split into 30+ OSM ways.
   * Regression: was showing only Ternes 1 + Ternes 10 due to:
   *   - Overpass missing User-Agent → 406 → fallback to Nominatim partial geometry
   *   - Cardinal direction offsets → endpoint overshoot into Faubourg du Roule (8e)
   */
  it('Avenue des Ternes → Ternes 1,3,4,7,8,9,10,16', async () => {
    const label = 'Avenue des Ternes'
    const poiType = 'avenue'
    console.log(`\n[test] "${label}" (poiType=${poiType})`)

    const constraint = await geocodeStreet(label, poiType)

    expect(constraint.geometry, 'Overpass must return geometry').not.toBeNull()
    expect(constraint.geometry?.type).toMatch(/LineString|MultiLineString/)

    const result = resolveConstraints([constraint], iris, quartiers, communes)
    const names = selectedNames(result)
    const ternesSelected = names.filter(n => n.toLowerCase().startsWith('ternes'))

    console.log(`  [result] total IRIS: ${names.length}`)
    console.log(`  [result] Ternes selected: ${ternesSelected.join(', ')}`)
    console.log(`  [result] Non-Ternes: ${names.filter(n => !n.toLowerCase().startsWith('ternes')).join(', ')}`)

    const expected = ['Ternes 1', 'Ternes 3', 'Ternes 4', 'Ternes 7', 'Ternes 8', 'Ternes 9', 'Ternes 10', 'Ternes 16']

    // No false positives outside 17e (Faubourg du Roule etc.)
    const falsePositives = names.filter(n => n.toLowerCase().includes('faubourg du roule'))
    expect(falsePositives, `False positives: ${falsePositives.join(', ')}`).toHaveLength(0)

    // All expected IRIS present
    for (const exp of expected) {
      expect(ternesSelected, `Missing: ${exp}`).toContain(exp)
    }
  })

  /**
   * Pigalle — quartier from quartiers.json with explicit irisNames.
   * Regression: irisNames lookup only worked for operator:'inside', not the standalone
   * operator:'near' path used by neighborhoodToConstraints.
   */
  it('Pigalle → IRIS from irisNames (Saint-georges, Rochechouart, Clignancourt)', () => {
    const constraint = quartierConstraint('pigalle', 'Pigalle')
    expect(constraint.irisNames?.length, 'Pigalle must have irisNames').toBeGreaterThan(0)
    console.log(`\n[test] Pigalle irisNames: ${constraint.irisNames?.join(', ')}`)

    const result = resolveConstraints([constraint], iris, quartiers, communes)
    const names = selectedNames(result)
    console.log(`  [result] IRIS selected: ${names.join(', ')}`)

    expect(result.irisIds.length, 'Must select at least 5 IRIS').toBeGreaterThanOrEqual(5)
    const hasSaintGeorges = names.some(n => n.toLowerCase().includes('saint-georges'))
    expect(hasSaintGeorges, 'Must include Saint-Georges IRIS').toBe(true)
  })

  /**
   * Châtelet — new quartier NOT in semanticNeighborhoods.json (only in quartiers.json).
   * Tests the standalone path that was previously broken.
   */
  it('Châtelet → Les Halles IRIS (new quartier, irisNames only)', () => {
    const constraint = quartierConstraint('chatelet', 'Châtelet')
    expect(constraint.irisNames?.length, 'Châtelet must have irisNames').toBeGreaterThan(0)

    const result = resolveConstraints([constraint], iris, quartiers, communes)
    const names = selectedNames(result)
    console.log(`\n[test] Châtelet → ${names.join(', ')}`)

    expect(result.irisIds.length, 'Must select at least 1 IRIS').toBeGreaterThanOrEqual(1)
    const hasHalles = names.some(n => n.toLowerCase().includes('halles'))
    expect(hasHalles, 'Must include Les Halles IRIS').toBe(true)
  })
})
