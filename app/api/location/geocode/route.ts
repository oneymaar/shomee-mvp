import { NextRequest, NextResponse } from 'next/server'

// Île-de-France bounding box
const IDF = { minLat: 48.1, maxLat: 49.2, minLng: 1.4, maxLng: 3.7 }

// Overpass bbox: south,west,north,east — Paris + inner suburbs (92/93/94)
const SEARCH_OVERPASS_BBOX = '48.77,2.18,48.96,2.55'

const POI_RADII: Record<string, number> = {
  park: 700, garden: 600, landmark: 600, monument: 500,
  street: 400, avenue: 500, boulevard: 600,
  market: 400, mairie: 450, school: 400, hospital: 700, museum: 500,
}

// Nominatim highway subtypes that represent actual roads
const HIGHWAY_TYPES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
  'living_street', 'pedestrian', 'path', 'footway', 'unclassified', 'road', 'street',
])

const STREET_POI_TYPES = new Set(['street', 'avenue', 'boulevard', 'rue', 'quai', 'passage', 'impasse', 'voie', 'route'])

interface GeocodedPlace {
  label: string
  found: boolean
  lat?: number
  lng?: number
  geometry?: GeoJSON.Geometry | null
  bbox?: [number, number, number, number] | null  // [minLat, maxLat, minLng, maxLng]
  radius?: number
  arrondissements?: string[]  // arr-N IDs extracted from Nominatim display_name
}

interface NominatimResult {
  lat: string; lon: string
  class?: string; type?: string; osm_type?: string
  geojson?: GeoJSON.Geometry
  boundingbox?: string[]
  display_name?: string
}

interface OverpassElement {
  type: string
  geometry?: Array<{ lat: number; lon: number }>
  members?: Array<{ type: string; role?: string; geometry?: Array<{ lat: number; lon: number }> }>
}

/**
 * Normalize a street name for fuzzy comparison:
 * lowercase, remove diacritics, collapse non-alphanumeric to spaces.
 */
function normalizeStreetName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Fetch ALL highway ways with the given name from Overpass API (for streets).
 * Returns complete LineString geometries for each OSM way.
 */
async function fetchStreetWaysOverpass(streetName: string): Promise<GeoJSON.LineString[]> {
  const escaped = streetName.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')
  // Prefix match (no trailing $): captures name variants like "Boulevard Périphérique Intérieur"
  // and "Boulevard Périphérique Extérieur" which are how OSM tags many périph sections.
  // Safe for regular streets (unique names — no common prefix variants exist).
  const query = `[out:json][timeout:20];way["name"~"^${escaped}",i]["highway"](${SEARCH_OVERPASS_BBOX});out geom;`
  try {
    const res = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'SHOMEE-MVP/1.0 (contact@shomee.fr)' }, signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) return []
    const data: { elements?: OverpassElement[] } = await res.json()
    return (data.elements ?? [])
      .filter(e => e.type === 'way' && Array.isArray(e.geometry) && (e.geometry?.length ?? 0) >= 2)
      .map(e => ({ type: 'LineString' as const, coordinates: e.geometry!.map(p => [p.lon, p.lat] as [number, number]) }))
  } catch { return [] }
}

/**
 * Fetch ALL ways named exactly like the POI in a small bbox around (lat, lng).
 * Used for non-street POIs: places, parks, squares, landmarks.
 *
 * Unlike streets (which use a fixed IDF bbox), POI ways are queried in a small
 * radius around the Nominatim-geocoded center to avoid false positives from
 * identically-named places elsewhere in IDF.
 *
 * Returns combined LineString geometries representing the POI boundary.
 * Multiple ways are expected for large places (Place de la République has 18 ways,
 * one per road segment of the roundabout).
 */
async function fetchPoiWaysOverpass(
  name: string,
  lat: number,
  lng: number,
): Promise<GeoJSON.LineString[]> {
  const delta = 0.015  // ≈1.5 km — enough for any Paris place/park
  const bbox = `${(lat - delta).toFixed(4)},${(lng - delta).toFixed(4)},${(lat + delta).toFixed(4)},${(lng + delta).toFixed(4)}`
  const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')
  // Query both ways AND relations (parks, large squares like Parc Monceau are OSM relations)
  const query = `[out:json][timeout:10];(way["name"~"^${escaped}$",i](${bbox});relation["name"~"^${escaped}$",i](${bbox}););out geom;`
  try {
    const res = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'SHOMEE-MVP/1.0 (contact@shomee.fr)' }, signal: AbortSignal.timeout(12000) }
    )
    if (!res.ok) return []
    const data: { elements?: OverpassElement[] } = await res.json()
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

/**
 * Server-side geocoding with full geometry.
 *
 * Streets: Nominatim (for lat/lng) + Overpass (complete multi-way geometry).
 * Non-street POIs: Nominatim (for lat/lng) + Overpass in small bbox around result
 *   (returns all ways named like the POI → complete boundary MultiLineString).
 * Falls back to Nominatim geometry in both cases.
 *
 * POST body: { places: [{ label: string, poiType?: string }] }
 * Response:  { results: GeocodedPlace[] }
 */
export async function POST(req: NextRequest) {
  try {
    const { places } = (await req.json()) as { places: Array<{ label: string; poiType?: string }> }
    if (!Array.isArray(places) || places.length === 0) {
      return NextResponse.json({ results: [] })
    }

    const results = await Promise.allSettled(
      places.map(async ({ label, poiType }): Promise<GeocodedPlace> => {
        const isStreet = STREET_POI_TYPES.has(poiType ?? '')

        // For streets, append "Paris" to disambiguate from suburbs
        const q = isStreet && !/\bparis\b/i.test(label) ? `${label}, Paris` : label

        const params = new URLSearchParams({
          q,
          format: 'json',
          limit: '1',  // just for lat/lng reference; Overpass handles complete geometry
          countrycodes: 'fr',
          bounded: '1',
          viewbox: `${IDF.minLng},${IDF.maxLat},${IDF.maxLng},${IDF.minLat}`,
          polygon_geojson: '1',
          'accept-language': 'fr',
        })

        // For streets: start Overpass in parallel with Nominatim
        const overpassStreetPromise = isStreet ? fetchStreetWaysOverpass(label) : Promise.resolve([])

        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?${params}`,
          { headers: { 'User-Agent': 'SHOMEE-MVP/1.0 (contact@shomee.fr)' }, signal: AbortSignal.timeout(8000) }
        )

        if (!res.ok) return { label, found: false }
        const data: NominatimResult[] = await res.json()
        if (!Array.isArray(data) || !data.length) return { label, found: false }

        // Keep only in-IDF results
        const inIdf = data.filter(r => {
          const lat = parseFloat(r.lat), lng = parseFloat(r.lon)
          return isFinite(lat) && isFinite(lng)
            && lat >= IDF.minLat && lat <= IDF.maxLat
            && lng >= IDF.minLng && lng <= IDF.maxLng
        })
        if (!inIdf.length) return { label, found: false }

        // Primary lat/lng from first Nominatim result
        const first = inIdf[0]
        const lat = parseFloat(first.lat)
        const lng = parseFloat(first.lon)

        // Fallback Nominatim geometry (single result, any type)
        const nominatimGeom = first.geojson ?? null

        // Fallback bbox from Nominatim
        const bb = first.boundingbox?.map(Number)
        let unionBbox: [number, number, number, number] | null = (bb && bb.length === 4)
          ? [bb[0], bb[1], bb[2], bb[3]]
          : null

        let geometry: GeoJSON.Geometry | null = nominatimGeom

        if (isStreet) {
          // Streets: Nominatim for streets (name-filtered highways) + Overpass for complete geometry
          const highways = inIdf.filter(
            r => r.class === 'highway' || (r.osm_type === 'way' && r.type && HIGHWAY_TYPES.has(r.type))
          )
          const queryNorm = normalizeStreetName(label)
          const nameMatched = highways.filter(r => {
            const osmName = (r.display_name ?? '').split(',')[0].trim()
            return normalizeStreetName(osmName) === queryNorm
          })
          const streetResults = nameMatched.length ? nameMatched : (highways.length ? highways : inIdf.slice(0, 1))

          // Nominatim bbox union for streets
          const bboxes = streetResults.map(r => r.boundingbox?.map(Number)).filter((bb): bb is number[] => Array.isArray(bb) && bb.length === 4)
          if (bboxes.length) {
            unionBbox = [Math.min(...bboxes.map(b => b[0])), Math.max(...bboxes.map(b => b[1])), Math.min(...bboxes.map(b => b[2])), Math.max(...bboxes.map(b => b[3]))]
          }

          // Nominatim street geometry (LineStrings)
          const lineGeoms = streetResults.map(r => r.geojson).filter((g): g is GeoJSON.LineString | GeoJSON.MultiLineString => g != null && (g.type === 'LineString' || g.type === 'MultiLineString'))
          if (lineGeoms.length === 1) {
            geometry = lineGeoms[0]
          } else if (lineGeoms.length > 1) {
            const allCoords: GeoJSON.Position[][] = []
            for (const g of lineGeoms) {
              if (g.type === 'LineString') allCoords.push(g.coordinates)
              else allCoords.push(...g.coordinates)
            }
            geometry = { type: 'MultiLineString', coordinates: allCoords }
          }

          // Override with Overpass (complete street coverage)
          const overpassWays = await overpassStreetPromise
          if (overpassWays.length > 0) {
            const allCoords = overpassWays.map(w => w.coordinates)
            geometry = allCoords.length === 1
              ? { type: 'LineString', coordinates: allCoords[0] }
              : { type: 'MultiLineString', coordinates: allCoords }
            const allPoints = allCoords.flat()
            const lats = allPoints.map(p => p[1]), lngs = allPoints.map(p => p[0])
            unionBbox = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
          }
        } else {
          // Non-street POIs: use Overpass in a small bbox to get the complete boundary.
          // POIs like Place de la République, Parc Monceau, Place de la Bastille are made
          // of multiple OSM ways (one per side/segment) — Overpass returns all of them,
          // which are combined into a comprehensive MultiLineString for proximity checks.
          //
          // Critical: when the LLM emits a short/colloquial label (e.g. "République"),
          // Nominatim may return railway stop nodes (class=railway, type=stop) whose
          // display_name is "République, Place de la République, …". The actual place
          // name is then the SECOND comma-separated component. Using the raw label for
          // Overpass would return only metro station nodes (no polygon), so we derive
          // the canonical OSM name from Nominatim's display_name instead.
          const displayParts = (first.display_name ?? '').split(',').map(s => s.trim())
          // A node (osm_type=node) is always a point feature (station, bus stop, etc.).
          // For those, the actual place name is the 2nd component of display_name.
          const isTransportNode = first.osm_type === 'node'
          // For transport nodes: use 2nd display_name component (the actual place name).
          // For area/place results: use 1st component (the result's own name).
          const canonicalName = (isTransportNode && displayParts.length > 1)
            ? displayParts[1]
            : (displayParts[0] || label)
          const poiWays = await fetchPoiWaysOverpass(canonicalName, lat, lng)
          if (poiWays.length > 0) {
            const allCoords = poiWays.map(w => w.coordinates)
            geometry = allCoords.length === 1
              ? { type: 'LineString', coordinates: allCoords[0] }
              : { type: 'MultiLineString', coordinates: allCoords }
            const allPoints = allCoords.flat()
            const lats = allPoints.map(p => p[1]), lngs = allPoints.map(p => p[0])
            unionBbox = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
          }
          // else: falls back to nominatimGeom set above
        }

        // Extract arrondissement IDs from Nominatim display_name (streets only).
        const arrondissements = isStreet
          ? [...new Set(
              inIdf.map(r => {
                const m = (r.display_name ?? '').match(/Paris\s+(\d+)e?r?\s+Arrondissement/i)
                return m ? `arr-${parseInt(m[1])}` : null
              }).filter((id): id is string => id !== null)
            )]
          : undefined

        return {
          label, found: true, lat, lng,
          geometry,
          bbox: unionBbox,
          radius: POI_RADII[poiType ?? ''] ?? 500,
          arrondissements: arrondissements?.length ? arrondissements : undefined,
        }
      })
    )

    return NextResponse.json({
      results: results.map((r, i): GeocodedPlace =>
        r.status === 'fulfilled' ? r.value : { label: places[i].label, found: false }
      ),
    })
  } catch (e) {
    console.error('geocode error', e)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
