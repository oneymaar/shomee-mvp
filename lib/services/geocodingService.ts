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

// Known Paris neighborhoods → centroid coordinates
// Prevents api-adresse.data.gouv.fr from fuzzy-matching neighborhood names to streets
const PARIS_NEIGHBORHOODS: Record<string, { lat: number; lng: number; label: string }> = {
  'le marais':        { lat: 48.8555, lng: 2.3534, label: 'Le Marais, Paris' },
  'marais':           { lat: 48.8555, lng: 2.3534, label: 'Le Marais, Paris' },
  'montmartre':       { lat: 48.8867, lng: 2.3431, label: 'Montmartre, Paris 18e' },
  'bastille':         { lat: 48.8533, lng: 2.3692, label: 'Bastille, Paris' },
  'belleville':       { lat: 48.8714, lng: 2.3788, label: 'Belleville, Paris' },
  'pigalle':          { lat: 48.8826, lng: 2.3346, label: 'Pigalle, Paris 18e' },
  'oberkampf':        { lat: 48.8644, lng: 2.3776, label: 'Oberkampf, Paris 11e' },
  'nation':           { lat: 48.8484, lng: 2.3962, label: 'Nation, Paris 12e' },
  'daumesnil':        { lat: 48.8399, lng: 2.3947, label: 'Daumesnil, Paris 12e' },
  'bercy':            { lat: 48.8386, lng: 2.3798, label: 'Bercy, Paris 12e' },
  'saint-germain':    { lat: 48.8540, lng: 2.3325, label: 'Saint-Germain-des-Prés, Paris 6e' },
  'saint germain':    { lat: 48.8540, lng: 2.3325, label: 'Saint-Germain-des-Prés, Paris 6e' },
  'châtelet':         { lat: 48.8585, lng: 2.3476, label: 'Châtelet-Les Halles, Paris' },
  'chatelet':         { lat: 48.8585, lng: 2.3476, label: 'Châtelet-Les Halles, Paris' },
  'châtelet-les halles': { lat: 48.8585, lng: 2.3476, label: 'Châtelet-Les Halles, Paris' },
  'canal saint-martin': { lat: 48.8709, lng: 2.3619, label: 'Canal Saint-Martin, Paris 10e' },
  'canal saint martin': { lat: 48.8709, lng: 2.3619, label: 'Canal Saint-Martin, Paris 10e' },
  'montparnasse':     { lat: 48.8420, lng: 2.3215, label: 'Montparnasse, Paris' },
  'trocadéro':        { lat: 48.8626, lng: 2.2893, label: 'Trocadéro, Paris 16e' },
  'trocadero':        { lat: 48.8626, lng: 2.2893, label: 'Trocadéro, Paris 16e' },
  'invalides':        { lat: 48.8559, lng: 2.3118, label: 'Invalides, Paris 7e' },
  'buttes-chaumont':  { lat: 48.8803, lng: 2.3836, label: 'Buttes-Chaumont, Paris 19e' },
  'buttes chaumont':  { lat: 48.8803, lng: 2.3836, label: 'Buttes-Chaumont, Paris 19e' },
  'la villette':      { lat: 48.8909, lng: 2.3892, label: 'La Villette, Paris 19e' },
  'passy':            { lat: 48.8578, lng: 2.2853, label: 'Passy, Paris 16e' },
  'auteuil':          { lat: 48.8480, lng: 2.2656, label: 'Auteuil, Paris 16e' },
  'batignolles':      { lat: 48.8873, lng: 2.3237, label: 'Batignolles, Paris 17e' },
  'gare du nord':     { lat: 48.8809, lng: 2.3553, label: 'Gare du Nord, Paris 10e' },
  'gare de lyon':     { lat: 48.8449, lng: 2.3735, label: 'Gare de Lyon, Paris 12e' },
  'opéra':            { lat: 48.8718, lng: 2.3311, label: 'Opéra, Paris 9e' },
  'opera':            { lat: 48.8718, lng: 2.3311, label: 'Opéra, Paris 9e' },
  'madeleine':        { lat: 48.8701, lng: 2.3253, label: 'Madeleine, Paris 8e' },
  "place d'italie":   { lat: 48.8309, lng: 2.3555, label: "Place d'Italie, Paris 13e" },
  'place d italie':   { lat: 48.8309, lng: 2.3555, label: "Place d'Italie, Paris 13e" },
  'alésia':           { lat: 48.8281, lng: 2.3247, label: 'Alésia, Paris 14e' },
  'alesia':           { lat: 48.8281, lng: 2.3247, label: 'Alésia, Paris 14e' },
  'père lachaise':    { lat: 48.8607, lng: 2.3945, label: 'Père-Lachaise, Paris 20e' },
  'pere lachaise':    { lat: 48.8607, lng: 2.3945, label: 'Père-Lachaise, Paris 20e' },
  'bois de vincennes':{ lat: 48.8294, lng: 2.4330, label: 'Bois de Vincennes' },
  'bois de boulogne': { lat: 48.8633, lng: 2.2445, label: 'Bois de Boulogne, Paris 16e' },
  'champs-élysées':   { lat: 48.8698, lng: 2.3078, label: 'Champs-Élysées, Paris 8e' },
  'champs elysées':   { lat: 48.8698, lng: 2.3078, label: 'Champs-Élysées, Paris 8e' },
  'champs elysees':   { lat: 48.8698, lng: 2.3078, label: 'Champs-Élysées, Paris 8e' },
  'la défense':       { lat: 48.8919, lng: 2.2381, label: 'La Défense, Puteaux' },
  'la defense':       { lat: 48.8919, lng: 2.2381, label: 'La Défense, Puteaux' },
  'neuilly':          { lat: 48.8845, lng: 2.2693, label: 'Neuilly-sur-Seine' },
  'levallois':        { lat: 48.8970, lng: 2.2894, label: 'Levallois-Perret' },
  'montrouge':        { lat: 48.8188, lng: 2.3196, label: 'Montrouge' },
  'vincennes':        { lat: 48.8479, lng: 2.4383, label: 'Vincennes' },
  'saint-mandé':      { lat: 48.8449, lng: 2.4166, label: 'Saint-Mandé' },
  'saint mande':      { lat: 48.8449, lng: 2.4166, label: 'Saint-Mandé' },
  'charenton':        { lat: 48.8219, lng: 2.4088, label: 'Charenton-le-Pont' },
  'montreuil':        { lat: 48.8629, lng: 2.4397, label: 'Montreuil' },
  'ivry':             { lat: 48.8125, lng: 2.3838, label: 'Ivry-sur-Seine' },
  'pantin':           { lat: 48.8966, lng: 2.4026, label: 'Pantin' },
  'saint-denis':      { lat: 48.9353, lng: 2.3547, label: 'Saint-Denis' },
  'saint denis':      { lat: 48.9353, lng: 2.3547, label: 'Saint-Denis' },
  'clichy':           { lat: 48.9046, lng: 2.3057, label: 'Clichy' },
  'issy':             { lat: 48.8240, lng: 2.2775, label: 'Issy-les-Moulineaux' },
  'issy-les-moulineaux': { lat: 48.8240, lng: 2.2775, label: 'Issy-les-Moulineaux' },
  'boulogne':         { lat: 48.8352, lng: 2.2395, label: 'Boulogne-Billancourt' },
}

const ROMAN_TO_NUM: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
}

function detectParisArrondissement(query: string): GeocodingResult | null {
  const q = query.toLowerCase().trim()

  const numMatch = q.match(/^(?:paris\s+)?(\d{1,2})(?:e|ème|eme|er)?(?:\s+(?:arr(?:ondissement)?|ardt))?$/)
  if (numMatch) {
    const n = parseInt(numMatch[1])
    if (n >= 1 && n <= 20 && PARIS_ARR_COORDS[n]) {
      const c = PARIS_ARR_COORDS[n]
      return { label: c.label, lat: c.lat, lng: c.lng, score: 1, type: 'arrondissement' }
    }
  }

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

// Look up well-known Paris neighborhoods to avoid fuzzy-matching them to street names
function detectParisNeighborhood(query: string): GeocodingResult | null {
  // Normalize: strip city/arrondissement suffixes and parentheses
  const q = query.toLowerCase().trim()
    .replace(/,?\s*paris\b.*/i, '') // strip ", Paris 3e" or " Paris" (with or without comma)
    .replace(/\s*\(.*?\)\s*$/, '')  // strip trailing parentheses e.g. "(Paris 3-4)"
    .trim()

  // Exact match
  let hit = PARIS_NEIGHBORHOODS[q]
  if (hit) return { label: hit.label, lat: hit.lat, lng: hit.lng, score: 1, type: 'locality' }

  // Strip leading French articles/prepositions: "quartier du Marais" → "marais"
  const noPrefix = q.replace(/^(?:quartier\s+(?:du?e?|de\s+la|des?)\s+|le\s+|la\s+|les\s+|l['']|du\s+|des\s+|de\s+la\s+|de\s+)/, '')
  if (noPrefix !== q) {
    hit = PARIS_NEIGHBORHOODS[noPrefix]
    if (hit) return { label: hit.label, lat: hit.lat, lng: hit.lng, score: 1, type: 'locality' }
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

  // Fast path 1: Paris arrondissement → exact coords, no network needed
  const parisArr = detectParisArrondissement(cleaned)
  if (parisArr) return parisArr

  // Fast path 2: Known Paris neighborhood → avoids API fuzzy-matching to wrong streets
  const neighborhood = detectParisNeighborhood(cleaned)
  if (neighborhood) return neighborhood

  const [french, nominatim] = await Promise.allSettled([
    geocodeFrench(cleaned),
    geocodeNominatim(cleaned),
  ])

  const frenchResults = french.status === 'fulfilled' ? french.value : []
  const nominatimResults = nominatim.status === 'fulfilled' ? nominatim.value : []

  // Filter out low-confidence street results from French API
  // (streets with score < 0.7 often come from fuzzy-matching neighborhood names)
  const goodFrench = frenchResults.filter((r) => r.type !== 'street' || r.score >= 0.75)

  const merged = [...goodFrench]
  for (const n of nominatimResults) {
    const dup = merged.some((r) => Math.abs(r.lat - n.lat) < 0.01 && Math.abs(r.lng - n.lng) < 0.01)
    if (!dup) merged.push(n)
  }

  return merged[0] ?? null
}
