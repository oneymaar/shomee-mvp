/**
 * Fetches and caches GeoJSON administrative boundaries for France.
 * - Paris arrondissements: geo.api.gouv.fr (official, no key required)
 * - Paris quartiers: opendata.paris.fr (80 administrative quarters)
 *
 * Both APIs are free, French government-maintained, and CORS-enabled.
 * Real polygons — no circles. Architecture ready for IRIS data ingestion.
 */

export interface GeoZone {
  id: string           // internal ID used for selection state
  name: string         // "Paris 11e arrondissement"
  shortName: string    // "11e"
  type: 'arrondissement' | 'quartier'
  parentId: string | null  // null for arrondissement; arrondissement id for quartier
  feature: GeoJSON.Feature
}

interface GeoCache {
  arrondissements: GeoZone[] | null
  quartiers: GeoZone[] | null
}

const cache: GeoCache = { arrondissements: null, quartiers: null }

// geo.api.gouv.fr — Paris arrondissements (75056 = Paris commune code)
const ARRONDISSEMENTS_URL =
  'https://geo.api.gouv.fr/communes/75056/arrondissements?fields=nom,code,contour&format=geojson&geometry=contour'

// opendata.paris.fr — 80 administrative quartiers
const QUARTIERS_URL =
  'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/quartier_paris/exports/geojson?lang=fr'

function arrCodeToId(code: string): string {
  // "75111" → "arr-11"
  const num = parseInt(code.slice(3))
  return `arr-${num}`
}

function arrShortName(nom: string, code: string): string {
  // Extract number from "Paris 11e Arrondissement"
  const match = nom.match(/(\d+)/)
  if (match) {
    const n = parseInt(match[1])
    return n === 1 ? '1er' : `${n}e`
  }
  return code.slice(3)
}

function quartierArrId(cAr: number): string {
  return `arr-${cAr}`
}

export async function fetchParisArrondissements(): Promise<GeoZone[]> {
  if (cache.arrondissements) return cache.arrondissements

  const res = await fetch(ARRONDISSEMENTS_URL, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`arrondissements fetch failed: ${res.status}`)
  const geojson: GeoJSON.FeatureCollection = await res.json()

  const zones: GeoZone[] = geojson.features
    .filter((f) => f.properties?.code)
    .map((f) => {
      const code: string = f.properties!.code
      const nom: string = f.properties!.nom ?? `Paris ${code.slice(3)}`
      const id = arrCodeToId(code)
      return {
        id,
        name: nom,
        shortName: arrShortName(nom, code),
        type: 'arrondissement' as const,
        parentId: null,
        feature: { ...f, properties: { ...f.properties, _zoneId: id } },
      }
    })
    .sort((a, b) => {
      const nA = parseInt(a.id.replace('arr-', ''))
      const nB = parseInt(b.id.replace('arr-', ''))
      return nA - nB
    })

  cache.arrondissements = zones
  return zones
}

export async function fetchParisQuartiers(): Promise<GeoZone[]> {
  if (cache.quartiers) return cache.quartiers

  const res = await fetch(QUARTIERS_URL, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`quartiers fetch failed: ${res.status}`)
  const geojson: GeoJSON.FeatureCollection = await res.json()

  const zones: GeoZone[] = geojson.features
    .filter((f) => f.properties?.c_ar != null)
    .map((f) => {
      const cAr: number = f.properties!.c_ar
      const cQu: number = f.properties!.c_qu ?? 0
      const name: string = f.properties!.l_qu ?? f.properties!.l_quinsee ?? `Quartier ${cQu}`
      const id = `qu-${cQu}`
      const parentId = quartierArrId(cAr)
      return {
        id,
        name,
        shortName: name,
        type: 'quartier' as const,
        parentId,
        feature: { ...f, properties: { ...f.properties, _zoneId: id, _parentId: parentId } },
      }
    })
    .sort((a, b) => {
      const nA = parseInt(a.id.replace('qu-', ''))
      const nB = parseInt(b.id.replace('qu-', ''))
      return nA - nB
    })

  cache.quartiers = zones
  return zones
}

/** Fetch both layers; resolves even if quartiers fail (arrondissements are enough for MVP) */
export async function fetchParisGeoData(): Promise<{ arrondissements: GeoZone[]; quartiers: GeoZone[] }> {
  const [arrResult, quResult] = await Promise.allSettled([
    fetchParisArrondissements(),
    fetchParisQuartiers(),
  ])

  const arrondissements = arrResult.status === 'fulfilled' ? arrResult.value : []
  const quartiers = quResult.status === 'fulfilled' ? quResult.value : []
  return { arrondissements, quartiers }
}

/** Find arrondissement zones that match detected intent terms (e.g. "Paris 11e") */
export function matchArrondissements(terms: string[], arrondissements: GeoZone[]): GeoZone[] {
  const matched: GeoZone[] = []
  for (const term of terms) {
    const lower = term.toLowerCase()
    // "paris 11", "paris 11e", "11e"
    const numMatch = lower.match(/(?:paris\s+)?(\d{1,2})(?:e|ème|eme|er)?/)
    if (numMatch) {
      const n = parseInt(numMatch[1])
      const zone = arrondissements.find((z) => z.id === `arr-${n}`)
      if (zone) matched.push(zone)
    }
  }
  return matched
}

/** All quartiers belonging to an arrondissement */
export function getChildQuartiers(arrId: string, quartiers: GeoZone[]): GeoZone[] {
  return quartiers.filter((q) => q.parentId === arrId)
}
