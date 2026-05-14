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

/**
 * Server-side geocoding with full geometry from Nominatim (polygon_geojson=1).
 * Running server-side allows proper User-Agent header required by Nominatim policy,
 * and returns LineString/Polygon geometry for accurate IRIS intersection.
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
          limit: '1',
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
            signal: AbortSignal.timeout(6000),
          }
        )

        if (!res.ok) return { label, found: false }
        const data = await res.json()
        if (!Array.isArray(data) || !data.length) return { label, found: false }

        const r = data[0]
        const lat = parseFloat(r.lat)
        const lng = parseFloat(r.lon)

        if (
          !isFinite(lat) || !isFinite(lng) ||
          lat < IDF.minLat || lat > IDF.maxLat ||
          lng < IDF.minLng || lng > IDF.maxLng
        ) {
          return { label, found: false }
        }

        // Parse bounding box — always present in Nominatim response
        // boundingbox: [minLat, maxLat, minLng, maxLng] (as strings)
        const bb = Array.isArray(r.boundingbox) && r.boundingbox.length === 4
          ? r.boundingbox.map(Number) as [number, number, number, number]
          : null

        return {
          label,
          found: true,
          lat,
          lng,
          geometry: r.geojson ?? null,
          bbox: bb,
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
