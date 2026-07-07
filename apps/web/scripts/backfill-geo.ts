/**
 * Shomee — backfill géo des biens.
 *
 * Pour chaque bien avec une adresse mais sans polygone IRIS :
 *   1. géocode l'adresse → lat/lng (api-adresse via geocodeBest)
 *   2. point-dans-polygone contre contours-iris.geojson → vraie zone IRIS
 *      (nom + polygone [lat,lng] pour la carte)
 *   3. stations de transport les plus proches (transportStations.json)
 *   → écrit mapLat, mapLng, irisZone, irisPolygon, mapTransports, transports.
 *
 * Idempotent : ne traite que les biens `irisPolygon = null` (+ address non-null).
 * POI/commerces = script séparé (backfill-poi via Overpass).
 *
 * Run :
 *   npx tsx scripts/backfill-geo.ts            (tous)
 *   npx tsx scripts/backfill-geo.ts --limit 5  (test sur 5)
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { geocodeBest } from '../lib/services/geocodingService.ts'

const CONCURRENCY = 6
const METRO_RADIUS_M = 1000
const MAX_STATIONS = 5
// Temps de marche estimé : distance à vol d'oiseau × détour ÷ vitesse (~4,8 km/h).
const WALK_M_PER_MIN = 80
const WALK_DETOUR = 1.3
function walkMinutes(distM: number): number {
  return Math.max(1, Math.round((distM * WALK_DETOUR) / WALK_M_PER_MIN))
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : undefined
// --force : re-traite TOUS les biens (ignore l'idempotence mapLat), pour
// rafraîchir métro/IRIS/coords sur des biens déjà enrichis.
const FORCE = process.argv.includes('--force')

// ─── IRIS : chargement + index bbox + point-dans-polygone ──────────────────

type Ring = number[][] // [[lng,lat], …]
interface IrisFeat {
  nom: string
  bbox: [number, number, number, number] // minLng,minLat,maxLng,maxLat
  rings: Ring[] // anneaux extérieurs de chaque sous-polygone
}

function loadIris(): IrisFeat[] {
  const url = new URL('../../../tmp/contours-iris.geojson', import.meta.url)
  const fc = JSON.parse(readFileSync(url, 'utf-8')) as {
    features: Array<{ geometry: GeoJSON.Geometry; properties: Record<string, unknown> }>
  }
  const out: IrisFeat[] = []
  for (const f of fc.features) {
    const g = f.geometry
    let polys: number[][][][] = []
    if (g.type === 'MultiPolygon') polys = g.coordinates as number[][][][]
    else if (g.type === 'Polygon') polys = [g.coordinates as number[][][]]
    else continue
    const rings: Ring[] = polys.map((p) => p[0] as Ring)
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity
    for (const ring of rings)
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng
        if (lat < minLat) minLat = lat
        if (lng > maxLng) maxLng = lng
        if (lat > maxLat) maxLat = lat
      }
    out.push({
      nom: String(f.properties.nom_iris ?? ''),
      bbox: [minLng, minLat, maxLng, maxLat],
      rings,
    })
  }
  return out
}

function pointInRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1]
    const xj = ring[j][0],
      yj = ring[j][1]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function findIris(iris: IrisFeat[], lng: number, lat: number): IrisFeat | null {
  for (const f of iris) {
    const [a, b, c, d] = f.bbox
    if (lng < a || lng > c || lat < b || lat > d) continue
    if (f.rings.some((r) => pointInRing(lng, lat, r))) return f
  }
  return null
}

/** Plus grand anneau du feature → polygone [lat,lng] pour Leaflet. */
function irisPolygonLatLng(f: IrisFeat): [number, number][] {
  const biggest = f.rings.reduce((a, b) => (a.length >= b.length ? a : b))
  return biggest.map(([lng, lat]) => [lat, lng] as [number, number])
}

// ─── Transports ─────────────────────────────────────────────────────────────

interface Station {
  name: string
  lat: number
  lng: number
  lines: string[]
}

function loadStations(): Station[] {
  const url = new URL('../../../packages/core/src/data/transportStations.json', import.meta.url)
  const raw = JSON.parse(readFileSync(url, 'utf-8')) as Array<{
    label: string
    lines: string[]
    coordinates: { lat: number; lng: number }
  }>
  return raw
    .filter((s) => s.coordinates?.lat && Array.isArray(s.lines))
    .map((s) => ({ name: s.label, lat: s.coordinates.lat, lng: s.coordinates.lng, lines: s.lines }))
}

function fmtLine(l: string): string {
  if (/^[A-E]$/.test(l)) return `RER ${l}`
  if (/^\d{1,2}$/.test(l)) return `M${l}`
  return l
}

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function nearbyStations(stations: Station[], lat: number, lng: number) {
  const ranked = stations
    .map((s) => ({ s, d: haversine(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => a.d - b.d)
  const within = ranked.filter((r) => r.d <= METRO_RADIUS_M).slice(0, MAX_STATIONS)
  const chosen = within.length > 0 ? within : ranked.slice(0, 1) // toujours au moins 1
  return chosen // [{ s, d }] — la distance sert au temps de marche
}

// ─── Pool ─────────────────────────────────────────────────────────────────

async function mapPool<T>(items: T[], fn: (x: T, i: number) => Promise<void>, n: number) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const cur = i++
        await fn(items[cur], cur)
      }
    }),
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant')

  console.log('→ chargement IRIS + stations…')
  const iris = loadIris()
  const stations = loadStations()
  console.log(`  ${iris.length} IRIS, ${stations.length} stations`)

  // Idempotence via mapLat (Float) : fiable sur NULL SQL, mis à chaque update
  // (filtrer un champ Json sur null est ambigu côté Prisma). --force ignore ce
  // filtre et re-traite tout.
  const biens = await prisma.property.findMany({
    where: FORCE ? { address: { not: null } } : { mapLat: null, address: { not: null } },
    select: { id: true, address: true, arrondissement: true },
    ...(LIMIT ? { take: LIMIT } : {}),
  })
  console.log(
    `→ ${biens.length} biens à enrichir${FORCE ? ' (--force : tout)' : ''}${LIMIT ? ` (limite ${LIMIT})` : ''}\n`,
  )

  let geocoded = 0,
    irisFound = 0,
    failed = 0,
    n = 0

  await mapPool(
    biens,
    async (b) => {
      const geo =
        (await geocodeBest(b.address as string).catch(() => null)) ??
        (await geocodeBest(b.arrondissement).catch(() => null))
      if (!geo) {
        failed++
        return
      }
      geocoded++
      const feat = findIris(iris, geo.lng, geo.lat)
      const stns = nearbyStations(stations, geo.lat, geo.lng)

      const data: Record<string, unknown> = {
        mapLat: geo.lat,
        mapLng: geo.lng,
        mapTransports: stns.map(({ s, d }) => ({
          name: s.name,
          line: fmtLine(s.lines[0]),
          lat: s.lat,
          lng: s.lng,
          walkMin: walkMinutes(d),
        })),
        transports: stns.map(({ s }) => `${s.lines.map(fmtLine).join('/')} ${s.name}`),
      }
      if (feat) {
        irisFound++
        data.irisZone = feat.nom
        data.irisPolygon = irisPolygonLatLng(feat)
      }
      await prisma.property.update({ where: { id: b.id }, data })

      n++
      if (n % 100 === 0) console.log(`  … ${n}/${biens.length}`)
    },
    CONCURRENCY,
  )

  console.log(
    `\n✓ ${geocoded} géocodés · ${irisFound} avec IRIS · ${failed} échecs géocodage (sur ${biens.length})`,
  )
}

main()
  .catch((e) => {
    console.error('[backfill-geo] fatal:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
