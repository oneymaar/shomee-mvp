export interface Zone {
  id: string
  label: string       // "Paris 11e arrondissement"
  shortLabel: string  // "11e"
  type: 'arrondissement' | 'commune' | 'quartier'
  lat: number
  lng: number
  radiusM: number     // Visual radius — fallback until real polygons arrive
}

// Paris arrondissements — ready to be replaced by real GeoJSON polygons
const PARIS_ARRONDISSEMENTS: Zone[] = [
  { id: 'paris-1',  label: 'Paris 1er', shortLabel: '1er', type: 'arrondissement', lat: 48.8607, lng: 2.3476, radiusM: 600 },
  { id: 'paris-2',  label: 'Paris 2e',  shortLabel: '2e',  type: 'arrondissement', lat: 48.8672, lng: 2.3479, radiusM: 530 },
  { id: 'paris-3',  label: 'Paris 3e',  shortLabel: '3e',  type: 'arrondissement', lat: 48.8638, lng: 2.3620, radiusM: 570 },
  { id: 'paris-4',  label: 'Paris 4e',  shortLabel: '4e',  type: 'arrondissement', lat: 48.8540, lng: 2.3548, radiusM: 620 },
  { id: 'paris-5',  label: 'Paris 5e',  shortLabel: '5e',  type: 'arrondissement', lat: 48.8462, lng: 2.3512, radiusM: 680 },
  { id: 'paris-6',  label: 'Paris 6e',  shortLabel: '6e',  type: 'arrondissement', lat: 48.8489, lng: 2.3330, radiusM: 660 },
  { id: 'paris-7',  label: 'Paris 7e',  shortLabel: '7e',  type: 'arrondissement', lat: 48.8566, lng: 2.3145, radiusM: 790 },
  { id: 'paris-8',  label: 'Paris 8e',  shortLabel: '8e',  type: 'arrondissement', lat: 48.8747, lng: 2.3098, radiusM: 760 },
  { id: 'paris-9',  label: 'Paris 9e',  shortLabel: '9e',  type: 'arrondissement', lat: 48.8762, lng: 2.3371, radiusM: 640 },
  { id: 'paris-10', label: 'Paris 10e', shortLabel: '10e', type: 'arrondissement', lat: 48.8760, lng: 2.3597, radiusM: 680 },
  { id: 'paris-11', label: 'Paris 11e', shortLabel: '11e', type: 'arrondissement', lat: 48.8595, lng: 2.3798, radiusM: 740 },
  { id: 'paris-12', label: 'Paris 12e', shortLabel: '12e', type: 'arrondissement', lat: 48.8419, lng: 2.3929, radiusM: 890 },
  { id: 'paris-13', label: 'Paris 13e', shortLabel: '13e', type: 'arrondissement', lat: 48.8280, lng: 2.3612, radiusM: 870 },
  { id: 'paris-14', label: 'Paris 14e', shortLabel: '14e', type: 'arrondissement', lat: 48.8327, lng: 2.3262, radiusM: 810 },
  { id: 'paris-15', label: 'Paris 15e', shortLabel: '15e', type: 'arrondissement', lat: 48.8411, lng: 2.2903, radiusM: 980 },
  { id: 'paris-16', label: 'Paris 16e', shortLabel: '16e', type: 'arrondissement', lat: 48.8634, lng: 2.2727, radiusM: 1100 },
  { id: 'paris-17', label: 'Paris 17e', shortLabel: '17e', type: 'arrondissement', lat: 48.8879, lng: 2.3137, radiusM: 880 },
  { id: 'paris-18', label: 'Paris 18e', shortLabel: '18e', type: 'arrondissement', lat: 48.8928, lng: 2.3436, radiusM: 950 },
  { id: 'paris-19', label: 'Paris 19e', shortLabel: '19e', type: 'arrondissement', lat: 48.8827, lng: 2.3808, radiusM: 940 },
  { id: 'paris-20', label: 'Paris 20e', shortLabel: '20e', type: 'arrondissement', lat: 48.8628, lng: 2.3980, radiusM: 880 },
]

// Inner ring communes (Petite Couronne)
const INNER_COMMUNES: Zone[] = [
  { id: 'vincennes',        label: 'Vincennes',           shortLabel: 'Vincennes',       type: 'commune', lat: 48.8476, lng: 2.4391, radiusM: 980 },
  { id: 'saint-mande',      label: 'Saint-Mandé',         shortLabel: 'St-Mandé',        type: 'commune', lat: 48.8434, lng: 2.4178, radiusM: 720 },
  { id: 'charenton',        label: 'Charenton-le-Pont',   shortLabel: 'Charenton',       type: 'commune', lat: 48.8228, lng: 2.4108, radiusM: 760 },
  { id: 'ivry',             label: 'Ivry-sur-Seine',      shortLabel: 'Ivry',            type: 'commune', lat: 48.8127, lng: 2.3847, radiusM: 900 },
  { id: 'gentilly',         label: 'Gentilly',            shortLabel: 'Gentilly',        type: 'commune', lat: 48.8134, lng: 2.3477, radiusM: 620 },
  { id: 'montrouge',        label: 'Montrouge',           shortLabel: 'Montrouge',       type: 'commune', lat: 48.8195, lng: 2.3212, radiusM: 780 },
  { id: 'malakoff',         label: 'Malakoff',            shortLabel: 'Malakoff',        type: 'commune', lat: 48.8187, lng: 2.2976, radiusM: 680 },
  { id: 'vanves',           label: 'Vanves',              shortLabel: 'Vanves',          type: 'commune', lat: 48.8200, lng: 2.2865, radiusM: 650 },
  { id: 'issy',             label: 'Issy-les-Moulineaux', shortLabel: 'Issy',            type: 'commune', lat: 48.8237, lng: 2.2696, radiusM: 880 },
  { id: 'boulogne',         label: 'Boulogne-Billancourt', shortLabel: 'Boulogne',       type: 'commune', lat: 48.8357, lng: 2.2403, radiusM: 1050 },
  { id: 'saint-cloud',      label: 'Saint-Cloud',         shortLabel: 'St-Cloud',        type: 'commune', lat: 48.8434, lng: 2.2150, radiusM: 950 },
  { id: 'neuilly',          label: 'Neuilly-sur-Seine',   shortLabel: 'Neuilly',         type: 'commune', lat: 48.8845, lng: 2.2679, radiusM: 950 },
  { id: 'levallois',        label: 'Levallois-Perret',    shortLabel: 'Levallois',       type: 'commune', lat: 48.8934, lng: 2.2873, radiusM: 770 },
  { id: 'clichy',           label: 'Clichy',              shortLabel: 'Clichy',          type: 'commune', lat: 48.9038, lng: 2.3068, radiusM: 840 },
  { id: 'saint-ouen',       label: 'Saint-Ouen',          shortLabel: 'St-Ouen',         type: 'commune', lat: 48.9115, lng: 2.3335, radiusM: 870 },
  { id: 'aubervilliers',    label: 'Aubervilliers',        shortLabel: 'Aubervilliers',  type: 'commune', lat: 48.9140, lng: 2.3832, radiusM: 960 },
  { id: 'pantin',           label: 'Pantin',              shortLabel: 'Pantin',          type: 'commune', lat: 48.8995, lng: 2.4002, radiusM: 890 },
  { id: 'les-lilas',        label: 'Les Lilas',           shortLabel: 'Les Lilas',       type: 'commune', lat: 48.8783, lng: 2.4176, radiusM: 600 },
  { id: 'bagnolet',         label: 'Bagnolet',            shortLabel: 'Bagnolet',        type: 'commune', lat: 48.8675, lng: 2.4160, radiusM: 720 },
  { id: 'montreuil',        label: 'Montreuil',           shortLabel: 'Montreuil',       type: 'commune', lat: 48.8628, lng: 2.4437, radiusM: 1050 },
  { id: 'fontenay',         label: 'Fontenay-sous-Bois',  shortLabel: 'Fontenay',        type: 'commune', lat: 48.8531, lng: 2.4813, radiusM: 980 },
  { id: 'nogent',           label: 'Nogent-sur-Marne',    shortLabel: 'Nogent',          type: 'commune', lat: 48.8365, lng: 2.4806, radiusM: 950 },
  { id: 'joinville',        label: 'Joinville-le-Pont',   shortLabel: 'Joinville',       type: 'commune', lat: 48.8188, lng: 2.4674, radiusM: 730 },
  { id: 'saint-maur',       label: 'Saint-Maur-des-Fossés', shortLabel: 'St-Maur',      type: 'commune', lat: 48.7994, lng: 2.4965, radiusM: 1300 },
]

// Notable POIs / neighborhoods for name matching
const NAME_INDEX: Record<string, string> = {
  'nation': 'paris-11',
  'bastille': 'paris-11',
  'daumesnil': 'paris-12',
  'bois de vincennes': 'vincennes',
  'bois vincennes': 'vincennes',
  'opéra': 'paris-9',
  'opera': 'paris-9',
  'montmartre': 'paris-18',
  'pigalle': 'paris-18',
  'marais': 'paris-4',
  'le marais': 'paris-4',
  'saint-germain': 'paris-6',
  'saint germain': 'paris-6',
  'quartier latin': 'paris-5',
  'luxembourg': 'paris-6',
  'châtelet': 'paris-1',
  'chatelet': 'paris-1',
  'les halles': 'paris-1',
  'beaubourg': 'paris-4',
  'belleville': 'paris-20',
  'oberkampf': 'paris-11',
  'voltaire': 'paris-11',
  'père lachaise': 'paris-20',
  'pere lachaise': 'paris-20',
  'gambetta': 'paris-20',
  'republique': 'paris-11',
  'république': 'paris-11',
  'popincourt': 'paris-11',
  'aligre': 'paris-12',
  'bercy': 'paris-12',
  'gare de lyon': 'paris-12',
  'bastille 12': 'paris-12',
  'invalides': 'paris-7',
  'tour eiffel': 'paris-7',
  'champ de mars': 'paris-7',
  'trocadero': 'paris-16',
  'trocadéro': 'paris-16',
  'passy': 'paris-16',
  'auteuil': 'paris-16',
  'champs elysees': 'paris-8',
  'champs-élysées': 'paris-8',
  'concorde': 'paris-1',
  'madeleine': 'paris-8',
  'saint-lazare': 'paris-8',
  'batignolles': 'paris-17',
  'clichy batignolles': 'paris-17',
  'montparnasse': 'paris-14',
  'pernety': 'paris-14',
  'alesia': 'paris-14',
  'alésia': 'paris-14',
  'place d italie': 'paris-13',
  "place d'italie": 'paris-13',
  'gobelins': 'paris-13',
  'butte aux cailles': 'paris-13',
  'mouffetard': 'paris-5',
  'jussieu': 'paris-5',
  'odeon': 'paris-6',
  'odéon': 'paris-6',
  'lamarck': 'paris-18',
  'sacre coeur': 'paris-18',
  'sacré-cœur': 'paris-18',
  'barbes': 'paris-18',
  'barbès': 'paris-18',
  'stalingrad': 'paris-19',
  'buttes chaumont': 'paris-19',
  'buttes-chaumont': 'paris-19',
  'la villette': 'paris-19',
  'canal saint martin': 'paris-10',
  'canal st martin': 'paris-10',
  'gare du nord': 'paris-10',
  'gare de lest': 'paris-10',
  'colonel fabien': 'paris-10',
}

const ALL_ZONES = [...PARIS_ARRONDISSEMENTS, ...INNER_COMMUNES]

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Get all zones within radiusKm of a point, sorted by distance */
export function getZonesAroundPoint(lat: number, lng: number, radiusKm = 8): Zone[] {
  return ALL_ZONES
    .map((z) => ({ zone: z, dist: distanceKm(lat, lng, z.lat, z.lng) }))
    .filter(({ dist }) => dist <= radiusKm)
    .sort((a, b) => a.dist - b.dist)
    .map(({ zone }) => zone)
}

/** Find zones matching the detected location terms */
export function findZonesByTerms(terms: string[]): Zone[] {
  const ids = new Set<string>()

  for (const term of terms) {
    const lower = term.toLowerCase().trim()

    // Paris arrondissement by number
    const numMatch = lower.match(/^paris\s+(\d{1,2})(?:e|ème|er|eme)?$/) ??
                     lower.match(/^(\d{1,2})(?:e|ème|er|eme)?\s*(?:arr(?:ondissement)?|ardt)?$/)
    if (numMatch) {
      const n = parseInt(numMatch[1])
      if (n >= 1 && n <= 20) { ids.add(`paris-${n}`); continue }
    }

    // Name index lookup (neighborhoods, POIs)
    if (NAME_INDEX[lower]) { ids.add(NAME_INDEX[lower]); continue }

    // Direct zone id or label match
    for (const z of ALL_ZONES) {
      if (z.label.toLowerCase().includes(lower) || z.shortLabel.toLowerCase() === lower || z.id === lower) {
        ids.add(z.id)
      }
    }
  }

  return ALL_ZONES.filter((z) => ids.has(z.id))
}

export function getZoneById(id: string): Zone | undefined {
  return ALL_ZONES.find((z) => z.id === id)
}

export { ALL_ZONES, PARIS_ARRONDISSEMENTS }
