#!/usr/bin/env npx tsx
/**
 * Generates src/data/transportStations.json from the official IDFM open data.
 *
 * Source: data.iledefrance-mobilites.fr — "emplacement-des-gares-idf"
 * One API call (1 240 records, all IDF metro/RER/tram/train stations).
 *
 * Field mapping (confirmed from API inspection):
 *   nom_gares       → station label
 *   mode            → 'METRO' | 'RER' | 'TRAMWAY' | 'TRAM' | 'TRAIN' | 'VAL' | 'CABLE'
 *   indice_lig      → line code ('1', 'A', 'T3A', 'H', ...)
 *   geo_point_2d    → { lat, lon }
 *
 * The same station can appear N times (once per line it serves).
 * Deduplication: group by (normalizedLabel, roundedLat, roundedLng).
 *
 * Usage: npx tsx scripts/fetchTransportStations.ts
 * Output: src/data/transportStations.json
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── Types ─────────────────────────────────────────────────────────────────

type StationType = 'metro_station' | 'rer_station' | 'tram_station' | 'transilien_station'

interface TransportStation {
  id: string
  label: string
  aliases: string[]
  type: StationType
  network: string
  lines: string[]
  city: string
  arrondissement: string
  coordinates: { lat: number; lng: number }
  defaultRadiusMeters: number
}

// ─── Config ─────────────────────────────────────────────────────────────────

// Modes to include (VAL = automated light metro outside scope, CABLE = funicular)
const INCLUDE_MODES = new Set(['METRO', 'RER', 'TRAMWAY', 'TRAM', 'TRAIN'])

// Coverage: Paris + petite couronne bounding box (with generous margins)
const COVERAGE_BB = { latMin: 48.70, latMax: 49.05, lngMin: 2.10, lngMax: 2.70 }

const IDFM_URL = 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/emplacement-des-gares-idf/exports/json?limit=10000&timezone=UTC'

const PARIS_BB = { latMin: 48.815, latMax: 48.908, lngMin: 2.221, lngMax: 2.473 }

const ARR_CENTROIDS: Record<number, [number, number]> = {
  1:  [48.8607, 2.3476],  2:  [48.8672, 2.3479],  3:  [48.8638, 2.3620],
  4:  [48.8540, 2.3548],  5:  [48.8462, 2.3512],  6:  [48.8489, 2.3330],
  7:  [48.8566, 2.3145],  8:  [48.8747, 2.3098],  9:  [48.8762, 2.3371],
  10: [48.8760, 2.3597], 11:  [48.8595, 2.3798], 12:  [48.8419, 2.3929],
  13: [48.8280, 2.3612], 14:  [48.8327, 2.3262], 15:  [48.8411, 2.2903],
  16: [48.8634, 2.2727], 17:  [48.8879, 2.3137], 18:  [48.8928, 2.3436],
  19: [48.8827, 2.3808], 20:  [48.8628, 2.3980],
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function isInParis(lat: number, lng: number): boolean {
  return lat >= PARIS_BB.latMin && lat <= PARIS_BB.latMax && lng >= PARIS_BB.lngMin && lng <= PARIS_BB.lngMax
}

function nearestArrondissement(lat: number, lng: number): number {
  let best = 1, bestDist = Infinity
  for (const [n, [cLat, cLng]] of Object.entries(ARR_CENTROIDS)) {
    const d = haversineM(lat, lng, cLat, cLng)
    if (d < bestDist) { bestDist = d; best = parseInt(n) }
  }
  return best
}

function getType(mode: string): StationType {
  const m = mode.toUpperCase()
  if (m === 'TRAMWAY' || m === 'TRAM') return 'tram_station'
  if (m === 'RER') return 'rer_station'
  if (m === 'TRAIN') return 'transilien_station'
  return 'metro_station' // METRO
}

function getNetwork(type: StationType): string {
  if (type === 'rer_station') return 'RATP/SNCF'
  if (type === 'transilien_station') return 'SNCF'
  return 'RATP'
}

function getRadius(type: StationType): number {
  if (type === 'rer_station' || type === 'transilien_station') return 500
  if (type === 'tram_station') return 300
  return 350
}

/** Normalize a line code to a short standard form */
function normalizeLine(raw: string): string {
  if (!raw) return ''
  const s = raw.trim()
  // Already in good form: "1", "A", "T3A", "H", etc.
  if (/^[0-9]{1,2}(bis|BIS)?$/.test(s)) return s.toUpperCase()
  if (/^[A-E]$/.test(s)) return s.toUpperCase()
  if (/^T[0-9]{1,2}[AB]?$/i.test(s)) return s.toUpperCase()
  if (/^[A-Z]$/.test(s)) return s.toUpperCase() // Transilien lines H, J, K, L, N, P, R, U
  return s.toUpperCase()
}

// ─── Main ───────────────────────────────────────────────────────────────────

interface IdfmRecord {
  nom_gares?: string
  mode?: string
  indice_lig?: string
  geo_point_2d?: { lat?: number; lon?: number; lng?: number }
  [key: string]: unknown
}

async function main() {
  process.stdout.write('Fetching IDFM stations (official source)…\n')
  const res = await fetch(IDFM_URL, {
    headers: { 'User-Agent': 'shomee-fetch/2.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const raw: IdfmRecord[] = await res.json() as IdfmRecord[]
  process.stdout.write(`  ${raw.length} records received\n\n`)

  // Group by (label, rounded coords) to merge multi-line stations
  type Key = string
  const grouped = new Map<Key, {
    label: string; lat: number; lng: number
    mode: string; lines: Set<string>
  }>()

  let skipped = 0

  for (const r of raw) {
    const mode = (r.mode ?? '').toUpperCase().trim()
    if (!INCLUDE_MODES.has(mode)) { skipped++; continue }

    const gp = r.geo_point_2d
    const lat = typeof gp?.lat === 'number' ? gp.lat : NaN
    const lng = typeof gp?.lon === 'number' ? gp.lon : (typeof gp?.lng === 'number' ? gp.lng : NaN)
    if (isNaN(lat) || isNaN(lng)) { skipped++; continue }

    // Filter to coverage area
    if (lat < COVERAGE_BB.latMin || lat > COVERAGE_BB.latMax ||
        lng < COVERAGE_BB.lngMin || lng > COVERAGE_BB.lngMax) {
      skipped++; continue
    }

    const label = (r.nom_gares ?? '').trim()
    if (!label) { skipped++; continue }

    const line = normalizeLine(r.indice_lig ?? '')

    // Dedup key: name + coarse position (cells ~500m — merges multi-line same-station entries
    // like Reuilly-Diderot L1 + L8, Bastille L1 + L5 + L8, etc.)
    const key = `${slugify(label)}_${Math.round(lat * 200)}_${Math.round(lng * 200)}`

    if (!grouped.has(key)) {
      grouped.set(key, { label, lat, lng, mode, lines: new Set() })
    }
    const entry = grouped.get(key)!
    if (line) entry.lines.add(line)
    // Keep highest-priority mode if multiple (METRO > RER > TRAMWAY > TRAIN)
    const priority: Record<string, number> = { METRO: 4, RER: 3, TRAMWAY: 2, TRAM: 2, TRAIN: 1 }
    if ((priority[mode] ?? 0) > (priority[entry.mode] ?? 0)) entry.mode = mode
  }

  process.stdout.write(`  ${grouped.size} unique stations (${skipped} records filtered)\n\n`)

  // Build final array
  const stations: TransportStation[] = []
  const seenIds = new Map<string, number>()

  for (const entry of grouped.values()) {
    const { lat, lng, label, mode, lines } = entry
    const type = getType(mode)
    const inParis = isInParis(lat, lng)
    const city = inParis ? 'Paris' : ''
    const arrondissement = inParis ? `Paris ${nearestArrondissement(lat, lng)}` : ''

    let id = slugify(label)
    const n = seenIds.get(id) ?? 0
    seenIds.set(id, n + 1)
    if (n > 0) id = `${id}_${n + 1}` // disambiguate rare same-name stations

    stations.push({
      id, label, aliases: [], type,
      network: getNetwork(type),
      lines: [...lines].sort(),
      city, arrondissement,
      coordinates: { lat, lng },
      defaultRadiusMeters: getRadius(type),
    })
  }

  // Sort: Paris first, then alphabetically
  stations.sort((a, b) => {
    if (a.city === 'Paris' && b.city !== 'Paris') return -1
    if (b.city === 'Paris' && a.city !== 'Paris') return 1
    return a.label.localeCompare(b.label, 'fr')
  })

  // Stats
  const byType = stations.reduce<Record<string, number>>((acc, s) => {
    acc[s.type] = (acc[s.type] ?? 0) + 1; return acc
  }, {})
  const parisCount = stations.filter(s => s.city === 'Paris').length

  process.stdout.write(`=== Results ===\n`)
  process.stdout.write(`Total: ${stations.length}\n`)
  process.stdout.write(`  Paris intramuros : ${parisCount}\n`)
  process.stdout.write(`  Autres communes  : ${stations.length - parisCount}\n\n`)
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${t.padEnd(24)}: ${n}\n`)
  }

  const outPath = resolve(process.cwd(), 'src/data/transportStations.json')
  writeFileSync(outPath, JSON.stringify(stations, null, 2), 'utf-8')
  process.stdout.write(`\nOutput: ${outPath}\n`)
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
