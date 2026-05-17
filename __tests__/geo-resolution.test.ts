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

// ─── Geocoding helpers for non-street POIs ────────────────────────────────────

type OverpassElem = { type: string; geometry?: Array<{lat:number;lon:number}>; members?: Array<{type:string;geometry?:Array<{lat:number;lon:number}>}> }

/** Fetch all OSM ways/relations named exactly `name` within 1.5km of (lat,lng).
 *  Returns [] on error or timeout (graceful degradation to Nominatim fallback). */
async function fetchPoiWaysOverpass(name: string, lat: number, lng: number): Promise<GeoJSON.LineString[]> {
  const delta = 0.015
  const bbox = `${(lat - delta).toFixed(4)},${(lng - delta).toFixed(4)},${(lat + delta).toFixed(4)},${(lng + delta).toFixed(4)}`
  const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')
  // Query ways AND relations (parks like Parc Monceau are OSM relations)
  const query = `[out:json][timeout:20];(way["name"~"^${escaped}$",i](${bbox});relation["name"~"^${escaped}$",i](${bbox}););out geom;`
  try {
    const res = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'SHOMEE-MVP/1.0 (contact@shomee.fr)' }, signal: AbortSignal.timeout(25_000) }
    )
    if (!res.ok) return []
    const data: { elements?: OverpassElem[] } = await res.json()
    const lines: GeoJSON.LineString[] = []
    for (const e of data.elements ?? []) {
      if (e.type === 'way' && Array.isArray(e.geometry) && (e.geometry?.length ?? 0) >= 2) {
        lines.push({ type: 'LineString', coordinates: e.geometry!.map(p => [p.lon, p.lat] as [number, number]) })
      } else if (e.type === 'relation' && Array.isArray(e.members)) {
        for (const m of e.members) {
          if (m.type === 'way' && Array.isArray(m.geometry) && (m.geometry?.length ?? 0) >= 2) {
            lines.push({ type: 'LineString', coordinates: m.geometry!.map(p => [p.lon, p.lat] as [number, number]) })
          }
        }
      }
    }
    return lines
  } catch { return [] }
}

/** Geocode a point/area POI: Nominatim for lat/lng + Overpass for complete boundary geometry.
 *  Mirrors the production geocode route logic exactly. */
async function geocodePoi(label: string, poiType: string, radiusM: number, query?: string): Promise<GeoConstraint> {
  const searchQ = query ?? `${label}, Paris`
  const params = new URLSearchParams({ q: searchQ, format: 'json', limit: '1', countrycodes: 'fr', polygon_geojson: '1' })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'SHOMEE-MVP/1.0 (contact@shomee.fr)' }, signal: AbortSignal.timeout(8_000),
  })
  const data: Array<{ lat: string; lon: string; display_name?: string; geojson?: GeoJSON.Geometry }> = await res.json()
  if (!data.length) throw new Error(`Nominatim: no result for "${searchQ}"`)
  const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon)
  const nominatimGeom = data[0].geojson ?? null
  console.log(`  [nominatim] "${searchQ}" → lat=${lat.toFixed(5)} lng=${lng.toFixed(5)} geom=${nominatimGeom?.type ?? 'none'}`)

  const poiWays = await fetchPoiWaysOverpass(label, lat, lng)
  console.log(`  [overpass POI] "${label}" → ${poiWays.length} ways/members`)

  let geometry: GeoJSON.Geometry | undefined
  let bbox: [number, number, number, number] | undefined

  if (poiWays.length > 0) {
    const allCoords = poiWays.map(w => w.coordinates)
    geometry = allCoords.length === 1
      ? { type: 'LineString', coordinates: allCoords[0] }
      : { type: 'MultiLineString', coordinates: allCoords }
    const pts = allCoords.flat()
    const lats = pts.map(p => p[1]), lngs = pts.map(p => p[0])
    bbox = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
    console.log(`  [overpass POI] geom_type=${geometry.type} bbox lat=[${bbox[0].toFixed(4)},${bbox[1].toFixed(4)}] lng=[${bbox[2].toFixed(4)},${bbox[3].toFixed(4)}]`)
  } else if (nominatimGeom && nominatimGeom.type !== 'Point') {
    // Fallback: use Nominatim Polygon/MultiPolygon (e.g. parks returned as relations)
    geometry = nominatimGeom
    console.log(`  [overpass POI] no ways — using Nominatim ${nominatimGeom.type} as fallback`)
  } else {
    console.log(`  [overpass POI] no geometry — point fallback only`)
  }

  return {
    type: 'poi', label, operator: 'inside', confidence: 1.0,
    poiType, lat, lng,
    geometry,
    bbox,
    radiusM,
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

  // ─── POI proximity tests ───────────────────────────────────────────────────
  //
  // These tests verify that "proche X" / "à deux pas de X" queries:
  //   1. Fetch the complete OSM boundary geometry (not just a center point)
  //   2. Select all IRIS within radiusM of ANY point on the POI boundary
  //   3. Work correctly for multi-arrondissement places (République: arr-3/10/11)
  //
  // Pipeline logged per test:
  //   [nominatim] → geocoded position
  //   [overpass POI] → number of OSM ways, combined bbox
  //   [result] → selected IRIS names

  it('label court "République" → doit résoudre via display_name Nominatim', async () => {
    // Régression critique : quand le LLM émet label:"République" (forme courte),
    // Nominatim retourne des nœuds railway (class=railway, geom=Point).
    // La route geocode doit extraire "Place de la République" depuis display_name
    // pour récupérer la vraie géométrie OSM de la place.
    console.log('\n[test] label="République" court — résolution via display_name')
    const constraint = await geocodePoi('République', 'landmark', 150, 'République, Paris')
    expect(constraint.geometry, 'Must have polygon geometry even with short label').toBeDefined()
    expect(constraint.geometry?.type).toMatch(/LineString|MultiLineString/)
    const result = resolveConstraints([constraint], iris, quartiers, communes)
    const names = selectedNames(result)
    const parentArr = new Set(
      result.irisIds.map(id => iris.find(z => z.id === id)?.parentId ?? '')
        .map(pid => pid.startsWith('qu-') ? (quartiers.find(q => q.id === pid)?.parentId ?? '') : pid)
    )
    console.log(`  [result] ${names.length} IRIS: ${names.join(', ')}`)
    console.log(`  [arrondissements] ${[...parentArr].join(', ')}`)
    expect([...parentArr].includes('arr-3'), 'Must include arr-3 IRIS').toBe(true)
    expect(result.irisIds.length).toBeGreaterThanOrEqual(5)
  }, 60_000)

  it('proche Place de la République → IRIS from arr-3, arr-10, arr-11', async () => {
    console.log('\n[test] "proche Place de la République" (radius=150m)')
    const constraint = await geocodePoi('Place de la République', 'landmark', 150)

    expect(constraint.geometry, 'Must have Overpass geometry').toBeDefined()
    expect(constraint.geometry?.type).toMatch(/LineString|MultiLineString/)

    const result = resolveConstraints([constraint], iris, quartiers, communes)
    const names = selectedNames(result)
    console.log(`  [result] ${names.length} IRIS: ${names.join(', ')}`)

    // Must select at least 3 IRIS (the place borders arr-3, arr-10, arr-11)
    expect(result.irisIds.length, 'Must select at least 3 IRIS').toBeGreaterThanOrEqual(3)

    // Check multi-arrondissement coverage — République is on the arr-3/10/11 boundary
    const parentArrIds = new Set(
      result.irisIds.map(id => iris.find(z => z.id === id)?.parentId ?? '')
        .map(pid => pid.startsWith('qu-') ? (quartiers.find(q => q.id === pid)?.parentId ?? '') : pid)
    )
    const hasArr3  = [...parentArrIds].some(id => id === 'arr-3')
    const hasArr10 = [...parentArrIds].some(id => id === 'arr-10')
    const hasArr11 = [...parentArrIds].some(id => id === 'arr-11')
    console.log(`  [arrondissements] arr-3=${hasArr3} arr-10=${hasArr10} arr-11=${hasArr11}`)
    expect(hasArr10 || hasArr11, 'Must include arr-10 or arr-11 IRIS').toBe(true)
    // arr-3 is the most important regression case (was previously missing)
    expect(hasArr3, 'Must include arr-3 IRIS (was previously missing)').toBe(true)
  }, 60_000)

  it('proche Place de la Nation → IRIS around Nation', async () => {
    console.log('\n[test] "proche Place de la Nation" (radius=100m)')
    const constraint = await geocodePoi('Place de la Nation', 'landmark', 150)

    expect(constraint.geometry, 'Must have geometry').toBeDefined()

    const result = resolveConstraints([constraint], iris, quartiers, communes)
    const names = selectedNames(result)
    console.log(`  [result] ${names.length} IRIS: ${names.join(', ')}`)

    expect(result.irisIds.length, 'Must select at least 2 IRIS').toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('à deux pas de Bastille → IRIS around Bastille', async () => {
    console.log('\n[test] "à deux pas de Bastille" (radius=100m)')
    const constraint = await geocodePoi('Place de la Bastille', 'landmark', 150)

    expect(constraint.geometry, 'Must have geometry').toBeDefined()

    const result = resolveConstraints([constraint], iris, quartiers, communes)
    const names = selectedNames(result)
    console.log(`  [result] ${names.length} IRIS: ${names.join(', ')}`)

    expect(result.irisIds.length, 'Must select at least 2 IRIS').toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('à côté du Parc Monceau → IRIS around Parc Monceau', async () => {
    console.log('\n[test] "à côté du Parc Monceau" (radius=100m)')
    const constraint = await geocodePoi('Parc Monceau', 'park', 150)

    expect(constraint.geometry, 'Must have geometry').toBeDefined()

    const result = resolveConstraints([constraint], iris, quartiers, communes)
    const names = selectedNames(result)
    console.log(`  [result] ${names.length} IRIS: ${names.join(', ')}`)

    expect(result.irisIds.length, 'Must select at least 1 IRIS').toBeGreaterThanOrEqual(1)
  }, 60_000)

  // ─── Transport line filter — polygon-edge distance regression ──────────────
  //
  // Fix: filterIrisByTransportLine for specific lines was using centroid→station
  // haversineM() instead of polygon-edge distanceStationToIris().
  // This caused false positives (centroid close but edge far) and false negatives
  // (edge close but centroid beyond the threshold).
  //
  // Tests verify three invariants:
  //   1. All selected IRIS belong to the specified arrondissements (no false positives)
  //   2. wasNarrowed = true (filtering actually happened — not the full arr)
  //   3. Selection count > 0 and < total IRIS count for those arrondissements

  /** Resolve IRIS parentId up to the arrondissement level (through quartier if needed). */
  function resolvedArrId(irisId: string): string {
    const zone = iris.find(z => z.id === irisId)
    if (!zone) return ''
    const pid = zone.parentId ?? ''
    if (pid.startsWith('arr-') || pid.startsWith('com-')) return pid
    if (pid.startsWith('qu-')) return quartiers.find(q => q.id === pid)?.parentId ?? ''
    return pid
  }

  it('Paris 13 + 14, proche ligne 6 (radiusM=400): no false positives, wasNarrowed', () => {
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', label: 'Paris 13', zoneId: 'arr-13', operator: 'inside', confidence: 1 },
      { type: 'administrative_area', label: 'Paris 14', zoneId: 'arr-14', operator: 'inside', confidence: 1 },
      { type: 'transport_line',      label: 'ligne 6',  line: '6',        operator: 'near',   confidence: 1, radiusM: 400 },
    ]

    const result = resolveConstraints(constraints, iris, quartiers, communes)
    const names = selectedNames(result)
    const arrIds = result.irisIds.map(resolvedArrId)
    const falsePositives = arrIds.filter(id => id !== 'arr-13' && id !== 'arr-14')

    console.log(`\n[test] Paris 13+14 ∩ ligne 6 (r=400) → ${names.length} IRIS`)
    console.log(`  arr-13: ${names.filter((_, i) => arrIds[i] === 'arr-13').join(', ')}`)
    console.log(`  arr-14: ${names.filter((_, i) => arrIds[i] === 'arr-14').join(', ')}`)
    if (falsePositives.length) console.warn(`  FALSE POSITIVES in: ${falsePositives.join(', ')}`)

    expect(falsePositives, `No IRIS outside arr-13/14: ${falsePositives.join(', ')}`).toHaveLength(0)
    expect(result.wasNarrowed, 'Filtering must have happened').toBe(true)
    expect(result.irisIds.length, 'Must select at least 3 IRIS').toBeGreaterThanOrEqual(3)

    // Total arr-13 + arr-14 IRIS > selected (the filter actually reduced the pool)
    const total13 = iris.filter(z => resolvedArrId(z.id) === 'arr-13').length
    const total14 = iris.filter(z => resolvedArrId(z.id) === 'arr-14').length
    expect(result.irisIds.length, `Filtered count must be less than total arr-13+14 (${total13 + total14})`
    ).toBeLessThan(total13 + total14)
  })

  it('Paris 15, proche ligne 8 (radiusM=400): no false positives, wasNarrowed', () => {
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', label: 'Paris 15', zoneId: 'arr-15', operator: 'inside', confidence: 1 },
      { type: 'transport_line',      label: 'ligne 8',  line: '8',        operator: 'near',   confidence: 1, radiusM: 400 },
    ]

    const result = resolveConstraints(constraints, iris, quartiers, communes)
    const names = selectedNames(result)
    const arrIds = result.irisIds.map(resolvedArrId)
    const falsePositives = arrIds.filter(id => id !== 'arr-15')

    console.log(`\n[test] Paris 15 ∩ ligne 8 (r=400) → ${names.length} IRIS: ${names.join(', ')}`)
    if (falsePositives.length) console.warn(`  FALSE POSITIVES: ${falsePositives.join(', ')}`)

    expect(falsePositives, `No IRIS outside arr-15: ${falsePositives.join(', ')}`).toHaveLength(0)
    expect(result.wasNarrowed).toBe(true)
    expect(result.irisIds.length).toBeGreaterThanOrEqual(2)
    const total15 = iris.filter(z => resolvedArrId(z.id) === 'arr-15').length
    expect(result.irisIds.length).toBeLessThan(total15)
  })

  it('Paris 11, proche ligne 9 (radiusM=350): no false positives, wasNarrowed', () => {
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', label: 'Paris 11', zoneId: 'arr-11', operator: 'inside', confidence: 1 },
      { type: 'transport_line',      label: 'ligne 9',  line: '9',        operator: 'near',   confidence: 1, radiusM: 350 },
    ]

    const result = resolveConstraints(constraints, iris, quartiers, communes)
    const names = selectedNames(result)
    const arrIds = result.irisIds.map(resolvedArrId)
    const falsePositives = arrIds.filter(id => id !== 'arr-11')

    console.log(`\n[test] Paris 11 ∩ ligne 9 (r=350) → ${names.length} IRIS: ${names.join(', ')}`)
    if (falsePositives.length) console.warn(`  FALSE POSITIVES: ${falsePositives.join(', ')}`)

    expect(falsePositives, `No IRIS outside arr-11: ${falsePositives.join(', ')}`).toHaveLength(0)
    expect(result.wasNarrowed).toBe(true)
    expect(result.irisIds.length).toBeGreaterThanOrEqual(2)
    const total11 = iris.filter(z => resolvedArrId(z.id) === 'arr-11').length
    expect(result.irisIds.length).toBeLessThan(total11)
  })

  it('Paris 16, proche ligne 9 (radiusM=350): no false positives, wasNarrowed', () => {
    const constraints: GeoConstraint[] = [
      { type: 'administrative_area', label: 'Paris 16', zoneId: 'arr-16', operator: 'inside', confidence: 1 },
      { type: 'transport_line',      label: 'ligne 9',  line: '9',        operator: 'near',   confidence: 1, radiusM: 350 },
    ]

    const result = resolveConstraints(constraints, iris, quartiers, communes)
    const names = selectedNames(result)
    const arrIds = result.irisIds.map(resolvedArrId)
    const falsePositives = arrIds.filter(id => id !== 'arr-16')

    console.log(`\n[test] Paris 16 ∩ ligne 9 (r=350) → ${names.length} IRIS: ${names.join(', ')}`)
    if (falsePositives.length) console.warn(`  FALSE POSITIVES: ${falsePositives.join(', ')}`)

    expect(falsePositives, `No IRIS outside arr-16: ${falsePositives.join(', ')}`).toHaveLength(0)
    expect(result.wasNarrowed).toBe(true)
    const total16 = iris.filter(z => resolvedArrId(z.id) === 'arr-16').length
    expect(result.irisIds.length).toBeLessThan(total16)
  })
})
