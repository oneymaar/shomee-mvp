/**
 * GeoDataService — administrative polygon data for Paris + Île-de-France suburbs.
 *
 * Level 1 (Paris):    Arrondissements (20)       — opendata.paris.fr
 * Level 1 (suburbs):  Communes (92/93/94)        — geo.api.gouv.fr
 * Level 2:            Quartiers admin (80)        — opendata.paris.fr
 * Level 3:            IRIS zones (~992)           — public.opendatasoft.com
 */

export interface GeoZone {
  id: string
  name: string
  shortName: string
  type: 'arrondissement' | 'quartier' | 'iris' | 'commune'
  parentId: string | null
  feature: GeoJSON.Feature
}

const cache: {
  arrondissements: GeoZone[] | null
  quartiers: GeoZone[] | null
  iris: GeoZone[] | null
  communes: GeoZone[] | null
} = { arrondissements: null, quartiers: null, iris: null, communes: null }

const ARRONDISSEMENTS_URL =
  'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arrondissements/exports/geojson?lang=fr'
const QUARTIERS_URL =
  'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/quartier_paris/exports/geojson?lang=fr'
const IRIS_URL_DEPT = (dept: string) =>
  `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-france-iris/exports/geojson?where=dep_code%3D%22${dept}%22&limit=2000&lang=fr`
const COMMUNES_DEPT_URL = (dept: string) =>
  `https://geo.api.gouv.fr/communes?codeDepartement=${dept}&format=geojson&geometry=contour`

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

export function polygonContainsPoint(geom: GeoJSON.Geometry, lng: number, lat: number): boolean {
  if (geom.type === 'Polygon') return pointInRing(lng, lat, geom.coordinates[0] as number[][])
  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates as number[][][][]).some((c) => pointInRing(lng, lat, c[0]))
  }
  return false
}

export function polygonCentroid(geom: GeoJSON.Geometry): [number, number] {
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

function parseIris(f: GeoJSON.Feature, quartiers: GeoZone[], communes: GeoZone[]): GeoZone | null {
  const p = f.properties ?? {}
  const irisCode = val(p.iris_code)
  if (!irisCode || irisCode.length < 9) return null

  const depCode = irisCode.slice(0, 2)
  const irisName = val(p.iris_name) || `Secteur ${irisCode.slice(-4)}`
  const id = `iris-${irisCode}`

  if (depCode === '75') {
    // Paris: IRIS code "75AAANNNN" → AAA = arr code (101-120) → slice(3,5) = "01"…"20"
    const arrNum = parseInt(irisCode.slice(3, 5))
    if (isNaN(arrNum) || arrNum < 1 || arrNum > 20) return null

    const geom = f.geometry
    const [cLng, cLat] = polygonCentroid(geom)
    let parentId: string | null = null

    const arrQuartiers = quartiers.filter((q) => q.parentId === `arr-${arrNum}`)
    for (const q of arrQuartiers) {
      if (polygonContainsPoint(q.feature.geometry, cLng, cLat)) {
        parentId = q.id
        break
      }
    }
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

  // Suburban commune (92/93/94): IRIS code "CCCCCNNNN" → first 5 digits = INSEE commune code
  const communeCode = irisCode.slice(0, 5)
  const commune = communes.find((c) => c.id === `com-${communeCode}`)
  if (!commune) return null

  return {
    id,
    name: irisName.charAt(0).toUpperCase() + irisName.slice(1).toLowerCase(),
    shortName: irisName.split(' ').slice(0, 2).join(' '),
    type: 'iris',
    parentId: commune.id,
    feature: { ...f, properties: { ...p, _zoneId: id, _parentId: commune.id } },
  }
}

function parseCommune(f: GeoJSON.Feature): GeoZone | null {
  const p = f.properties ?? {}
  const code = String(p.code ?? p.insee ?? '')
  const name = String(p.nom ?? '')
  if (!code || !name) return null
  const id = `com-${code}`
  // Short name: up to 2 hyphen-separated parts, max 16 chars
  const shortName = name.length > 16 ? name.split('-').slice(0, 2).join('-') : name
  return {
    id, name, shortName,
    type: 'commune',
    parentId: null,
    feature: { ...f, properties: { ...p, _zoneId: id } },
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

/**
 * Lazy-loaded — call only when user reaches zoom ≥ 15.
 * Needs quartiers for Paris parent mapping, communes for suburban parent mapping.
 * Fetches Paris (75) + departments 92/93/94 in parallel.
 */
export async function fetchParisIris(quartiers: GeoZone[], communes: GeoZone[] = []): Promise<GeoZone[]> {
  if (cache.iris) return cache.iris
  const depts = ['75', '92', '93', '94']
  const results = await Promise.allSettled(
    depts.map((d) => fetchGeoJSON(IRIS_URL_DEPT(d), 20000))
  )
  const zones: GeoZone[] = []
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const f of r.value.features as GeoJSON.Feature[]) {
      const z = parseIris(f, quartiers, communes)
      if (z) zones.push(z)
    }
  }
  zones.sort((a, b) => a.id.localeCompare(b.id))
  cache.iris = zones
  return zones
}

/** Communes from departments 92/93/94 (Hauts-de-Seine, Seine-Saint-Denis, Val-de-Marne) */
export async function fetchSuburbanCommunes(): Promise<GeoZone[]> {
  if (cache.communes) return cache.communes
  const depts = ['92', '93', '94']
  const results = await Promise.allSettled(
    depts.map((d) => fetchGeoJSON(COMMUNES_DEPT_URL(d), 15000))
  )
  const zones: GeoZone[] = []
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const f of r.value.features as GeoJSON.Feature[]) {
      const z = parseCommune(f)
      if (z) zones.push(z)
    }
  }
  zones.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  cache.communes = zones
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

export function matchCommunes(terms: string[], communes: GeoZone[]): GeoZone[] {
  const matched: GeoZone[] = []
  for (const term of terms) {
    const lower = term.toLowerCase().trim()
    const candidates = communes.filter((c) => {
      const n = c.name.toLowerCase()
      return n === lower || n.startsWith(lower + '-') || lower.startsWith(n)
    })
    if (!candidates.length) continue
    // Prefer exact match; among prefix matches prefer dept 92 (Hauts-de-Seine)
    // so "Neuilly" → Neuilly-sur-Seine (92) not Neuilly-Plaisance (93)
    const exact = candidates.find((c) => c.name.toLowerCase() === lower)
    const dept92 = exact ? null : candidates.find((c) => c.id.startsWith('com-92'))
    const best = exact ?? dept92 ?? candidates[0]
    if (!matched.includes(best)) matched.push(best)
  }
  return matched
}

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

// ─── Quartier administratif name matching ──────────────────────────────────

/** Normalize a geographic name: strip accents, merge apostrophes/hyphens to space */
function normalizeGeoName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Match a raw user query against quartier administratif names.
 * Covers exact match and substring containment (min 5 chars to avoid noise).
 *
 * Usage: call after fetchParisGeoData() so quartiers are loaded.
 * Works for queries like "Saint-Thomas d'Aquin", "Gros-Caillou", "Épinettes".
 */
export function matchQuartiersByName(query: string, quartiers: GeoZone[]): GeoZone[] {
  const q = normalizeGeoName(query)
  if (q.length < 4) return []
  return quartiers.filter(z => {
    const n = normalizeGeoName(z.name)
    // Exact match, or query contains the full quartier name, or quartier name contains the query
    return n === q
      || (n.length >= 5 && q.includes(n))
      || (q.length >= 5 && n.includes(q))
  })
}
