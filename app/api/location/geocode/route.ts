import { NextRequest, NextResponse } from 'next/server'

// Île-de-France bounding box
const IDF = { minLat: 48.1, maxLat: 49.2, minLng: 1.4, maxLng: 3.7 }

// Overpass bbox: south,west,north,east — Paris + inner suburbs (92/93/94)
// Tighter than IDF so Overpass completes the name search in < 3s.
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
 * Fetch ALL highway ways with the given name from Overpass API.
 *
 * Nominatim returns results ranked by relevance — for long streets split into
 * many OSM ways, this means only the most "prominent" segments near major
 * intersections are returned, leaving out the middle and far sections.
 * Overpass enumerates every way with the exact name, regardless of ranking,
 * giving complete spatial coverage of the entire street.
 *
 * Returns GeoJSON LineStrings (one per OSM way), or [] on failure.
 */
async function fetchStreetWaysOverpass(streetName: string): Promise<GeoJSON.LineString[]> {
  // Escape regex metacharacters in the street name
  const escaped = streetName.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')
  // Case-insensitive exact match on the OSM `name` tag, any highway type.
  // GET request: simpler encoding, User-Agent required by overpass-api.de.
  const query = `[out:json][timeout:20];way["name"~"^${escaped}$","i"]["highway"](${SEARCH_OVERPASS_BBOX});out geom;`

  try {
    const res = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': 'SHOMEE-MVP/1.0 (contact@shomee.fr)' },
        signal: AbortSignal.timeout(15000),
      }
    )
    if (!res.ok) return []
    const data: { elements?: OverpassElement[] } = await res.json()

    return (data.elements ?? [])
      .filter(e => e.type === 'way' && Array.isArray(e.geometry) && (e.geometry?.length ?? 0) >= 2)
      .map(e => ({
        type: 'LineString' as const,
        coordinates: e.geometry!.map(p => [p.lon, p.lat] as [number, number]),
      }))
  } catch {
    return []
  }
}

/**
 * Server-side geocoding with full geometry.
 *
 * For streets: Nominatim (for lat/lng reference) runs in parallel with Overpass
 * (for complete geometry). Overpass returns ALL OSM ways with the queried name,
 * ensuring the full spatial extent of the street is covered. Falls back to
 * Nominatim geometry if Overpass is unavailable.
 *
 * For other POIs: keeps highest-ranked in-IDF Nominatim result.
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
          limit: isStreet ? '5' : '1',
          countrycodes: 'fr',
          bounded: '1',
          viewbox: `${IDF.minLng},${IDF.maxLat},${IDF.maxLng},${IDF.minLat}`,
          polygon_geojson: '1',
          'accept-language': 'fr',
        })

        // For streets: start Overpass in parallel with Nominatim so both run concurrently.
        // Overpass gives complete geometry; Nominatim gives the lat/lng reference point.
        const overpassPromise = isStreet ? fetchStreetWaysOverpass(label) : Promise.resolve([])

        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?${params}`,
          {
            headers: { 'User-Agent': 'SHOMEE-MVP/1.0 (contact@shomee.fr)' },
            signal: AbortSignal.timeout(8000),
          }
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

        let finalResults = inIdf

        if (isStreet) {
          // For streets (Nominatim fallback): keep only highway-class ways with matching name
          const highways = inIdf.filter(
            r => r.class === 'highway' || (r.osm_type === 'way' && r.type && HIGHWAY_TYPES.has(r.type))
          )
          const queryNorm = normalizeStreetName(label)
          const nameMatched = highways.filter(r => {
            const osmName = (r.display_name ?? '').split(',')[0].trim()
            return normalizeStreetName(osmName) === queryNorm
          })
          finalResults = nameMatched.length ? nameMatched : (highways.length ? highways : inIdf.slice(0, 1))
        } else {
          finalResults = inIdf.slice(0, 1)
        }

        // Primary lat/lng from first (highest-ranked) Nominatim result
        const first = finalResults[0]
        const lat = parseFloat(first.lat)
        const lng = parseFloat(first.lon)

        // Union bounding boxes of all Nominatim results (fallback bbox)
        const bboxes = finalResults
          .map(r => r.boundingbox?.map(Number))
          .filter((bb): bb is number[] => Array.isArray(bb) && bb.length === 4)

        let unionBbox: [number, number, number, number] | null = bboxes.length
          ? [
            Math.min(...bboxes.map(b => b[0])),  // minLat (south)
            Math.max(...bboxes.map(b => b[1])),  // maxLat (north)
            Math.min(...bboxes.map(b => b[2])),  // minLng (west)
            Math.max(...bboxes.map(b => b[3])),  // maxLng (east)
          ]
          : null

        // Nominatim geometry (fallback if Overpass is unavailable)
        const lineGeoms = finalResults
          .map(r => r.geojson)
          .filter((g): g is GeoJSON.LineString | GeoJSON.MultiLineString =>
            g != null && (g.type === 'LineString' || g.type === 'MultiLineString')
          )

        let geometry: GeoJSON.Geometry | null = null
        if (lineGeoms.length === 1) {
          geometry = lineGeoms[0]
        } else if (lineGeoms.length > 1) {
          const allCoords: GeoJSON.Position[][] = []
          for (const g of lineGeoms) {
            if (g.type === 'LineString') allCoords.push(g.coordinates)
            else allCoords.push(...g.coordinates)
          }
          geometry = { type: 'MultiLineString', coordinates: allCoords }
        } else {
          geometry = finalResults.find(r => r.geojson)?.geojson ?? null
        }

        // Override with Overpass geometry if available (complete coverage of all street segments)
        if (isStreet) {
          const overpassWays = await overpassPromise
          if (overpassWays.length > 0) {
            const allCoords = overpassWays.map(w => w.coordinates)
            geometry = allCoords.length === 1
              ? { type: 'LineString', coordinates: allCoords[0] }
              : { type: 'MultiLineString', coordinates: allCoords }

            // Recompute bbox from the complete Overpass geometry
            const allPoints = allCoords.flat()
            const lats = allPoints.map(p => p[1])
            const lngs = allPoints.map(p => p[0])
            unionBbox = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
          }
        }

        return {
          label,
          found: true,
          lat,
          lng,
          geometry,
          bbox: unionBbox,
          radius: POI_RADII[poiType ?? ''] ?? 500,
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
