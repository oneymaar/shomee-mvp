import { NextRequest, NextResponse } from 'next/server'

// Île-de-France bounding box
const IDF = { minLat: 48.1, maxLat: 49.2, minLng: 1.4, maxLng: 3.7 }

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
 * Server-side geocoding with full geometry from Nominatim (polygon_geojson=1).
 *
 * For streets: appends ", Paris" to the query, fetches limit=10 results,
 * keeps only highway-class ways whose OSM name matches the queried label,
 * then combines their LineStrings into a MultiLineString.
 * This handles streets split across arrondissements (e.g. "Rue des Martyrs"
 * has separate OSM ways in the 9e and 18e) while filtering out adjacent roads
 * that Nominatim may return (e.g. connecting streets at roundabouts/junctions).
 *
 * For other POIs: keeps highest-ranked in-IDF result.
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
          limit: isStreet ? '10' : '1',  // more results for streets (split ways)
          countrycodes: 'fr',
          bounded: '1',
          viewbox: `${IDF.minLng},${IDF.maxLat},${IDF.maxLng},${IDF.minLat}`,
          polygon_geojson: '1',
          'accept-language': 'fr',
        })

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
          // For streets: keep only highway-class ways (the actual road segments)
          const highways = inIdf.filter(
            r => r.class === 'highway' || (r.osm_type === 'way' && r.type && HIGHWAY_TYPES.has(r.type))
          )

          // Filter by name match: Nominatim may return adjacent roads ranked higher than
          // the actual queried street (e.g. connecting roads at junctions, roundabouts).
          // extract the first comma-separated component of display_name = OSM street name.
          const queryNorm = normalizeStreetName(label)
          const nameMatched = highways.filter(r => {
            const osmName = (r.display_name ?? '').split(',')[0].trim()
            return normalizeStreetName(osmName) === queryNorm
          })

          // Fall back to all highways if nothing matches (atypical names, OSM variants, etc.)
          finalResults = nameMatched.length ? nameMatched : (highways.length ? highways : inIdf.slice(0, 1))
        } else {
          finalResults = inIdf.slice(0, 1)
        }

        // Primary lat/lng from first (highest-ranked) result
        const first = finalResults[0]
        const lat = parseFloat(first.lat)
        const lng = parseFloat(first.lon)

        // Union bounding boxes of all selected results
        const bboxes = finalResults
          .map(r => r.boundingbox?.map(Number))
          .filter((bb): bb is number[] => Array.isArray(bb) && bb.length === 4)

        const unionBbox: [number, number, number, number] | null = bboxes.length
          ? [
            Math.min(...bboxes.map(b => b[0])),  // minLat (south)
            Math.max(...bboxes.map(b => b[1])),  // maxLat (north)
            Math.min(...bboxes.map(b => b[2])),  // minLng (west)
            Math.max(...bboxes.map(b => b[3])),  // maxLng (east)
          ]
          : null

        // Combine LineString geometries into MultiLineString for split streets
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
          // No LineString: try any geometry, then null
          geometry = finalResults.find(r => r.geojson)?.geojson ?? null
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
