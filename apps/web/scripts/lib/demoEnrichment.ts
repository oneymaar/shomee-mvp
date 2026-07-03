/**
 * demoEnrichment — générateurs PURS de données de DÉMO (fausses mais plausibles)
 * pour peupler les champs enrichis vides des biens existants.
 *
 * ⚠️ DONNÉE DE DÉMO ASSUMÉE. Aucune source externe (pas d'IRIS/DVF/Intent
 * Analytics). But : montrer la forme d'une fiche pleine. Le vrai chemin marché
 * reste réservé aux vrais biens (flag isDemoData = false).
 *
 * Aucune dépendance DB / Prisma ici — fonctions pures, seedées par une chaîne
 * (l'id du bien) pour être DÉTERMINISTES : même bien → même sortie à chaque run.
 *
 * Table d'ancrage prix AUTONOME (copie assumée des ordres de grandeur €/m²) —
 * volontairement découplée de COMMUNE_FALLBACK du moteur de matching (core).
 */

/* ── PRNG déterministe ──────────────────────────────────────────────────────── */

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rng(seed: string): () => number {
  return mulberry32(hashString(seed))
}

/** Tire `n` éléments distincts d'un tableau (ordre stable seedé). */
function pickN<T>(arr: readonly T[], n: number, rnd: () => number): T[] {
  const pool = [...arr]
  const out: T[] = []
  const k = Math.min(n, pool.length)
  for (let i = 0; i < k; i++) {
    const idx = Math.floor(rnd() * pool.length)
    out.push(pool.splice(idx, 1)[0])
  }
  return out
}

function pick<T>(arr: readonly T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)]
}

/** Arrondit à la centaine la plus proche. */
function round100(n: number): number {
  return Math.round(n / 100) * 100
}

/* ── Ancrages prix €/m² (démo, ordres de grandeur) ─────────────────────────── */

const PARIS_ANCHOR: Record<number, number> = {
  1: 13500, 2: 12500, 3: 13800, 4: 14500, 5: 13500, 6: 15800, 7: 15500,
  8: 13800, 9: 11500, 10: 10000, 11: 10200, 12: 10500, 13: 9800, 14: 10800,
  15: 11200, 16: 12500, 17: 11000, 18: 9500, 19: 9000, 20: 9200,
}
const PARIS_GENERIC_ANCHOR = 11000 // "Paris" sans numéro

const COMMUNE_ANCHOR: Record<string, number> = {
  'boulogne-billancourt': 9500, 'issy-les-moulineaux': 8500, 'levallois-perret': 9800,
  'neuilly-sur-seine': 12000, 'saint-cloud': 9500, 'sevres': 8500, 'vincennes': 9800,
  'montrouge': 8500, 'saint-mande': 9500, 'clichy': 6000, 'puteaux': 9500,
}
const SUBURB_DEFAULT_ANCHOR = 8000

/* ── Données de quartier par arrondissement (transports/lieux/ambiance/IRIS) ── */

interface ArrData {
  transports: string[]
  nearby: string[]
  vibes: string[]
  irisZone: string
  irisDescription: string
}

const ARR_DATA: Record<number, ArrData> = {
  1: {
    transports: ['M1 Louvre-Rivoli', 'M7 Pont Neuf', 'M1 Tuileries', 'RER A Châtelet-Les Halles', 'M14 Châtelet'],
    nearby: ['Musée du Louvre', 'Jardin des Tuileries', 'Palais Royal', 'Les Halles', 'Comédie-Française'],
    vibes: ['Central & patrimonial', 'Prestigieux & touristique', 'Historique & animé'],
    irisZone: 'Louvre — Palais-Royal',
    irisDescription: 'Cœur historique de Paris, entre le Louvre et le Palais-Royal. Institutions, galeries et jardins classés.',
  },
  2: {
    transports: ['M3 Bourse', 'M8 Grands Boulevards', 'M9 Grands Boulevards', 'M3 Sentier'],
    nearby: ['Rue Montorgueil', 'Passages couverts', 'Palais Brongniart', 'Bibliothèque nationale Richelieu'],
    vibes: ['Animé & branché', 'Vivant & central', 'Créatif & commerçant'],
    irisZone: 'Vivienne — Gaillon',
    irisDescription: 'Le plus petit arrondissement, entre Bourse et Grands Boulevards. Passages couverts et rues piétonnes animées.',
  },
  3: {
    transports: ['M11 Arts et Métiers', 'M8 Filles du Calvaire', 'M3 Temple', 'M11 Rambuteau'],
    nearby: ['Marché des Enfants Rouges', 'Musée Picasso', 'Haut Marais', 'Musée Carnavalet'],
    vibes: ['Créatif & confidentiel', 'Branché & feutré', 'Bohème chic'],
    irisZone: 'Arts-et-Métiers — Haut Marais',
    irisDescription: 'Haut Marais, entre galeries d\'art, boutiques de créateurs et hôtels particuliers du XVIIᵉ.',
  },
  4: {
    transports: ['M1 Saint-Paul', 'M7 Pont Marie', 'M11 Hôtel de Ville', 'M1 Hôtel de Ville'],
    nearby: ['Place des Vosges', 'Île Saint-Louis', 'Centre Pompidou', 'Marais historique'],
    vibes: ['Historique & prisé', 'Romantique & central', 'Patrimonial & vivant'],
    irisZone: 'Saint-Gervais — Île Saint-Louis',
    irisDescription: 'Marais historique et Île Saint-Louis, l\'un des cœurs les plus anciens et recherchés de Paris.',
  },
  5: {
    transports: ['M7 Jussieu', 'M10 Cardinal Lemoine', 'RER B Luxembourg', 'M10 Jussieu'],
    nearby: ['Panthéon', 'Jardin des Plantes', 'Rue Mouffetard', 'La Sorbonne'],
    vibes: ['Intellectuel & vivant', 'Étudiant & animé', 'Classique & lettré'],
    irisZone: 'Sorbonne — Val-de-Grâce',
    irisDescription: 'Quartier latin, entre Panthéon et Sorbonne. Universités, librairies et marchés animés.',
  },
  6: {
    transports: ['M4 Saint-Germain-des-Prés', 'M10 Mabillon', 'M4 Odéon', 'M10 Odéon'],
    nearby: ['Jardin du Luxembourg', 'Saint-Sulpice', 'Marché Saint-Germain', 'Institut de France'],
    vibes: ['Élégant & littéraire', 'Chic & feutré', 'Prestigieux & intemporel'],
    irisZone: 'Odéon — Saint-Germain',
    irisDescription: 'Saint-Germain-des-Prés, cafés littéraires, galeries et le Jardin du Luxembourg à deux pas.',
  },
  7: {
    transports: ['M8 La Tour-Maubourg', 'M13 Varenne', 'RER C Invalides', 'M8 École Militaire'],
    nearby: ['Tour Eiffel', 'Hôtel des Invalides', 'Musée d\'Orsay', 'Champ-de-Mars'],
    vibes: ['Aristocratique & confidentiel', 'Prestigieux & résidentiel', 'Feutré & institutionnel'],
    irisZone: 'Invalides — Gros-Caillou',
    irisDescription: 'Entre Invalides et Champ-de-Mars, ambassades et hôtels particuliers dans un cadre aéré et discret.',
  },
  8: {
    transports: ['M9 Miromesnil', 'M1 Franklin D. Roosevelt', 'M12 Madeleine', 'M14 Saint-Lazare'],
    nearby: ['Champs-Élysées', 'Parc Monceau', 'Église de la Madeleine', 'Palais de l\'Élysée'],
    vibes: ['Prestigieux & feutré', 'Bourgeois & central', 'Élégant & institutionnel'],
    irisZone: 'Madeleine — Faubourg-du-Roule',
    irisDescription: 'Triangle d\'or, entre l\'Élysée et la Madeleine. Maisons de couture, ambassades et haussmannien de prestige.',
  },
  9: {
    transports: ['M12 Notre-Dame-de-Lorette', 'M7 Le Peletier', 'M2 Pigalle', 'RER A Auber'],
    nearby: ['Opéra Garnier', 'Galeries Lafayette', 'SoPi (South Pigalle)', 'Musée Grévin'],
    vibes: ['Vivant & central', 'Animé & montant', 'Branché & commerçant'],
    irisZone: 'Faubourg-Montmartre — SoPi',
    irisDescription: 'De l\'Opéra à Pigalle, quartier vivant mêlant grands magasins et rues bistrotières de SoPi.',
  },
  10: {
    transports: ['M5 Jacques Bonsergent', 'M4 Gare de l\'Est', 'M5 Gare du Nord', 'M7 Château Landon'],
    nearby: ['Canal Saint-Martin', 'Gare du Nord', 'Marché Saint-Quentin', 'Hôpital Saint-Louis'],
    vibes: ['Populaire & branché', 'Vivant & cosmopolite', 'Jeune & animé'],
    irisZone: 'Canal Saint-Martin — Hôpital-Saint-Louis',
    irisDescription: 'Autour du Canal Saint-Martin, terrasses, bars et boutiques indépendantes très prisés.',
  },
  11: {
    transports: ['M9 Voltaire', 'M5 Oberkampf', 'M8 Ledru-Rollin', 'M3 Rue Saint-Maur'],
    nearby: ['Place de la Bastille', 'Oberkampf', 'Marché d\'Aligre', 'Cimetière du Père-Lachaise'],
    vibes: ['Jeune & animé', 'Vivant & festif', 'Bobo & commerçant'],
    irisZone: 'Roquette — Sainte-Marguerite',
    irisDescription: 'De Bastille à Oberkampf, l\'un des quartiers les plus vivants de Paris, bars et restaurants à foison.',
  },
  12: {
    transports: ['M8 Ledru-Rollin', 'M1 Gare de Lyon', 'M14 Gare de Lyon', 'M6 Bel-Air'],
    nearby: ['Bois de Vincennes', 'Coulée verte René-Dumont', 'Bercy Village', 'Marché d\'Aligre'],
    vibes: ['Familial & verdoyant', 'Calme & résidentiel', 'Vivant & aéré'],
    irisZone: 'Bel-Air — Picpus',
    irisDescription: 'Entre Coulée verte et Bois de Vincennes, arrondissement familial, vert et bien desservi.',
  },
  13: {
    transports: ['M6 Place d\'Italie', 'M7 Place d\'Italie', 'M14 Olympiades', 'M7 Tolbiac'],
    nearby: ['BnF François-Mitterrand', 'Butte-aux-Cailles', 'Quartier asiatique', 'Les Docks — Cité de la Mode'],
    vibes: ['Cosmopolite & en mutation', 'Vivant & contrasté', 'Populaire & montant'],
    irisZone: 'Croulebarbe — Butte-aux-Cailles',
    irisDescription: 'De la Butte-aux-Cailles villageoise aux tours des Olympiades, arrondissement contrasté et vivant.',
  },
  14: {
    transports: ['M4 Alésia', 'M6 Denfert-Rochereau', 'M13 Pernety', 'RER B Denfert-Rochereau'],
    nearby: ['Parc Montsouris', 'Catacombes de Paris', 'Gare Montparnasse', 'Rue Daguerre'],
    vibes: ['Calme & résidentiel', 'Familial & discret', 'Villageois & vert'],
    irisZone: 'Montsouris — Petit-Montrouge',
    irisDescription: 'Autour du Parc Montsouris, quartier résidentiel calme aux rues pavillonnaires recherchées.',
  },
  15: {
    transports: ['M12 Convention', 'M8 Commerce', 'M6 Dupleix', 'M10 Charles Michels'],
    nearby: ['Parc André-Citroën', 'Rue du Commerce', 'Tour Montparnasse', 'Front de Seine'],
    vibes: ['Familial & vivant', 'Résidentiel & commerçant', 'Calme & bien desservi'],
    irisZone: 'Saint-Lambert — Commerce',
    irisDescription: 'Plus grand arrondissement, familial et commerçant, de la rue du Commerce au Parc André-Citroën.',
  },
  16: {
    transports: ['M6 Trocadéro', 'M9 Rue de la Pompe', 'M10 Église d\'Auteuil', 'RER C Avenue Henri Martin'],
    nearby: ['Bois de Boulogne', 'Trocadéro', 'Fondation Louis Vuitton', 'Village d\'Auteuil'],
    vibes: ['Bourgeois & résidentiel', 'Prestigieux & panoramique', 'Calme & cossu'],
    irisZone: 'Auteuil — Passy',
    irisDescription: 'D\'Auteuil à Passy, arrondissement résidentiel cossu bordé par le Bois de Boulogne.',
  },
  17: {
    transports: ['M2 Villiers', 'M3 Wagram', 'M13 La Fourche', 'M2 Ternes'],
    nearby: ['Parc Monceau', 'Village des Batignolles', 'Palais des Congrès', 'Marché des Batignolles'],
    vibes: ['Résidentiel & montant', 'Familial & village', 'Bourgeois & vivant'],
    irisZone: 'Batignolles — Plaine Monceau',
    irisDescription: 'Des Batignolles villageoises à la Plaine Monceau bourgeoise, arrondissement en forte cote.',
  },
  18: {
    transports: ['M12 Abbesses', 'M2 Anvers', 'M12 Jules Joffrin', 'M4 Château Rouge'],
    nearby: ['Montmartre', 'Sacré-Cœur', 'Place des Abbesses', 'Marché Barbès'],
    vibes: ['Artistique & contrasté', 'Villageois & vivant', 'Populaire & pittoresque'],
    irisZone: 'Clignancourt — Grandes-Carrières',
    irisDescription: 'De la butte Montmartre aux pentes des Abbesses, quartier villageois, artistique et animé.',
  },
  19: {
    transports: ['M5 Laumière', 'M7bis Buttes Chaumont', 'M5 Ourcq', 'M7 Riquet'],
    nearby: ['Parc des Buttes-Chaumont', 'Parc de la Villette', 'Bassin de la Villette', 'Cité des Sciences'],
    vibes: ['Populaire & vert', 'Familial & aéré', 'Vivant & en mutation'],
    irisZone: 'Buttes-Chaumont — Villette',
    irisDescription: 'Entre Buttes-Chaumont et Bassin de la Villette, arrondissement vert, familial et en pleine évolution.',
  },
  20: {
    transports: ['M2 Ménilmontant', 'M3 Gambetta', 'M2 Père Lachaise', 'M3bis Pelleport'],
    nearby: ['Cimetière du Père-Lachaise', 'Belleville', 'Parc de Belleville', 'Rue des Pyrénées'],
    vibes: ['Populaire & créatif', 'Villageois & vivant', 'Cosmopolite & bohème'],
    irisZone: 'Belleville — Père-Lachaise',
    irisDescription: 'De Belleville à Gambetta, quartier populaire, cosmopolite et créatif, aux airs de village.',
  },
}

const GENERIC_PARIS: ArrData = {
  transports: ['Métro (proche)', 'Bus (proche)', 'RER (proche)'],
  nearby: ['Commerces de proximité', 'Écoles', 'Marché de quartier', 'Espaces verts'],
  vibes: ['Vivant & central', 'Résidentiel & pratique', 'Bien desservi'],
  irisZone: 'Quartier parisien',
  irisDescription: 'Quartier parisien bien desservi, entre commerces de proximité et vie de voisinage.',
}

const GENERIC_SUBURB: ArrData = {
  transports: ['Métro / Tram (proche)', 'Bus (proche)', 'Transilien (proche)'],
  nearby: ['Commerces de proximité', 'Écoles', 'Parc communal', 'Marché'],
  vibes: ['Résidentiel & calme', 'Familial & pratique', 'Proche Paris & verdoyant'],
  irisZone: 'Quartier résidentiel',
  irisDescription: 'Quartier résidentiel de proche banlieue, calme et bien connecté à Paris.',
}

/* ── Résolution d'arrondissement (défensive) ───────────────────────────────── */

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

export interface ArrResolution {
  kind: 'paris' | 'paris-generic' | 'commune' | 'suburb'
  arrNum: number | null
  anchor: number
  data: ArrData
  label: string
}

/** Extrait l'arrondissement / la commune de façon robuste. Ne plante jamais. */
export function resolveArrondissement(arr: string): ArrResolution {
  const raw = (arr ?? '').toString()
  const norm = normalize(raw)

  // "Paris 8ème" / "Paris 8e" / "PARIS 8e" / "Paris 1er"
  const m = norm.match(/paris\s+(\d{1,2})\s*(?:er|ere|eme|e)?\b/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= 20) {
      return { kind: 'paris', arrNum: n, anchor: PARIS_ANCHOR[n], data: ARR_DATA[n], label: `Paris ${n}` }
    }
  }

  // "Paris" sans numéro exploitable
  if (/\bparis\b/.test(norm)) {
    return { kind: 'paris-generic', arrNum: null, anchor: PARIS_GENERIC_ANCHOR, data: GENERIC_PARIS, label: 'Paris' }
  }

  // Commune connue (banlieue)
  const communeKey = norm.replace(/\s+/g, '-')
  if (communeKey in COMMUNE_ANCHOR) {
    return { kind: 'commune', arrNum: null, anchor: COMMUNE_ANCHOR[communeKey], data: GENERIC_SUBURB, label: raw }
  }

  // Fallback générique banlieue
  return { kind: 'suburb', arrNum: null, anchor: SUBURB_DEFAULT_ANCHOR, data: GENERIC_SUBURB, label: raw || 'Banlieue' }
}

/* ── Générateurs ───────────────────────────────────────────────────────────── */

export interface MarketData {
  marketAvgPricePerSqm: number
  marketHighPrice: number
  marketLowPrice: number
  marketEvolution10y: string
}

/**
 * Prix marché : mélange de l'ancre d'arrondissement et du €/m² réel du bien
 * (60/40) + léger jitter seedé, arrondi à la centaine. Fourchette ±15%,
 * évolution 10 ans inventée plausible (+15% à +32%).
 */
export function genMarket(arr: string, price: number, surface: number, seed: string): MarketData {
  const rnd = rng(seed + ':market')
  const { anchor } = resolveArrondissement(arr)
  const ownPpsm = surface > 0 ? price / surface : anchor
  const jitter = 0.95 + rnd() * 0.1 // 0.95 .. 1.05
  const avg = round100(Math.max(2000, (0.6 * anchor + 0.4 * ownPpsm) * jitter))
  const high = round100(avg * 1.15)
  const low = round100(avg * 0.85)
  const evo = 15 + Math.floor(rnd() * 18) // 15 .. 32
  return {
    marketAvgPricePerSqm: avg,
    marketHighPrice: high,
    marketLowPrice: low,
    marketEvolution10y: `+${evo}%`,
  }
}

export interface CompositionPiece {
  label: string
  surface: number
}

/**
 * Composition qui SOMME EXACTEMENT à round(surface). Nombre de chambres tiré de
 * `bedrooms` (fallback rooms-1). Le reliquat d'arrondi est reporté sur le séjour.
 */
export function genComposition(
  surface: number,
  rooms: number,
  bedrooms: number | null,
  seed: string,
): CompositionPiece[] {
  const rnd = rng(seed + ':comp')
  const total = Math.max(1, Math.round(surface))
  const nBed = bedrooms && bedrooms > 0 ? bedrooms : Math.max(1, (rooms || 2) - 1)
  const big = total >= 90

  // Poids relatifs (normalisés ensuite sur `total`).
  const parts: { label: string; weight: number }[] = []
  parts.push({ label: big ? 'Double séjour' : 'Séjour', weight: big ? 0.34 : 0.30 })
  parts.push({ label: 'Cuisine', weight: 0.10 })
  for (let i = 0; i < nBed; i++) {
    parts.push({ label: i === 0 ? 'Chambre parentale' : `Chambre ${i + 1}`, weight: i === 0 ? 0.15 : 0.12 })
  }
  parts.push({ label: 'Salle de bain', weight: 0.07 })
  if (total > 65) parts.push({ label: 'Salle d\'eau', weight: 0.05 })
  if (nBed >= 2 && total > 80) parts.push({ label: 'Dressing', weight: 0.04 })
  parts.push({ label: 'Entrée / dégagement', weight: 0.05 })

  const wSum = parts.reduce((s, p) => s + p.weight, 0)
  // Surfaces entières (min 4 m² par pièce), petit jitter seedé.
  const pieces: CompositionPiece[] = parts.map((p) => {
    const base = (p.weight / wSum) * total
    const jitter = 0.92 + rnd() * 0.16
    return { label: p.label, surface: Math.max(4, Math.round(base * jitter)) }
  })

  // Report du reliquat sur le séjour (pièce 0) pour sommer EXACTEMENT à total.
  const sum = pieces.reduce((s, p) => s + p.surface, 0)
  pieces[0].surface = Math.max(4, pieces[0].surface + (total - sum))
  return pieces
}

/** Transports plausibles pour l'arrondissement (2-4), format sheet. */
export function genTransports(arr: string, seed: string): string[] {
  const rnd = rng(seed + ':transport')
  const { data } = resolveArrondissement(arr)
  return pickN(data.transports, 2 + Math.floor(rnd() * 3), rnd) // 2..4
}

/** Lieux/commerces plausibles pour l'arrondissement (2-4). */
export function genNearby(arr: string, seed: string): string[] {
  const rnd = rng(seed + ':nearby')
  const { data } = resolveArrondissement(arr)
  return pickN(data.nearby, 2 + Math.floor(rnd() * 3), rnd) // 2..4
}

/** Ambiance de quartier (une phrase). À n'écrire que si le champ est vide. */
export function genVibe(arr: string, seed: string): string {
  const rnd = rng(seed + ':vibe')
  const { data } = resolveArrondissement(arr)
  return pick(data.vibes, rnd)
}

export interface IrisText {
  irisZone: string
  irisDescription: string
}

/** Zone IRIS (texte) + description courte plausible. */
export function genIris(arr: string, _seed: string): IrisText {
  const { data } = resolveArrondissement(arr)
  return { irisZone: data.irisZone, irisDescription: data.irisDescription }
}
