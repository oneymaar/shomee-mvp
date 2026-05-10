#!/usr/bin/env npx tsx
/**
 * Enriches semanticNeighborhoods.json with computed fields:
 *
 *   relatedIrisIds   — IRIS zone IDs whose centroid falls within
 *                      confidenceRadiusMeters of the neighborhood center
 *   relatedStations  — overwritten with stations found in the local DB
 *                      within STATION_SEARCH_RADIUS_M of the center
 *
 * Data sources:
 *   LOCAL  — METRO_STATIONS from lib/services/metroStationsDb.ts
 *   REMOTE — IRIS/Arrondissement/Quartier/Commune GeoJSON fetched ONCE
 *            per department (4 depts × 1 call = 4 calls for IRIS,
 *            plus 5 calls for arr/quartiers/communes)
 *
 * Usage:
 *   npx tsx scripts/enrichSemanticNeighborhoods.ts
 *
 * Output:
 *   src/data/semanticNeighborhoods.enriched.json
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Local data — no network needed
import { METRO_STATIONS } from '../lib/services/metroStationsDb'
import rawNeighborhoods from '../src/data/semanticNeighborhoods.json'

// ─── Types ─────────────────────────────────────────────────────────────────

interface Neighborhood {
  id: string
  label: string
  aliases: string[]
  city: string
  arrondissement: string
  type: string
  center: { lat: number; lng: number }
  relatedStations: string[]
  confidenceRadiusMeters: number
  description: string
  vibeTags: string[]
}

interface EnrichedNeighborhood extends Neighborhood {
  relatedIrisIds: string[]
}

interface IrisZone {
  irisId: string    // "iris-75XXXNNNNN"
  centroid: [number, number]  // [lat, lng]
}

type GeoFeature = {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown }
}

type GeoFC = { type: 'FeatureCollection'; features: GeoFeature[] }

// ─── Config ─────────────────────────────────────────────────────────────────

const STATION_SEARCH_RADIUS_M = 800   // metros listed as "related"

const IRIS_URL  = (dept: string) =>
  `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-france-iris/exports/geojson?where=dep_code%3D%22${dept}%22&limit=2000&lang=fr`
const ARR_URL   = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arrondissements/exports/geojson?lang=fr'
const QU_URL    = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/quartier_paris/exports/geojson?lang=fr'
const COM_URL   = (dept: string) =>
  `https://geo.api.gouv.fr/communes?codeDepartement=${dept}&format=geojson&geometry=contour`

// ─── Math helpers ───────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Arithmetic centroid of the first ring of a Polygon / MultiPolygon. */
function polygonCentroid(geom: GeoFeature['geometry']): [number, number] {
  let ring: number[][]
  if (geom.type === 'Polygon') {
    ring = (geom.coordinates as number[][][])[0]
  } else if (geom.type === 'MultiPolygon') {
    const coords = geom.coordinates as number[][][][]
    ring = coords.reduce((a, b) => (a[0].length >= b[0].length ? a : b))[0]
  } else {
    return [2.3522, 48.8566] // fallback: Paris center
  }
  const n = ring.length
  const lng = ring.reduce((s, c) => s + c[0], 0) / n
  const lat = ring.reduce((s, c) => s + c[1], 0) / n
  return [lat, lng]
}

// ─── Network helpers ────────────────────────────────────────────────────────

async function fetchGeoJSON(url: string, label: string): Promise<GeoFC> {
  process.stdout.write(`  Fetching ${label} … `)
  const res = await fetch(url, {
    headers: { 'User-Agent': 'shomee-enrich-script/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const data = await res.json() as GeoFC
  if (data?.type !== 'FeatureCollection') throw new Error(`Not a FeatureCollection: ${url}`)
  console.log(`${data.features.length} features`)
  return data
}

// ─── IRIS extraction ────────────────────────────────────────────────────────

/** Parse only what we need: iris id + centroid. */
function extractIrisZones(fc: GeoFC): IrisZone[] {
  const zones: IrisZone[] = []
  for (const f of fc.features) {
    const p = f.properties
    const raw = p.iris_code
    const irisCode = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '')
    if (!irisCode || irisCode.length < 9) continue
    const centroid = polygonCentroid(f.geometry)
    zones.push({ irisId: `iris-${irisCode}`, centroid })
  }
  return zones
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Enrich Semantic Neighborhoods ===\n')

  // ── 1. Fetch all IRIS (once per department) ───────────────────────────────
  console.log('Fetching IRIS data (4 departments):')
  const irisDepts = ['75', '92', '93', '94']
  const irisResults = await Promise.allSettled(
    irisDepts.map((d) => fetchGeoJSON(IRIS_URL(d), `IRIS dept ${d}`))
  )

  const allIrisZones: IrisZone[] = []
  for (const r of irisResults) {
    if (r.status === 'fulfilled') {
      allIrisZones.push(...extractIrisZones(r.value))
    } else {
      console.warn('  WARNING: failed to fetch IRIS dept:', r.reason)
    }
  }
  console.log(`\n  Total IRIS zones loaded: ${allIrisZones.length}\n`)

  // ── 2. Process each neighborhood ──────────────────────────────────────────
  console.log('Processing neighborhoods:\n')
  const enriched: EnrichedNeighborhood[] = []

  for (const nb of rawNeighborhoods as Neighborhood[]) {
    const { lat, lng } = nb.center
    const radius = nb.confidenceRadiusMeters

    // IRIS within confidence radius
    const nearbyIris = allIrisZones
      .filter((z) => haversineM(lat, lng, z.centroid[0], z.centroid[1]) <= radius)
      .map((z) => z.irisId)
      .sort()

    // Stations within search radius (from local DB — no API needed)
    const nearbyStations = METRO_STATIONS
      .filter((s) => haversineM(lat, lng, s.lat, s.lng) <= STATION_SEARCH_RADIUS_M)
      .sort((a, b) => haversineM(lat, lng, a.lat, a.lng) - haversineM(lat, lng, b.lat, b.lng))
      .map((s) => s.name)

    console.log(
      `  ${nb.label.padEnd(28)} ` +
      `${nearbyIris.length.toString().padStart(3)} IRIS  ` +
      `${nearbyStations.length.toString().padStart(2)} stations`
    )

    enriched.push({
      ...nb,
      relatedStations: nearbyStations,
      relatedIrisIds: nearbyIris,
    })
  }

  // ── 3. Write output ───────────────────────────────────────────────────────
  const outPath = resolve(process.cwd(), 'src/data/semanticNeighborhoods.enriched.json')
  writeFileSync(outPath, JSON.stringify(enriched, null, 2), 'utf-8')

  console.log(`\n=== Done ===`)
  console.log(`Output: ${outPath}`)
  console.log(
    `Total: ${enriched.length} neighborhoods, ` +
    `${enriched.reduce((s, n) => s + n.relatedIrisIds.length, 0)} IRIS references`
  )
}

main().catch((err) => {
  console.error('\nFATAL:', err)
  process.exit(1)
})
