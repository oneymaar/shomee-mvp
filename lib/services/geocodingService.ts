export interface GeocodingResult {
  label: string
  lat: number
  lng: number
  score: number
  type: 'municipality' | 'street' | 'housenumber' | 'locality' | 'poi' | 'arrondissement' | 'unknown'
  city?: string
  postcode?: string
}

// Paris arrondissement centroids — avoids mis-geocoding "Paris 11" → Paris city center
const PARIS_ARR_COORDS: Record<number, { lat: number; lng: number; label: string }> = {
  1:  { lat: 48.8607, lng: 2.3476, label: 'Paris 1er arrondissement' },
  2:  { lat: 48.8672, lng: 2.3479, label: 'Paris 2e arrondissement' },
  3:  { lat: 48.8638, lng: 2.3620, label: 'Paris 3e arrondissement' },
  4:  { lat: 48.8540, lng: 2.3548, label: 'Paris 4e arrondissement' },
  5:  { lat: 48.8462, lng: 2.3512, label: 'Paris 5e arrondissement' },
  6:  { lat: 48.8489, lng: 2.3330, label: 'Paris 6e arrondissement' },
  7:  { lat: 48.8566, lng: 2.3145, label: 'Paris 7e arrondissement' },
  8:  { lat: 48.8747, lng: 2.3098, label: 'Paris 8e arrondissement' },
  9:  { lat: 48.8762, lng: 2.3371, label: 'Paris 9e arrondissement' },
  10: { lat: 48.8760, lng: 2.3597, label: 'Paris 10e arrondissement' },
  11: { lat: 48.8595, lng: 2.3798, label: 'Paris 11e arrondissement' },
  12: { lat: 48.8419, lng: 2.3929, label: 'Paris 12e arrondissement' },
  13: { lat: 48.8280, lng: 2.3612, label: 'Paris 13e arrondissement' },
  14: { lat: 48.8327, lng: 2.3262, label: 'Paris 14e arrondissement' },
  15: { lat: 48.8411, lng: 2.2903, label: 'Paris 15e arrondissement' },
  16: { lat: 48.8634, lng: 2.2727, label: 'Paris 16e arrondissement' },
  17: { lat: 48.8879, lng: 2.3137, label: 'Paris 17e arrondissement' },
  18: { lat: 48.8928, lng: 2.3436, label: 'Paris 18e arrondissement' },
  19: { lat: 48.8827, lng: 2.3808, label: 'Paris 19e arrondissement' },
  20: { lat: 48.8628, lng: 2.3980, label: 'Paris 20e arrondissement' },
}

const ROMAN_TO_NUM: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
}

function detectParisArrondissement(query: string): GeocodingResult | null {
  const q = query.toLowerCase().trim()

  // "Paris 11", "Paris 11e", "Paris 11ème"
  const numMatch = q.match(/^(?:paris\s+)?(\d{1,2})(?:e|ème|eme|er)?(?:\s+(?:arr(?:ondissement)?|ardt))?$/)
  if (numMatch) {
    const n = parseInt(numMatch[1])
    if (n >= 1 && n <= 20 && PARIS_ARR_COORDS[n]) {
      const c = PARIS_ARR_COORDS[n]
      return { label: c.label, lat: c.lat, lng: c.lng, score: 1, type: 'arrondissement' }
    }
  }

  // "Paris XI", "Paris XIe"
  const romanMatch = q.match(/^paris\s+(x{0,3}(?:ix|iv|v?i{0,3}))(?:e|ème)?$/)
  if (romanMatch) {
    const n = ROMAN_TO_NUM[romanMatch[1].toLowerCase()]
    if (n && PARIS_ARR_COORDS[n]) {
      const c = PARIS_ARR_COORDS[n]
      return { label: c.label, lat: c.lat, lng: c.lng, score: 1, type: 'arrondissement' }
    }
  }

  return null
}

interface AdresseFeature {
  properties: { label: string; score: number; type: string; city?: string; postcode?: string }
  geometry: { coordinates: [number, number] }
}

async function geocodeFrench(query: string): Promise<GeocodingResult[]> {
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return []
  const data = await res.json()
  return (data.features as AdresseFeature[]).map((f) => ({
    label: f.properties.label,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    score: f.properties.score,
    type: mapType(f.properties.type),
    city: f.properties.city,
    postcode: f.properties.postcode,
  }))
}

function mapType(t: string): GeocodingResult['type'] {
  const map: Record<string, GeocodingResult['type']> = {
    municipality: 'municipality', street: 'street', housenumber: 'housenumber', locality: 'locality',
  }
  return map[t] ?? 'unknown'
}

interface NominatimResult {
  display_name: string; lat: string; lon: string; importance: number
}

async function geocodeNominatim(query: string): Promise<GeocodingResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=fr&accept-language=fr`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SHOMEE-MVP/1.0 (contact@shomee.fr)' },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return []
  const data: NominatimResult[] = await res.json()
  return data.map((r) => ({
    label: r.display_name.split(',').slice(0, 2).join(', '),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    score: r.importance,
    type: 'poi' as const,
  }))
}

export async function geocodeBest(query: string): Promise<GeocodingResult | null> {
  const cleaned = query.trim()
  if (!cleaned) return null

  // Fast path: Paris arrondissement detection (no network call needed)
  const parisArr = detectParisArrondissement(cleaned)
  if (parisArr) return parisArr

  const [french, nominatim] = await Promise.allSettled([
    geocodeFrench(cleaned),
    geocodeNominatim(cleaned),
  ])

  const frenchResults = french.status === 'fulfilled' ? french.value : []
  const nominatimResults = nominatim.status === 'fulfilled' ? nominatim.value : []

  const merged = [...frenchResults]
  for (const n of nominatimResults) {
    const dup = merged.some((r) => Math.abs(r.lat - n.lat) < 0.01 && Math.abs(r.lng - n.lng) < 0.01)
    if (!dup) merged.push(n)
  }

  return merged[0] ?? null
}
