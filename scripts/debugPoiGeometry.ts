#!/usr/bin/env npx tsx
/**
 * Debug géométrique pour les requêtes de proximité POI.
 * Usage : npx tsx scripts/debugPoiGeometry.ts
 *
 * Pour chaque POI de test, affiche :
 *  1. Résultats Nominatim (display_name, osm_type, geojson.type, boundingbox)
 *  2. Géométrie unifiée Overpass (type, nb segments, bbox, nb points échantillonnés)
 *  3. Tous les IRIS candidats dans un rayon de 300m :
 *     - nom, arrondissement, distance minimale exacte (segment-segment), sélectionné ?
 *  4. Focus sur les IRIS de l'arrondissement cible s'ils sont manquants
 */

import {
  fetchParisQuartiers,
  fetchParisIris,
  fetchSuburbanCommunes,
  polygonCentroid,
  polygonContainsPoint,
  type GeoZone,
} from '../lib/services/geoDataService'

// ─── Flat-earth geometry helpers ─────────────────────────────────────────────

const REF_LAT = 48.8566  // Paris reference for cosLat

function toM(lat: number, lng: number, refLat = REF_LAT): [number, number] {
  const cosLat = Math.cos(refLat * Math.PI / 180)
  return [(lng - 0) * 111_320 * cosLat, lat * 111_320]  // absolute metres in flat earth
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Distance (m) from point (px,py) to segment (ax,ay)→(bx,by), in flat-earth metres. */
function distPtToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-10) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.sqrt((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2)
}

/**
 * Exact minimum distance (m) between segment [A,B] and segment [C,D].
 * For non-intersecting segments in 2D, the minimum is the minimum of the 4
 * endpoint-to-opposite-segment distances (well-known result).
 * Returns 0 if segments intersect.
 */
function distSegToSeg(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  // Cross product to detect intersection
  const cross = (ux: number, uy: number, vx: number, vy: number) => ux * vy - uy * vx
  const dAB = { x: bx - ax, y: by - ay }
  const dCD = { x: dx - cx, y: dy - cy }
  const denom = cross(dAB.x, dAB.y, dCD.x, dCD.y)
  if (Math.abs(denom) > 1e-10) {
    const dAC = { x: cx - ax, y: cy - ay }
    const t = cross(dAC.x, dAC.y, dCD.x, dCD.y) / denom
    const s = cross(dAC.x, dAC.y, dAB.x, dAB.y) / denom
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return 0  // intersection
  }
  return Math.min(
    distPtToSeg(ax, ay, cx, cy, dx, dy),
    distPtToSeg(bx, by, cx, cy, dx, dy),
    distPtToSeg(cx, cy, ax, ay, bx, by),
    distPtToSeg(dx, dy, ax, ay, bx, by),
  )
}

// Convert GeoJSON Position[] (lng,lat) to flat-earth [x,y][] in metres
function toFlatRing(positions: GeoJSON.Position[], cosLat: number): Array<[number, number]> {
  return positions.map(([lng, lat]) => [lng * 111_320 * cosLat, lat * 111_320])
}

/**
 * Exact minimum distance (m) between:
 *   poiSegs: collection of flat-earth [(x1,y1),(x2,y2)] segments for the POI
 *   irisRings: flat-earth rings for the IRIS polygon
 *
 * Returns 0 if POI geometry intersects or is inside the IRIS polygon,
 * or if any IRIS vertex is inside the POI boundary.
 */
function exactDistPoiToIris(
  poiSegs: Array<[[number, number], [number, number]]>,
  irisRings: Array<Array<[number, number]>>,
  zone: GeoZone,
  poiPositions: GeoJSON.Position[],
): number {
  // Check: any POI point inside IRIS polygon
  for (const [lng, lat] of poiPositions) {
    if (polygonContainsPoint(zone.feature.geometry, lng, lat)) return 0
  }

  let minDist = Infinity
  for (const [pa, pb] of poiSegs) {
    for (const ring of irisRings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const ia = ring[i], ib = ring[i + 1]
        const d = distSegToSeg(pa[0], pa[1], pb[0], pb[1], ia[0], ia[1], ib[0], ib[1])
        if (d < minDist) minDist = d
        if (minDist === 0) return 0
      }
    }
  }
  return minDist
}

// ─── Network helpers ──────────────────────────────────────────────────────────

const UA = { 'User-Agent': 'SHOMEE-DEBUG/1.0 (contact@shomee.fr)' }

async function nominatim(q: string) {
  const params = new URLSearchParams({ q, format: 'json', limit: '5', countrycodes: 'fr', polygon_geojson: '1' })
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: UA, signal: AbortSignal.timeout(10_000) })
  return r.json() as Promise<any[]>
}

async function overpassPoi(name: string, lat: number, lng: number): Promise<GeoJSON.LineString[]> {
  const delta = 0.015
  const bbox = `${(lat - delta).toFixed(4)},${(lng - delta).toFixed(4)},${(lat + delta).toFixed(4)},${(lng + delta).toFixed(4)}`
  const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')
  const q = `[out:json][timeout:10];(way["name"~"^${escaped}$",i](${bbox});relation["name"~"^${escaped}$",i](${bbox}););out geom;`
  const r = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, { headers: UA, signal: AbortSignal.timeout(15_000) })
  const data: any = await r.json()
  const lines: GeoJSON.LineString[] = []
  for (const e of data.elements ?? []) {
    if (e.type === 'way' && e.geometry?.length >= 2) {
      lines.push({ type: 'LineString', coordinates: e.geometry.map((p: any) => [p.lon, p.lat]) })
    } else if (e.type === 'relation' && e.members) {
      for (const m of e.members) {
        if (m.type === 'way' && m.geometry?.length >= 2) {
          lines.push({ type: 'LineString', coordinates: m.geometry.map((p: any) => [p.lon, p.lat]) })
        }
      }
    }
  }
  return lines
}

// ─── Main debug ───────────────────────────────────────────────────────────────

const TEST_CASES = [
  {
    query: 'Place de la République',
    label: 'Place de la République',
    radiusSelect: 100,
    radiusCandidate: 300,
    targetArr: 'arr-3',
    description: '"République" — vérifier IRIS arr-3 côté SO',
  },
]

async function debugCase(tc: typeof TEST_CASES[0], iris: GeoZone[], quartiers: GeoZone[]) {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`DEBUG: ${tc.description}`)
  console.log(`${'═'.repeat(70)}`)

  // ── 1. Nominatim ────────────────────────────────────────────────────────────
  console.log('\n── 1. NOMINATIM ──────────────────────────────────────────────────────')
  const nomResults = await nominatim(`${tc.query}, Paris`)
  for (const r of nomResults.slice(0, 5)) {
    console.log(`  osm_type=${r.osm_type} osm_id=${r.osm_id} class=${r.class} type=${r.type}`)
    console.log(`  display_name: ${r.display_name?.slice(0, 90)}`)
    console.log(`  geojson.type: ${r.geojson?.type ?? 'none'}`)
    console.log(`  boundingbox: ${JSON.stringify(r.boundingbox)}`)
    console.log()
  }
  const refLat = parseFloat(nomResults[0]?.lat ?? '48.8675')
  const refLng = parseFloat(nomResults[0]?.lon ?? '2.3633')

  // ── 2. Overpass geometry ────────────────────────────────────────────────────
  console.log('── 2. GÉOMÉTRIE OVERPASS ──────────────────────────────────────────────')
  const poiWays = await overpassPoi(tc.label, refLat, refLng)
  console.log(`  Ways/membres Overpass: ${poiWays.length}`)

  // All POI coordinates (raw lat/lng)
  const allPoiPositions: GeoJSON.Position[] = poiWays.flatMap(w => w.coordinates)
  const poiLats = allPoiPositions.map(p => p[1])
  const poiLngs = allPoiPositions.map(p => p[0])
  const poiBbox = { minLat: Math.min(...poiLats), maxLat: Math.max(...poiLats), minLng: Math.min(...poiLngs), maxLng: Math.max(...poiLngs) }
  console.log(`  Bbox: lat=[${poiBbox.minLat.toFixed(5)}, ${poiBbox.maxLat.toFixed(5)}] lng=[${poiBbox.minLng.toFixed(5)}, ${poiBbox.maxLng.toFixed(5)}]`)
  console.log(`  Total pts bruts: ${allPoiPositions.length}`)

  // Sample points every 20m (same as production filterIrisByGeometryProximity)
  const STEP_M = 20
  const sampledPts: GeoJSON.Position[] = []
  for (const way of poiWays) {
    const coords = way.coordinates
    sampledPts.push(coords[0])
    let leftover = 0
    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i], [lng2, lat2] = coords[i + 1]
      const seg = haversineM(lat1, lng1, lat2, lng2)
      let d = STEP_M - leftover
      while (d <= seg) {
        const t = d / seg
        sampledPts.push([lng1 + t * (lng2 - lng1), lat1 + t * (lat2 - lat1)])
        d += STEP_M
      }
      leftover = (leftover + seg) % STEP_M
    }
    sampledPts.push(coords[coords.length - 1])
  }
  console.log(`  Points échantillonnés (pas ${STEP_M}m): ${sampledPts.length}`)

  // Show coverage by longitude (to see if west/SW side is covered)
  const sampleLngs = sampledPts.map(p => p[0])
  console.log(`  Échantillons lng range: [${Math.min(...sampleLngs).toFixed(5)}, ${Math.max(...sampleLngs).toFixed(5)}]`)
  const westSamples = sampledPts.filter(p => p[0] < poiBbox.minLng + (poiBbox.maxLng - poiBbox.minLng) * 0.3)
  console.log(`  Échantillons côté ouest (<30% du bbox lng): ${westSamples.length}`)

  // ── Build flat-earth POI segments ───────────────────────────────────────────
  const cosLat = Math.cos(refLat * Math.PI / 180)
  const poiSegs: Array<[[number, number], [number, number]]> = []
  for (const way of poiWays) {
    const coords = way.coordinates
    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i], [lng2, lat2] = coords[i + 1]
      poiSegs.push([[lng1 * 111_320 * cosLat, lat1 * 111_320], [lng2 * 111_320 * cosLat, lat2 * 111_320]])
    }
  }
  console.log(`  Segments POI total: ${poiSegs.length}`)

  // ── 3. IRIS candidates ───────────────────────────────────────────────────────
  console.log('\n── 3. IRIS CANDIDATS (≤ 300m du centroïde de République) ──────────────')
  const candidates: Array<{
    zone: GeoZone
    arrId: string
    centroidDist: number
    exactDist: number
    selected: boolean
    reason?: string
  }> = []

  for (const zone of iris) {
    try {
      const [cLng, cLat] = polygonCentroid(zone.feature.geometry)
      const centDist = haversineM(refLat, refLng, cLat, cLng)
      if (centDist > tc.radiusCandidate + 300) continue  // skip far IRIS

      // Get arrondissement ID
      let arrId = 'unknown'
      if (zone.parentId?.startsWith('arr-')) arrId = zone.parentId
      else if (zone.parentId?.startsWith('qu-')) {
        const q = quartiers.find(q => q.id === zone.parentId)
        if (q?.parentId?.startsWith('arr-')) arrId = q.parentId
      }

      // Build flat-earth IRIS rings
      const geom = zone.feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
      const rings: GeoJSON.Position[][] = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat()
      const flatRings = rings.map(ring => toFlatRing(ring, cosLat))

      // Exact segment-to-segment distance
      const exactDist = exactDistPoiToIris(poiSegs, flatRings, zone, allPoiPositions)

      const selected = exactDist <= tc.radiusSelect
      let reason: string | undefined
      if (!selected) reason = `exactDist=${exactDist.toFixed(1)}m > radius=${tc.radiusSelect}m`

      candidates.push({ zone, arrId, centroidDist: centDist, exactDist, selected, reason })
    } catch { /* skip malformed */ }
  }

  candidates.sort((a, b) => a.exactDist - b.exactDist)

  const selected = candidates.filter(c => c.selected)
  const unselected = candidates.filter(c => !c.selected && c.centroidDist <= tc.radiusCandidate)

  console.log(`  Total candidats (≤${tc.radiusCandidate}m centroïde): ${candidates.filter(c => c.centroidDist <= tc.radiusCandidate).length}`)
  console.log(`  Sélectionnés (exactDist ≤ ${tc.radiusSelect}m): ${selected.length}`)
  console.log(`  Non sélectionnés mais proches: ${unselected.length}`)

  console.log('\n  SÉLECTIONNÉS :')
  for (const c of selected) {
    console.log(`    ✓ ${c.zone.name.padEnd(35)} ${c.arrId.padEnd(8)} exactDist=${c.exactDist.toFixed(1).padStart(6)}m  centroid=${c.centroidDist.toFixed(0).padStart(5)}m`)
  }

  if (unselected.length) {
    console.log('\n  NON SÉLECTIONNÉS (mais dans le rayon candidat) :')
    for (const c of unselected.slice(0, 20)) {
      console.log(`    ✗ ${c.zone.name.padEnd(35)} ${c.arrId.padEnd(8)} exactDist=${c.exactDist.toFixed(1).padStart(6)}m  centroid=${c.centroidDist.toFixed(0).padStart(5)}m  → ${c.reason}`)
    }
  }

  // ── 4. Focus sur l'arrondissement cible ─────────────────────────────────────
  console.log(`\n── 4. FOCUS ${tc.targetArr.toUpperCase()} ────────────────────────────────────────────`)
  const targetAll = iris.filter(zone => {
    let arrId = ''
    if (zone.parentId?.startsWith('arr-')) arrId = zone.parentId
    else if (zone.parentId?.startsWith('qu-')) {
      const q = quartiers.find(q => q.id === zone.parentId)
      if (q?.parentId?.startsWith('arr-')) arrId = q.parentId
    }
    return arrId === tc.targetArr
  })
  console.log(`  Total IRIS ${tc.targetArr} dans le dataset: ${targetAll.length}`)

  // Compute distance for all arr-3 IRIS near République (centroid ≤ 600m)
  const targetNear = targetAll.filter(zone => {
    try {
      const [cLng, cLat] = polygonCentroid(zone.feature.geometry)
      return haversineM(refLat, refLng, cLat, cLng) <= 600
    } catch { return false }
  })
  console.log(`  ${tc.targetArr} à ≤600m centroïde de République: ${targetNear.length}`)

  for (const zone of targetNear) {
    try {
      const [cLng, cLat] = polygonCentroid(zone.feature.geometry)
      const centDist = haversineM(refLat, refLng, cLat, cLng)
      const geom = zone.feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
      const rings: GeoJSON.Position[][] = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat()
      const flatRings = rings.map(ring => toFlatRing(ring, cosLat))
      const exactDist = exactDistPoiToIris(poiSegs, flatRings, zone, allPoiPositions)
      const sel = exactDist <= tc.radiusSelect
      const inSelected = candidates.find(c => c.zone.id === zone.id)

      console.log(`\n  ${sel ? '✓' : '✗'} ${zone.name}`)
      console.log(`    Centroïde: lat=${cLat.toFixed(5)} lng=${cLng.toFixed(5)}, distance centroïde=${centDist.toFixed(0)}m`)
      console.log(`    Distance exacte POI→IRIS: ${exactDist.toFixed(2)}m  (seuil=${tc.radiusSelect}m) → ${sel ? 'SÉLECTIONNÉ' : 'EXCLU'}`)
      console.log(`    Présent dans candidats: ${inSelected ? 'oui' : 'NON (centroid > radiusCandidate)'}`)

      if (!sel) {
        // Find closest POI segment to this IRIS
        let bestPoiSeg = -1, bestIrisSeg = -1, bestDist = Infinity
        for (let pi = 0; pi < poiSegs.length; pi++) {
          const [pa, pb] = poiSegs[pi]
          for (const ring of flatRings) {
            for (let ii = 0; ii < ring.length - 1; ii++) {
              const ia = ring[ii], ib = ring[ii + 1]
              const d = distSegToSeg(pa[0], pa[1], pb[0], pb[1], ia[0], ia[1], ib[0], ib[1])
              if (d < bestDist) { bestDist = d; bestPoiSeg = pi; bestIrisSeg = ii }
            }
          }
        }
        if (bestPoiSeg >= 0) {
          const [pa, pb] = poiSegs[bestPoiSeg]
          const paLng = pa[0] / (111_320 * cosLat), paLat = pa[1] / 111_320
          const pbLng = pb[0] / (111_320 * cosLat), pbLat = pb[1] / 111_320
          console.log(`    Segment POI le plus proche: [(${paLat.toFixed(5)},${paLng.toFixed(5)})→(${pbLat.toFixed(5)},${pbLng.toFixed(5)})]`)
        }

        // Check if this IRIS has any sample point within 200m
        const nearestSample = sampledPts.reduce((best, pt) => {
          const d = haversineM(pt[1], pt[0], cLat, cLng)
          return d < best ? d : best
        }, Infinity)
        console.log(`    Point échantillonné le plus proche du centroïde: ${nearestSample.toFixed(0)}m`)

        // Coverage: are there Overpass samples on the west/SW side near this IRIS?
        const westPoiPts = allPoiPositions.filter(p => p[0] < (poiBbox.minLng + (cLng - poiBbox.minLng) + 0.001))
        console.log(`    Points POI bruts à l'ouest de cet IRIS (lng<${(cLng + 0.001).toFixed(5)}): ${westPoiPts.length}`)
      }
    } catch (e) { console.log(`  ERROR for ${zone.name}: ${e}`) }
  }

  console.log('\n── CONCLUSION ─────────────────────────────────────────────────────────')
  const missing = targetNear.filter(zone => {
    const geom = zone.feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
    const rings: GeoJSON.Position[][] = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat()
    const flatRings = rings.map(ring => toFlatRing(ring, cosLat))
    return exactDistPoiToIris(poiSegs, flatRings, zone, allPoiPositions) > tc.radiusSelect
  })
  if (missing.length === 0) {
    console.log(`  ✅ Tous les IRIS ${tc.targetArr} proches sont sélectionnés avec radius=${tc.radiusSelect}m`)
  } else {
    console.log(`  ❌ ${missing.length} IRIS ${tc.targetArr} non sélectionnés avec radius=${tc.radiusSelect}m:`)
    for (const z of missing) console.log(`     - ${z.name}`)
    console.log('  → Augmenter le radius OU la géométrie POI ne couvre pas ce côté')
  }
}

async function main() {
  console.log('Chargement IRIS...')
  const quartiers = await fetchParisQuartiers()
  const communes = await fetchSuburbanCommunes()
  const iris = await fetchParisIris(quartiers, communes)
  console.log(`${iris.length} IRIS chargés`)

  for (const tc of TEST_CASES) {
    await debugCase(tc, iris, quartiers)
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
