/**
 * GeoDataService — fetches real administrative polygons for Paris.
 *
 * Sources (all CORS-enabled, no API key required):
 *   Arrondissements: opendata.paris.fr — 20 polygons, c_ar (1-20), l_ar
 *   Quartiers:       opendata.paris.fr — 80 polygons, c_qu, c_ar (parent), l_qu
 *
 * Architecture is ready to add IRIS/INSEE zones by extending GeoZone
 * with a 'secteur' type and adding another fetch function.
 */

export interface GeoZone {
  id: string           // e.g. "arr-11" or "qu-43"
  name: string         // "Paris 11e arrondissement"
  shortName: string    // "11e"
  type: 'arrondissement' | 'quartier'
  parentId: string | null
  feature: GeoJSON.Feature
}

// Client-side in-memory cache (per page lifecycle)
const cache: { arrondissements: GeoZone[] | null; quartiers: GeoZone[] | null } = {
  arrondissements: null,
  quartiers: null,
}

const ARRONDISSEMENTS_URL =
  'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arrondissements/exports/geojson?lang=fr'

const QUARTIERS_URL =
  'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/quartier_paris/exports/geojson?lang=fr'

// ─── Parsers ───────────────────────────────────────────────────────────────

function parseArrondissement(f: GeoJSON.Feature): GeoZone | null {
  const p = f.properties ?? {}
  // opendata.paris.fr: c_ar (int 1-20), l_ar ("PARIS 11E ARRONDISSEMENT")
  const num: number = p.c_ar
  if (!num || num < 1 || num > 20) return null

  const id = `arr-${num}`
  const shortName = num === 1 ? '1er' : `${num}e`
  const rawName: string = p.l_ar ?? p.l_aroff ?? ''
  const name = rawName
    ? rawName.charAt(0) + rawName.slice(1).toLowerCase().replace(' arrondissement', ' arrondissement')
    : `Paris ${shortName} arrondissement`

  return {
    id,
    name,
    shortName,
    type: 'arrondissement',
    parentId: null,
    feature: { ...f, properties: { ...p, _zoneId: id } },
  }
}

function parseQuartier(f: GeoJSON.Feature): GeoZone | null {
  const p = f.properties ?? {}
  // opendata.paris.fr: c_qu (1-80), c_ar (1-20 parent), l_qu (name)
  const cQu: number = p.c_qu
  const cAr: number = p.c_ar
  if (!cQu || !cAr || cAr < 1 || cAr > 20) return null

  const rawName: string = p.l_qu ?? p.l_quinsee ?? `Quartier ${cQu}`
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase()
  const id = `qu-${cQu}`
  const parentId = `arr-${cAr}`

  return {
    id,
    name,
    shortName: name.split(' ').slice(0, 3).join(' '),
    type: 'quartier',
    parentId,
    feature: { ...f, properties: { ...p, _zoneId: id, _parentId: parentId } },
  }
}

// ─── Fetch ─────────────────────────────────────────────────────────────────

async function fetchGeoJSON(url: string): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  const data: GeoJSON.FeatureCollection = await res.json()
  if (data?.type !== 'FeatureCollection') throw new Error('Not a FeatureCollection')
  return data
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function fetchParisArrondissements(): Promise<GeoZone[]> {
  if (cache.arrondissements) return cache.arrondissements

  const geojson = await fetchGeoJSON(ARRONDISSEMENTS_URL)
  const zones = (geojson.features as GeoJSON.Feature[])
    .map(parseArrondissement)
    .filter((z): z is GeoZone => z !== null)
    .sort((a, b) => parseInt(a.id.replace('arr-', '')) - parseInt(b.id.replace('arr-', '')))

  if (!zones.length) throw new Error('No arrondissements parsed')
  cache.arrondissements = zones
  return zones
}

export async function fetchParisQuartiers(): Promise<GeoZone[]> {
  if (cache.quartiers) return cache.quartiers
  try {
    const geojson = await fetchGeoJSON(QUARTIERS_URL)
    const zones = (geojson.features as GeoJSON.Feature[])
      .map(parseQuartier)
      .filter((z): z is GeoZone => z !== null)
      .sort((a, b) => parseInt(a.id.replace('qu-', '')) - parseInt(b.id.replace('qu-', '')))
    cache.quartiers = zones
    return zones
  } catch {
    cache.quartiers = []
    return []
  }
}

export async function fetchParisGeoData(): Promise<{ arrondissements: GeoZone[]; quartiers: GeoZone[] }> {
  const [arrResult, quResult] = await Promise.allSettled([
    fetchParisArrondissements(),
    fetchParisQuartiers(),
  ])
  return {
    arrondissements: arrResult.status === 'fulfilled' ? arrResult.value : [],
    quartiers: quResult.status === 'fulfilled' ? quResult.value : [],
  }
}

// ─── Zone helpers ──────────────────────────────────────────────────────────

export function matchArrondissements(terms: string[], arrondissements: GeoZone[]): GeoZone[] {
  const matched: GeoZone[] = []
  for (const term of terms) {
    const lower = term.toLowerCase()
    const numMatch = lower.match(/(?:paris\s+)?(\d{1,2})(?:e|ème|eme|er)?/)
    if (numMatch) {
      const n = parseInt(numMatch[1])
      const zone = arrondissements.find((z) => z.id === `arr-${n}`)
      if (zone && !matched.includes(zone)) matched.push(zone)
    }
  }
  return matched
}

export function getChildQuartiers(arrId: string, quartiers: GeoZone[]): GeoZone[] {
  return quartiers.filter((q) => q.parentId === arrId)
}
