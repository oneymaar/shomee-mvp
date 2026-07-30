'use client'

/**
 * Repères de quartier autour d'un bien — commerces, écoles, parcs, santé,
 * monuments — interrogés à la volée sur OpenStreetMap via Overpass.
 *
 * Jumeau web de `apps/mobile/src/lib/useNearbyPois.ts` : même rayon, mêmes
 * catégories, mêmes plafonds, même mémoïsation. Les deux cartes (app et web)
 * doivent montrer exactement les mêmes points, sinon la fiche du teaser web
 * ne ressemble plus à celle de l'app.
 *
 * Tout est best-effort : si Overpass est lent, saturé ou injoignable, la carte
 * s'affiche sans repères. Aucun état d'erreur n'est montré à l'acquéreur.
 *
 * La palette et les libellés vivent ICI et non dans `components/MapZone.tsx` :
 * la carte est chargée en `dynamic(..., { ssr: false })` pour tenir Leaflet
 * hors du rendu serveur, la fiche ne peut donc pas lui emprunter ses
 * constantes sans réintroduire Leaflet dans le bundle serveur.
 *
 * Piste d'évolution : basculer la requête derrière `/api/geo/pois` pour
 * bénéficier du cache edge Vercel (et servir aussi l'app native).
 */

import { useEffect, useState } from 'react'

export type PoiCat = 'shop' | 'school' | 'park' | 'health' | 'monument'

export interface Poi {
  name: string
  lat: number
  lng: number
  cat: PoiCat
}

/** Palette des repères — identique au natif (MapZone.tsx). */
export const POI_COLORS: Record<PoiCat, string> = {
  shop: '#F97316',
  school: '#6366F1',
  park: '#16A34A',
  health: '#DC2626',
  monument: '#A855F7',
}

export const POI_LABELS: Record<PoiCat, string> = {
  shop: 'Commerces',
  school: 'Écoles',
  park: 'Parcs',
  health: 'Santé',
  monument: 'Monuments',
}

const RADIUS_M = 700
const TIMEOUT_MS = 9000

// Plafond par catégorie (les plus proches d'abord) : au-delà, la carte devient
// un semis illisible.
const CAPS: Record<PoiCat, number> = {
  shop: 45,
  school: 12,
  park: 10,
  health: 12,
  monument: 12,
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const cache = new Map<string, Poi[]>()
const inflight = new Map<string, Promise<Poi[]>>()

function key(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

function buildQuery(lat: number, lng: number): string {
  const a = `(around:${RADIUS_M},${lat},${lng})`
  return [
    '[out:json][timeout:20];(',
    `nwr[shop]${a};`,
    `nwr[amenity~"^(marketplace|school|kindergarten|college|university|hospital|clinic|doctors|pharmacy)$"]${a};`,
    `nwr[leisure~"^(park|garden)$"]${a};`,
    `nwr[historic~"^(monument|memorial|castle)$"]${a};`,
    `nwr[tourism~"^(attraction|museum)$"]${a};`,
    ');out center 400;',
  ].join('')
}

type OverpassEl = {
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

const SCHOOL = new Set(['school', 'kindergarten', 'college', 'university'])
const HEALTH = new Set(['hospital', 'clinic', 'doctors', 'pharmacy'])

function classify(tags: Record<string, string>): PoiCat | null {
  if (tags.shop) return 'shop'
  if (tags.amenity === 'marketplace') return 'shop'
  if (tags.amenity && SCHOOL.has(tags.amenity)) return 'school'
  if (tags.amenity && HEALTH.has(tags.amenity)) return 'health'
  if (tags.leisure === 'park' || tags.leisure === 'garden') return 'park'
  if (tags.historic || tags.tourism) return 'monument'
  return null
}

/** Distance approchée en mètres — suffisante pour trier à moins d'1 km. */
function dist(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dy = (aLat - bLat) * 111_320
  const dx = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180)
  return Math.sqrt(dx * dx + dy * dy)
}

function parse(json: unknown, lat: number, lng: number): Poi[] {
  const els = (json as { elements?: OverpassEl[] })?.elements
  if (!Array.isArray(els)) return []
  const rows: Array<Poi & { d: number }> = []
  const seen = new Set<string>()
  for (const el of els) {
    const tags = el.tags
    if (!tags) continue
    const name = tags.name
    if (!name) continue // un point sans nom n'apprend rien à l'acquéreur
    const cat = classify(tags)
    if (!cat) continue
    const la = el.lat ?? el.center?.lat
    const ln = el.lon ?? el.center?.lon
    if (typeof la !== 'number' || typeof ln !== 'number') continue
    // Une enseigne cartographiée en nœud ET en polygone remonte deux fois.
    const dedupe = `${cat}|${name}|${la.toFixed(4)}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    rows.push({ name, lat: la, lng: ln, cat, d: dist(lat, lng, la, ln) })
  }
  rows.sort((a, b) => a.d - b.d)
  const kept: Poi[] = []
  const count: Record<string, number> = {}
  for (const r of rows) {
    const n = (count[r.cat] ?? 0) + 1
    if (n > CAPS[r.cat]) continue
    count[r.cat] = n
    kept.push({ name: r.name, lat: r.lat, lng: r.lng, cat: r.cat })
  }
  return kept
}

/** `null` = tous les miroirs ont échoué (à distinguer d'un quartier vide). */
async function load(lat: number, lng: number): Promise<Poi[] | null> {
  const body = buildQuery(lat, lng)
  for (const url of ENDPOINTS) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(body)}`,
        signal: ctrl.signal,
      })
      if (!res.ok) continue
      const json = await res.json()
      return parse(json, lat, lng)
    } catch {
      // miroir suivant
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/**
 * Repères autour du point. Retourne [] tant que la réponse n'est pas là — la
 * carte se dessine sans attendre et les repères s'ajoutent quand ils arrivent.
 */
export function useNearbyPois(lat?: number | null, lng?: number | null): Poi[] {
  const k = lat != null && lng != null ? key(lat, lng) : null
  const [pois, setPois] = useState<Poi[]>(() => (k ? (cache.get(k) ?? []) : []))

  useEffect(() => {
    if (k == null || lat == null || lng == null) return
    const hit = cache.get(k)
    let alive = true

    // Toujours repartir de la bonne liste : sans ce reset, la carte du bien
    // suivant hériterait des repères du précédent le temps d'un rendu. Le
    // reset passe par une microtâche — interdit de poser un setState dans le
    // corps synchrone d'un effet (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (alive) setPois(hit ?? [])
    })
    if (hit) {
      return () => {
        alive = false
      }
    }

    let p = inflight.get(k)
    if (!p) {
      p = load(lat, lng).then((r) => {
        // Un échec réseau n'est PAS mis en cache : Overpass renvoie souvent un
        // 429, et le bien resterait sans repères pour toute la session.
        if (r != null) cache.set(k, r)
        inflight.delete(k)
        return r ?? []
      })
      inflight.set(k, p)
    }
    p.then((r) => {
      if (alive) setPois(r)
    }).catch(() => {})

    return () => {
      alive = false
    }
  }, [k, lat, lng])

  return pois
}
