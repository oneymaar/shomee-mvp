export interface GeocodingResult {
  label: string
  lat: number
  lng: number
  score: number
  type: 'municipality' | 'street' | 'housenumber' | 'locality' | 'poi' | 'unknown'
  city?: string
  postcode?: string
  context?: string
}

interface AdresseFeature {
  properties: {
    label: string
    score: number
    type: string
    city?: string
    postcode?: string
    context?: string
  }
  geometry: { coordinates: [number, number] }
}

interface NominatimResult {
  display_name: string
  lat: string
  lon: string
  type: string
  importance: number
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
    type: mapAdresseType(f.properties.type),
    city: f.properties.city,
    postcode: f.properties.postcode,
    context: f.properties.context,
  }))
}

function mapAdresseType(t: string): GeocodingResult['type'] {
  if (t === 'municipality') return 'municipality'
  if (t === 'street') return 'street'
  if (t === 'housenumber') return 'housenumber'
  if (t === 'locality') return 'locality'
  return 'unknown'
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

export async function geocode(query: string): Promise<GeocodingResult[]> {
  const cleaned = query.trim()
  if (!cleaned) return []

  const [french, nominatim] = await Promise.allSettled([
    geocodeFrench(cleaned),
    geocodeNominatim(cleaned),
  ])

  const frenchResults = french.status === 'fulfilled' ? french.value : []
  const nominatimResults = nominatim.status === 'fulfilled' ? nominatim.value : []

  // Prefer french API results (more accurate for France), deduplicate by proximity
  const merged = [...frenchResults]
  for (const n of nominatimResults) {
    const isDuplicate = merged.some(
      (r) => Math.abs(r.lat - n.lat) < 0.01 && Math.abs(r.lng - n.lng) < 0.01
    )
    if (!isDuplicate) merged.push(n)
  }

  return merged.slice(0, 5)
}

export async function geocodeBest(query: string): Promise<GeocodingResult | null> {
  const results = await geocode(query)
  return results[0] ?? null
}
