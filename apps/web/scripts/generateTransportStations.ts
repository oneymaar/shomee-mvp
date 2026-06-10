#!/usr/bin/env npx tsx
/**
 * Generates src/data/transportStations.json
 *
 * Sources:
 *   LOCAL  — METRO_STATIONS (lib/services/metroStationsDb.ts) — metro + RER
 *   LOCAL  — Tramway stops hardcoded (T3a, T3b in Paris; T2 La Défense axis)
 *   REMOTE — IDFM open data (emplacement-des-gares-idf) for validation / extras
 *            Called ONCE (not per station).
 *
 * Coverage: Paris intramuros + petite couronne (92 / 93 / 94)
 *
 * Usage: npx tsx scripts/generateTransportStations.ts
 * Output: src/data/transportStations.json
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { METRO_STATIONS } from '../lib/services/metroStationsDb'

// ─── Types ─────────────────────────────────────────────────────────────────

type StationType = 'metro_station' | 'rer_station' | 'tram_station' | 'transilien_station'

interface TransportStation {
  id: string
  label: string
  aliases: string[]
  type: StationType
  network: string
  lines: string[]
  city: string
  arrondissement: string
  coordinates: { lat: number; lng: number }
  defaultRadiusMeters: number
}

// ─── Constants ─────────────────────────────────────────────────────────────

const METRO_LINE_IDS = new Set([
  '1','2','3','3bis','4','5','6','7','7bis','8','9','10','11','12','13','14',
])
const RER_LINE_IDS = new Set(['A','B','C','D','E'])
const TRAM_LINE_IDS = new Set([
  'T1','T2','T3','T3A','T3B','T4','T5','T6','T7','T8','T9','T10','T11','T12','T13',
])

// Paris bounding box (generous)
const PARIS_BB = { latMin: 48.815, latMax: 48.908, lngMin: 2.221, lngMax: 2.473 }

// Arrondissement approximate centroids (for nearest-centroid lookup)
const ARR_CENTROIDS: Record<number, [number, number]> = {
  1:  [48.8607, 2.3476],  2:  [48.8672, 2.3479],  3:  [48.8638, 2.3620],
  4:  [48.8540, 2.3548],  5:  [48.8462, 2.3512],  6:  [48.8489, 2.3330],
  7:  [48.8566, 2.3145],  8:  [48.8747, 2.3098],  9:  [48.8762, 2.3371],
  10: [48.8760, 2.3597], 11:  [48.8595, 2.3798], 12:  [48.8419, 2.3929],
  13: [48.8280, 2.3612], 14:  [48.8327, 2.3262], 15:  [48.8411, 2.2903],
  16: [48.8634, 2.2727], 17:  [48.8879, 2.3137], 18:  [48.8928, 2.3436],
  19: [48.8827, 2.3808], 20:  [48.8628, 2.3980],
}

// Known suburban city overrides by station name (petite couronne)
const SUBURB_CITIES: Record<string, string> = {
  // 92 — Hauts-de-Seine
  'La Défense Grande Arche':        'Puteaux',
  'Esplanade de La Défense':        'Courbevoie',
  'Pont de Neuilly':                'Neuilly-sur-Seine',
  'Les Sablons':                    'Neuilly-sur-Seine',
  'Porte Maillot':                  'Paris',
  'Pont de Sèvres':                 'Boulogne-Billancourt',
  'Boulogne-Jean Jaurès':           'Boulogne-Billancourt',
  'Boulogne-Pont de Saint-Cloud':   'Boulogne-Billancourt',
  'Marcel Sembat':                  'Boulogne-Billancourt',
  'Billancourt':                    'Boulogne-Billancourt',
  'Issy-Val-de-Seine':              'Issy-les-Moulineaux',
  'Issy':                           'Issy-les-Moulineaux',
  'Les Moulineaux':                 'Issy-les-Moulineaux',
  'Val de Seine':                   'Issy-les-Moulineaux',
  'Brimborion':                     'Sèvres',
  'Mairie d\'Issy':                 'Issy-les-Moulineaux',
  'Châtillon-Montrouge':            'Châtillon',
  'Montrouge':                      'Montrouge',
  'Malakoff-Plateau de Vanves':     'Malakoff',
  'Malakoff-Rue Étienne Dolet':     'Malakoff',
  'Mairie de Montrouge':            'Montrouge',
  'Asnières-sur-Seine':             'Asnières-sur-Seine',
  'Clichy-Levallois':               'Clichy',
  'Pont de Levallois-Bécon':        'Levallois-Perret',
  'Anatole France':                 'Levallois-Perret',
  'Louise Michel':                  'Levallois-Perret',
  'Pont de Champerret':             'Levallois-Perret',
  'Porte de Champerret':            'Paris',
  'Saint-Cloud':                    'Saint-Cloud',
  'Rueil-Malmaison':                'Rueil-Malmaison',
  'Suresnes-Mont Valérien':         'Suresnes',
  'Puteaux':                        'Puteaux',
  'Courbevoie':                     'Courbevoie',
  'La Garenne-Colombes':            'La Garenne-Colombes',
  'Bois-Colombes':                  'Bois-Colombes',
  'Colombes':                       'Colombes',
  'Nanterre':                       'Nanterre',
  'Nanterre-Préfecture':            'Nanterre',
  'Nanterre-Université':            'Nanterre',
  'Nanterre-Ville':                 'Nanterre',
  'Gennevilliers':                  'Gennevilliers',
  'Les Agnettes':                   'Gennevilliers',
  'Asnières-Gennevilliers':         'Asnières-sur-Seine',
  'Bagneux':                        'Bagneux',
  'Bagneux-Lucie Aubrac':           'Bagneux',
  'Bourg-la-Reine':                 'Bourg-la-Reine',
  'Antony':                         'Antony',
  'Robinson':                       'Châtillon',
  // 93 — Seine-Saint-Denis
  'Saint-Denis':                    'Saint-Denis',
  'Saint-Denis - Université':       'Saint-Denis',
  'Saint-Denis-Université':         'Saint-Denis',
  'Saint-Denis-Porte de Paris':     'Saint-Denis',
  'Basilique de Saint-Denis':       'Saint-Denis',
  'Stade de France - Saint-Denis':  'Saint-Denis',
  'La Plaine - Stade de France':    'Saint-Denis',
  'La Plaine-Stade de France':      'Saint-Denis',
  'Carrefour Pleyel':               'Saint-Denis',
  'Front Populaire':                'Saint-Denis',
  "Porte d'Aubervilliers":          'Aubervilliers',
  'Saint-Ouen':                     'Saint-Ouen',
  'Garibaldi':                      'Saint-Ouen',
  'Mairie de Saint-Ouen':           'Saint-Ouen',
  'Aubervilliers-Pantin-4 Chemins': 'Aubervilliers',
  "Fort d'Aubervilliers":           'Aubervilliers',
  "La Courneuve-8 Mai 1945":        'La Courneuve',
  'Bobigny-Pablo Picasso':          'Bobigny',
  'Bobigny-Pantin-Raymond Queneau': 'Pantin',
  'Gallieni':                       'Bagnolet',
  'Montreuil':                      'Montreuil',
  'Mairie de Montreuil':            'Montreuil',
  'Croix de Chavaux':               'Montreuil',
  'Les Lilas':                      'Les Lilas',
  'Pré-Saint-Gervais':              'Le Pré-Saint-Gervais',
  'Noisy-le-Sec':                   'Noisy-le-Sec',
  'Bondy':                          'Bondy',
  // 94 — Val-de-Marne
  'Château de Vincennes':           'Vincennes',
  'Bérault':                        'Vincennes',
  'Saint-Mandé':                    'Saint-Mandé',
  'Vincennes':                      'Vincennes',
  'Charenton-Écoles':               'Charenton-le-Pont',
  'Liberté':                        'Charenton-le-Pont',
  'Alfortville':                    'Alfortville',
  'Maisons-Alfort-Les Juilliottes': 'Maisons-Alfort',
  'Maisons-Alfort-Stade':           'Maisons-Alfort',
  'Ivry-sur-Seine':                 'Ivry-sur-Seine',
  'Le Kremlin-Bicêtre':             'Le Kremlin-Bicêtre',
  'Kremlin-Bicêtre':                'Le Kremlin-Bicêtre',
  'Villejuif-Louis Aragon':         'Villejuif',
  'Villejuif-Paul Vaillant-Couturier': 'Villejuif',
  'Villejuif-Léo Lagrange':         'Villejuif',
  'Gentilly':                       'Gentilly',
  'Arcueil-Cachan':                 'Arcueil',
  'Laplace':                        'Arcueil',
  'Bagneux':                        'Bagneux',
  'Fontenay-sous-Bois':             'Fontenay-sous-Bois',
  'Joinville-le-Pont':              'Joinville-le-Pont',
  'Saint-Maur-des-Fossés':         'Saint-Maur-des-Fossés',
  'Sucy-Bonneuil':                  'Sucy-en-Brie',
  'Boissy-Saint-Léger':             'Boissy-Saint-Léger',
  'Noisy-le-Grand-Mont d\'Est':     'Noisy-le-Grand',
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isInParis(lat: number, lng: number): boolean {
  return (
    lat >= PARIS_BB.latMin && lat <= PARIS_BB.latMax &&
    lng >= PARIS_BB.lngMin && lng <= PARIS_BB.lngMax
  )
}

function nearestArrondissement(lat: number, lng: number): number {
  let best = 1, bestDist = Infinity
  for (const [n, [cLat, cLng]] of Object.entries(ARR_CENTROIDS)) {
    const d = haversineM(lat, lng, cLat, cLng)
    if (d < bestDist) { bestDist = d; best = parseInt(n) }
  }
  return best
}

function resolveCity(name: string, lat: number, lng: number): string {
  if (SUBURB_CITIES[name]) return SUBURB_CITIES[name]
  if (isInParis(lat, lng)) return 'Paris'
  return ''
}

function resolveArrondissement(city: string, lat: number, lng: number): string {
  if (city !== 'Paris') return ''
  return `Paris ${nearestArrondissement(lat, lng)}`
}

function getType(lines: string[]): StationType {
  const hasMetro = lines.some(l => METRO_LINE_IDS.has(l))
  const hasRER   = lines.some(l => RER_LINE_IDS.has(l.toUpperCase()))
  const hasTram  = lines.some(l => TRAM_LINE_IDS.has(l.toUpperCase()))
  if (hasTram && !hasMetro && !hasRER) return 'tram_station'
  if (hasRER  && !hasMetro)            return 'rer_station'
  return 'metro_station'
}

function getNetwork(lines: string[], type: StationType): string {
  if (type === 'rer_station') return 'RATP/SNCF'
  return 'RATP'
}

function getRadius(type: StationType): number {
  if (type === 'rer_station')        return 500
  if (type === 'tram_station')       return 300
  if (type === 'transilien_station') return 600
  return 350
}

// ─── Tramway stops (T3a, T3b, T2) — not in metroStationsDb ────────────────

// T3a: Pont du Gard (13e) → Porte de Vincennes (12e) along Boulevards
// T3b: Porte de Vincennes (12e) → Porte de la Chapelle (18e)
// T2: La Défense → Porte de Versailles (15e) along Seine right bank / south Paris

const TRAMWAY_STOPS: Array<[string, number, number, ...string[]]> = [
  // ── T3a (Paris, 13e → 12e) ──────────────────────────────────────────────
  ['Pont du Gard',              48.8167, 2.3519, 'T3A'],
  ['Stade Charléty - Porte de Gentilly', 48.8178, 2.3413, 'T3A'],
  ['Cité Universitaire',        48.8202, 2.3360, 'T3A'],
  ['Porte d\'Orléans',          48.8230, 2.3244, 'T3A'],
  ['Alésia - Antoine Chantin',  48.8259, 2.3184, 'T3A'],
  ['Montsouris',                48.8262, 2.3103, 'T3A'],
  ['Porte de Vanves',           48.8271, 2.2997, 'T3A'],
  ['Brancion',                  48.8347, 2.2953, 'T3A'],
  ['Georges Brassens',          48.8394, 2.2886, 'T3A'],
  ['Balard',                    48.8391, 2.2786, 'T3A'],
  ['Desnouettes',               48.8378, 2.2927, 'T3A'],
  ['Porte de la Plaine',        48.8344, 2.2885, 'T3A'],
  ['Porte d\'Issy',             48.8319, 2.2800, 'T3A'],
  ['Aqueduc - Pont d\'Issy',    48.8291, 2.2782, 'T3A'],
  // ── T3b (Paris, 12e → 18e) ──────────────────────────────────────────────
  ['Porte de Vincennes',        48.8479, 2.4131, 'T3B'],
  ['Buzenval',                  48.8484, 2.4055, 'T3B'],
  ['Maraichers',                48.8511, 2.4024, 'T3B'],
  ['Porte de Montreuil',        48.8549, 2.4087, 'T3B'],
  ['Porte de Bagnolet',         48.8607, 2.4079, 'T3B'],
  ['Porte de Lilas',            48.8720, 2.4090, 'T3B'],
  ['Porte des Lilas',           48.8728, 2.4082, 'T3B'],
  ['Pré-Saint-Gervais - Hôpital', 48.8780, 2.4066, 'T3B'],
  ['Ella Fitzgerald',           48.8855, 2.3970, 'T3B'],
  ['Porte de Pantin',           48.8886, 2.3882, 'T3B'],
  ['La Plaine Saint-Denis - Porte de la Villette', 48.8961, 2.3810, 'T3B'],
  ['Porte de la Villette',      48.8974, 2.3784, 'T3B'],
  ['Riquet',                    48.8929, 2.3694, 'T3B'],
  ['Magenta',                   48.8827, 2.3565, 'T3B'],
  ['Rosa Parks',                48.8910, 2.3677, 'T3B'],
  ['Porte d\'Aubervilliers',    48.9104, 2.3737, 'T3B'],
  ['Porte de la Chapelle',      48.8970, 2.3604, 'T3B'],
  // ── T2 (La Défense → Porte de Versailles, ~15e/92) ──────────────────────
  ['Issy-Val-de-Seine',         48.8244, 2.2764, 'T2'],
  ['Issy',                      48.8267, 2.2733, 'T2'],
  ['Meudon-sur-Seine',          48.8219, 2.2596, 'T2'],
  ['Musée de Sèvres',           48.8224, 2.2287, 'T2'],
  ['Brimborion',                48.8264, 2.2154, 'T2'],
  ['Val de Seine',              48.8323, 2.2143, 'T2'],
  ['Les Moulineaux',            48.8378, 2.2178, 'T2'],
  ['Parc de Saint-Cloud',       48.8455, 2.2219, 'T2'],
  ['Surèsnes-Longchamp',        48.8648, 2.2220, 'T2'],
  ['Avenue de Versailles',      48.8568, 2.2534, 'T2'],
  ['La Défense',                48.8921, 2.2380, 'T2'],
]

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  const stations: TransportStation[] = []
  const seenIds = new Set<string>()

  // ── 1. Metro + RER from local DB ─────────────────────────────────────────
  for (const s of METRO_STATIONS) {
    const id = slugify(s.name)
    if (seenIds.has(id)) continue
    seenIds.add(id)

    const city = resolveCity(s.name, s.lat, s.lng)
    const arrondissement = resolveArrondissement(city, s.lat, s.lng)
    const type = getType(s.lines)

    stations.push({
      id,
      label: s.name,
      aliases: [],
      type,
      network: getNetwork(s.lines, type),
      lines: s.lines,
      city,
      arrondissement,
      coordinates: { lat: s.lat, lng: s.lng },
      defaultRadiusMeters: getRadius(type),
    })
  }

  // ── 2. Tramway stops ──────────────────────────────────────────────────────
  for (const [name, lat, lng, ...lines] of TRAMWAY_STOPS) {
    const id = slugify(name)
    if (seenIds.has(id)) {
      // Station already exists (e.g. intermodal) — add tram lines to it
      const existing = stations.find(s => s.id === id)
      if (existing) {
        for (const l of lines) {
          if (!existing.lines.includes(l)) existing.lines.push(l)
        }
      }
      continue
    }
    seenIds.add(id)

    const city = isInParis(lat, lng) ? 'Paris' : (SUBURB_CITIES[name] ?? '')
    const arrondissement = resolveArrondissement(city, lat, lng)

    stations.push({
      id,
      label: name,
      aliases: [],
      type: 'tram_station',
      network: 'RATP',
      lines,
      city,
      arrondissement,
      coordinates: { lat, lng },
      defaultRadiusMeters: 300,
    })
  }

  // Sort: Paris first, then by label
  stations.sort((a, b) => {
    if (a.city === 'Paris' && b.city !== 'Paris') return -1
    if (b.city === 'Paris' && a.city !== 'Paris') return 1
    return a.label.localeCompare(b.label, 'fr')
  })

  const outPath = resolve(process.cwd(), 'src/data/transportStations.json')
  writeFileSync(outPath, JSON.stringify(stations, null, 2), 'utf-8')

  const byType = stations.reduce<Record<string, number>>((acc, s) => {
    acc[s.type] = (acc[s.type] ?? 0) + 1
    return acc
  }, {})
  const parisCount = stations.filter(s => s.city === 'Paris').length
  const suburbanCount = stations.filter(s => s.city && s.city !== 'Paris').length

  console.log(`\n=== Transport Stations ===\n`)
  console.log(`Total: ${stations.length}`)
  console.log(`  Paris intramuros : ${parisCount}`)
  console.log(`  Petite couronne  : ${suburbanCount}`)
  console.log(`  Inconnu          : ${stations.length - parisCount - suburbanCount}`)
  console.log()
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type.padEnd(24)}: ${count}`)
  }
  console.log(`\nOutput: ${outPath}`)
}

main()
