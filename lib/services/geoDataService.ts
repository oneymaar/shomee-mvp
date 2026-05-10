/**
 * GeoDataService — real administrative polygon data for Paris.
 *
 * Level 1: Arrondissements (20)  — opendata.paris.fr
 * Level 2: Quartiers admin (80)  — opendata.paris.fr
 * Level 3: IRIS zones (~992)     — public.opendatasoft.com (called "secteurs" in UI)
 *
 * IRIS → quartier mapping uses point-in-polygon (centroid of IRIS vs quartier polygons).
 * Architecture is ready for IGN/INSEE IRIS shapefile ingestion by replacing the fetch URL.
 */

export interface GeoZone {
  id: string
  name: string
  shortName: string
  type: 'arrondissement' | 'quartier' | 'iris'
  parentId: string | null   // arr-X for quartier; qu-X for iris
  feature: GeoJSON.Feature
}

const cache: {
  arrondissements: GeoZone[] | null
  quartiers: GeoZone[] | null
  iris: GeoZone[] | null
} = { arrondissements: null, quartiers: null, iris: null }

const ARRONDISSEMENTS_URL =
  'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arrondissements/exports/geojson?lang=fr'
const QUARTIERS_URL =
  'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/quartier_paris/exports/geojson?lang=fr'
// opendatasoft — Paris IRIS zones (all of dep 75, ~992 features, CORS open)
const IRIS_URL =
  'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-france-iris/exports/geojson?where=dep_code%3D%2275%22&limit=2000&lang=fr'

// ─── Point-in-polygon ──────────────────────────────────────────────────────

function pointInRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function polygonContainsPoint(geom: GeoJSON.Geometry, lng: number, lat: number): boolean {
  if (geom.type === 'Polygon') return pointInRing(lng, lat, geom.coordinates[0] as number[][])
  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates as number[][][][]).some((c) => pointInRing(lng, lat, c[0]))
  }
  return false
}

function polygonCentroid(geom: GeoJSON.Geometry): [number, number] {
  let ring: number[][]
  if (geom.type === 'Polygon') ring = geom.coordinates[0] as number[][]
  else if (geom.type === 'MultiPolygon') {
    const coords = geom.coordinates as number[][][][]
    ring = coords.reduce((a, b) => (a[0].length >= b[0].length ? a : b))[0]
  } else return [2.3522, 48.8566]

  const n = ring.length
  return [
    ring.reduce((s, c) => s + c[0], 0) / n,
    ring.reduce((s, c) => s + c[1], 0) / n,
  ]
}

// ─── Parsers ───────────────────────────────────────────────────────────────

function parseArrondissement(f: GeoJSON.Feature): GeoZone | null {
  const p = f.properties ?? {}
  const num: number = p.c_ar
  if (!num || num < 1 || num > 20) return null
  const id = `arr-${num}`
  const shortName = num === 1 ? '1er' : `${num}e`
  const raw: string = p.l_ar ?? p.l_aroff ?? ''
  const name = raw ? raw.charAt(0) + raw.slice(1).toLowerCase() : `Paris ${shortName} arrondissement`
  return { id, name, shortName, type: 'arrondissement', parentId: null, feature: { ...f, properties: { ...p, _zoneId: id } } }
}

function parseQuartier(f: GeoJSON.Feature): GeoZone | null {
  const p = f.properties ?? {}
  const cQu: number = p.c_qu
  const cAr: number = p.c_ar
  if (!cQu || !cAr || cAr < 1 || cAr > 20) return null
  const raw: string = p.l_qu ?? p.l_quinsee ?? `Quartier ${cQu}`
  const name = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
  const id = `qu-${cQu}`
  const parentId = `arr-${cAr}`
  return { id, name, shortName: name.split(' ').slice(0, 3).join(' '), type: 'quartier', parentId, feature: { ...f, properties: { ...p, _zoneId: id, _parentId: parentId } } }
}

function val(v: unknown): string {
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')
}

function parseIris(f: GeoJSON.Feature, quartiers: GeoZone[]): GeoZone | null {
  const p = f.properties ?? {}
  const irisCode = val(p.iris_code)
  if (!irisCode || irisCode.length < 9) return null

  // IRIS code format: "75AAANNNN" where AAA = arr code (101-120), NNNN = iris number
  // slice(3,5) gives "01"…"20" = arrondissement number
  const arrNum = parseInt(irisCode.slice(3, 5))
  if (isNaN(arrNum) || arrNum < 1 || arrNum > 20) return null

  const irisName = val(p.iris_name) || `Secteur ${irisCode.slice(-4)}`
  const id = `iris-${irisCode}`

  // Find parent quartier via point-in-polygon
  const geom = f.geometry
  const [cLng, cLat] = polygonCentroid(geom)
  let parentId: string | null = null

  // Search only in quartiers belonging to this arrondissement (faster)
  const arrQuartiers = quartiers.filter((q) => q.parentId === `arr-${arrNum}`)
  for (const q of arrQuartiers) {
    if (polygonContainsPoint(q.feature.geometry, cLng, cLat)) {
      parentId = q.id
      break
    }
  }
  // Fallback to arrondissement if no quartier found
  if (!parentId) parentId = `arr-${arrNum}`

  return {
    id,
    name: irisName.charAt(0).toUpperCase() + irisName.slice(1).toLowerCase(),
    shortName: irisName.split(' ').slice(0, 2).join(' '),
    type: 'iris',
    parentId,
    feature: { ...f, properties: { ...p, _zoneId: id, _parentId: parentId } },
  }
}

// ─── Fetch ─────────────────────────────────────────────────────────────────

async function fetchGeoJSON(url: string, timeoutMs = 12000): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data: GeoJSON.FeatureCollection = await res.json()
  if (data?.type !== 'FeatureCollection') throw new Error('Not a FeatureCollection')
  return data
}

export async function fetchParisArrondissements(): Promise<GeoZone[]> {
  if (cache.arrondissements) return cache.arrondissements
  const geojson = await fetchGeoJSON(ARRONDISSEMENTS_URL)
  const zones = (geojson.features as GeoJSON.Feature[]).map(parseArrondissement).filter((z): z is GeoZone => z !== null)
    .sort((a, b) => parseInt(a.id.replace('arr-', '')) - parseInt(b.id.replace('arr-', '')))
  if (!zones.length) throw new Error('No arrondissements parsed')
  cache.arrondissements = zones
  return zones
}

export async function fetchParisQuartiers(): Promise<GeoZone[]> {
  if (cache.quartiers) return cache.quartiers
  try {
    const geojson = await fetchGeoJSON(QUARTIERS_URL)
    const zones = (geojson.features as GeoJSON.Feature[]).map(parseQuartier).filter((z): z is GeoZone => z !== null)
      .sort((a, b) => parseInt(a.id.replace('qu-', '')) - parseInt(b.id.replace('qu-', '')))
    cache.quartiers = zones
    return zones
  } catch {
    cache.quartiers = []
    return []
  }
}

/** Lazy-loaded — call only when user reaches zoom ≥ 15. Needs quartiers for parent mapping. */
export async function fetchParisIris(quartiers: GeoZone[]): Promise<GeoZone[]> {
  if (cache.iris) return cache.iris
  const geojson = await fetchGeoJSON(IRIS_URL, 20000)
  const zones = (geojson.features as GeoJSON.Feature[])
    .map((f) => parseIris(f, quartiers))
    .filter((z): z is GeoZone => z !== null)
    .sort((a, b) => a.id.localeCompare(b.id))
  cache.iris = zones
  return zones
}

export async function fetchParisGeoData(): Promise<{ arrondissements: GeoZone[]; quartiers: GeoZone[] }> {
  const [arrResult, quResult] = await Promise.allSettled([fetchParisArrondissements(), fetchParisQuartiers()])
  return {
    arrondissements: arrResult.status === 'fulfilled' ? arrResult.value : [],
    quartiers: quResult.status === 'fulfilled' ? quResult.value : [],
  }
}

// ─── Zone helpers ──────────────────────────────────────────────────────────

export function matchArrondissements(terms: string[], arrondissements: GeoZone[]): GeoZone[] {
  const matched: GeoZone[] = []
  for (const term of terms) {
    const m = term.toLowerCase().match(/(?:paris\s+)?(\d{1,2})(?:e|ème|eme|er)?/)
    if (m) {
      const zone = arrondissements.find((z) => z.id === `arr-${parseInt(m[1])}`)
      if (zone && !matched.includes(zone)) matched.push(zone)
    }
  }
  return matched
}

export function getChildZones(parentId: string, zones: GeoZone[]): GeoZone[] {
  return zones.filter((z) => z.parentId === parentId)
}
// Backward-compat aliases
export const getChildQuartiers = (arrId: string, q: GeoZone[]) => getChildZones(arrId, q)
