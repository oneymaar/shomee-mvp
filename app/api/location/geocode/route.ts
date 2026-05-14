import { NextRequest, NextResponse } from 'next/server'

// Île-de-France bounding box
const IDF = { minLat: 48.1, maxLat: 49.2, minLng: 1.4, maxLng: 3.7 }

const POI_RADII: Record<string, number> = {
  park: 700, garden: 600, landmark: 600, monument: 500,
  street: 400, avenue: 500, boulevard: 600,
  market: 400, mairie: 450, school: 400, hospital: 700, museum: 500,
}

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
  geojson?: GeoJSON.Geometry
  boundingbox?: string[]
}

/**
 * Server-side geocoding with full geometry from Nominatim (polygon_geojson=1).
 * Running server-side allows proper User-Agent header, and returns geometry.
 *
 * Key design: fetch limit=5 results and UNION their bounding boxes.
 * Streets in OSM are often split into multiple ways (one per arrondissement).
 * With limit=1, only one segment is returned → bbox covers only part of the street.
 * Unioning all results' bboxes covers the complete spatial extent of the street.
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
        const params = new URLSearchParams({
          q: label,
          format: 'json',
          limit: '5',              // fetch multiple segments of split streets
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

        // Keep only results within IDF
        const inIdf = data.filter(r => {
          const lat = parseFloat(r.lat), lng = parseFloat(r.lon)
          return isFinite(lat) && isFinite(lng)
            && lat >= IDF.minLat && lat <= IDF.maxLat
            && lng >= IDF.minLng && lng <= IDF.maxLng
        })
        if (!inIdf.length) return { label, found: false }

        // Primary lat/lng from the first (highest-ranked) result
        const first = inIdf[0]
        const lat = parseFloat(first.lat)
        const lng = parseFloat(first.lon)

        // Union bounding boxes of ALL in-IDF results.
        // This is the key fix: "Rue des Martyrs" has two OSM ways (9e and 18e),
        // each returned as a separate result. Unioning both bboxes covers the
        // complete street from bottom of 9e to top of 18e.
        const bboxes = inIdf
          .map(r => r.boundingbox?.map(Number))
          .filter((bb): bb is number[] => Array.isArray(bb) && bb.length === 4)

        const unionBbox: [number, number, number, number] | null = bboxes.length
          ? [
            Math.min(...bboxes.map(b => b[0])),  // minLat
            Math.max(...bboxes.map(b => b[1])),  // maxLat
            Math.min(...bboxes.map(b => b[2])),  // minLng
            Math.max(...bboxes.map(b => b[3])),  // maxLng
          ]
          : null

        // Best geometry: prefer LineString/MultiLineString over Point
        const bestGeometry =
          inIdf.find(r => r.geojson && r.geojson.type !== 'Point')?.geojson
          ?? first.geojson
          ?? null

        return {
          label,
          found: true,
          lat,
          lng,
          geometry: bestGeometry,
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
