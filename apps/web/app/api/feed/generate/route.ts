/**
 * POST /api/feed/generate
 *
 * Génération dynamique d'un feed acquéreur :
 *  1. Lit `src/data/video-tags.json` (tags manuels par vidéo).
 *  2. Matche les vidéos compatibles avec le snapshot (géo, budget, surface)
 *     avec un widening progressif pour ne jamais renvoyer un feed vide.
 *  3. Demande à Claude Haiku une fiche immobilière fictive par vidéo
 *     (max 10 vidéos / fiches).
 *  4. Score chaque fiche avec le moteur de matching existant.
 *  5. Renvoie les biens triés par score desc, avec la vraie vidéo
 *     Cloudinary + chapitres IA + agence dérivée de l'arrondissement.
 *
 * Aucun bien n'est persisté en DB — le feed est éphémère, recalculé
 * à chaque arrivée sur `/feed` quand un brief est présent.
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import {
  buildBriefFromSnapshot,
  type BriefSnapshot,
} from '@/lib/matching/buyerBriefBuilder'
import { matchProperty } from '@shomee/core/matching/engine'
import type {
  PropertyProfile,
  PropertyTypeStructured,
  DpeRating,
} from '@shomee/core/matching/types'
import type { Property as ViewProperty } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_FICHES = 4
const MAX_TOKENS = 2000
const TAGS_FILE = path.join(process.cwd(), 'src', 'data', 'video-tags.json')

// ─── Tag file ────────────────────────────────────────────────────────────

type VideoTag = {
  videoId: string
  videoUrl: string
  arrondissements: number[]
  communes: string[]
  rooms?: number[]
  bedrooms?: number[]
  priceRange: [number, number]
  surfaceRange: [number, number]
}

function readTagsFile(): VideoTag[] {
  try {
    const raw = fs.readFileSync(TAGS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as VideoTag[]) : []
  } catch (err) {
    console.error(
      `[feed/generate] tags file read failed path=${TAGS_FILE} err=${String(err)}`,
    )
    return []
  }
}

// ─── Geo id → semantic mapping ───────────────────────────────────────────

const COMMUNE_ID_TO_NAME: Record<string, string> = {
  'com-92012': 'Boulogne-Billancourt',
  'com-92040': 'Issy-les-Moulineaux',
  'com-92044': 'Levallois-Perret',
  'com-92051': 'Neuilly-sur-Seine',
  'com-92064': 'Saint-Cloud',
  'com-92072': 'Sèvres',
  'com-94081': 'Vincennes',
}

function arrIdsToNumbers(ids?: string[] | null): number[] {
  if (!ids) return []
  return ids
    .map((id) => {
      const m = id.match(/^arr-(\d{1,2})$/)
      return m ? parseInt(m[1], 10) : NaN
    })
    .filter((n): n is number => Number.isFinite(n))
}

function communeIdsToNames(ids?: string[] | null): string[] {
  if (!ids) return []
  return ids
    .map((id) => COMMUNE_ID_TO_NAME[id])
    .filter((n): n is string => Boolean(n))
}

/**
 * IRIS ID → arrondissement number. IDs sont préfixées `iris-` dans le
 * store, suivies du code INSEE 9 chiffres : `iris-75116XXXX`. Le triplet
 * `751NN` = commune Paris arr NN.
 */
function arrFromIrisId(id: string): number | null {
  const m = id.match(/(?:^|[^0-9])751(0[1-9]|1[0-9]|20)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 20 ? n : null
}

/**
 * Quartier ID administratif (opendata Paris) → arrondissement number.
 * Les IDs ont la forme `qu-NN` où NN est le code INSEE c_qu (1..80).
 * Paris est découpé en 80 quartiers répartis 4 par arrondissement
 * dans l'ordre (qu-1..4 = arr-1, qu-5..8 = arr-2, …, qu-77..80 = arr-20).
 * Donc arr = ⌈c_qu / 4⌉. La formule est utilisée par tout l'outillage
 * Paris (cf. parseQuartier dans lib/services/geoDataService.ts).
 */
function arrFromAdminQuartierId(id: string): number | null {
  const m = id.match(/^qu-(\d{1,2})$/)
  if (!m) return null
  const cQu = parseInt(m[1], 10)
  if (cQu < 1 || cQu > 80) return null
  return Math.ceil(cQu / 4)
}

// ─── Quartier → arrondissements (chargé une fois au démarrage) ───────────

type QuartierRaw = { id: string; irisNames?: string[] }
type IrisIndex = Record<string, unknown>

// Lazy single-shot map building — évite de re-lire les JSON à chaque
// requête. Charge `quartiers.json` + `iris_codes_insee.json` depuis
// `src/data/` au premier appel, puis met en cache.
let QUARTIER_TO_ARRS: Map<string, number[]> | null = null

function getQuartierToArrs(): Map<string, number[]> {
  if (QUARTIER_TO_ARRS) return QUARTIER_TO_ARRS
  const out = new Map<string, number[]>()
  try {
    const root = path.join(process.cwd(), 'src', 'data')
    const quartiers = JSON.parse(
      fs.readFileSync(path.join(root, 'quartiers.json'), 'utf-8'),
    ) as QuartierRaw[]
    const irisCodes = JSON.parse(
      fs.readFileSync(path.join(root, 'iris_codes_insee.json'), 'utf-8'),
    ) as IrisIndex

    // Index irisName → arr (le 1er trouvé suffit, les IRIS sont quasi-uniques).
    const nameToArr = new Map<string, number>()
    for (const key of Object.keys(irisCodes)) {
      const [name, arrPart] = key.split('|')
      if (!name || !arrPart) continue
      const m = arrPart.match(/^arr-(\d{1,2})$/)
      if (!m) continue
      const arr = parseInt(m[1], 10)
      if (!nameToArr.has(name)) nameToArr.set(name, arr)
    }

    for (const q of quartiers) {
      const arrs = new Set<number>()
      for (const name of q.irisNames ?? []) {
        const arr = nameToArr.get(name)
        if (arr) arrs.add(arr)
      }
      out.set(q.id, [...arrs])
    }
  } catch (err) {
    console.error('[feed/generate] failed to build quartier→arr map:', err)
  }
  QUARTIER_TO_ARRS = out
  return out
}

/**
 * Résout l'ensemble complet des arrondissements ciblés en combinant les
 * 3 niveaux géo du store (arr, quartier, IRIS). Si l'utilisateur sélectionne
 * Paris 16 via quartier "Auteuil" sans cocher "Paris 16" explicitement,
 * cette fonction injecte quand même arr=16 dans le pipeline.
 */
function resolveAllArrs(snapshot: BriefSnapshot): number[] {
  const out = new Set<number>()
  for (const n of arrIdsToNumbers(snapshot.arrondissementIds)) out.add(n)
  for (const id of snapshot.irisIds ?? []) {
    const arr = arrFromIrisId(id)
    if (arr) out.add(arr)
  }
  const qMap = getQuartierToArrs()
  for (const id of snapshot.quartierIds ?? []) {
    // Format administratif `qu-NN` (opendata Paris) — formule c_qu→arr.
    const adminArr = arrFromAdminQuartierId(id)
    if (adminArr) {
      out.add(adminArr)
      continue
    }
    // Fallback : ID sémantique (`auteuil`, `passy`…) résolu via
    // quartiers.json + iris_codes_insee.json.
    for (const arr of qMap.get(id) ?? []) out.add(arr)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Choisit le nom de quartier à afficher pour une fiche.
 *  - Si l'utilisateur a sélectionné des quartiers sémantiques (`auteuil`…),
 *    on prend celui-là.
 *  - Sinon, on tire au hasard parmi `ARR_QUARTIERS[targetArr]` pour donner
 *    une localisation crédible à la fiche dans l'arrondissement.
 */
function resolveDisplayQuartier(snapshot: BriefSnapshot, targetArr: number): string {
  // 1. Quartier sémantique explicite (auteuil, passy…) → nom direct.
  for (const id of snapshot.quartierIds ?? []) {
    if (id.startsWith('qu-')) continue // ID administratif, pas de nom mappable simple
    // Capitalize id like "saint-germain" → "Saint Germain"
    const semantic = id
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    if (semantic) return semantic
  }
  // 2. Tirage aléatoire dans le catalogue d'arr.
  const pool = ARR_QUARTIERS[targetArr] ?? []
  if (pool.length === 0) return `Paris ${targetArr}e`
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * Sélectionne un arrondissement de référence pour la fiche associée à
 * cette vidéo. Priorité à l'intersection brief ∩ tags vidéo (vraie
 * cohérence). À défaut (widening), on prend le 1er arr de la vidéo.
 */
function pickArrForFiche(video: VideoTag, userArrs: number[]): number {
  const hit = video.arrondissements.find((a) => userArrs.includes(a))
  if (hit) return hit
  return video.arrondissements[0] ?? 0
}

// ─── Agency map (spec) ───────────────────────────────────────────────────

/** Plage globale €/m² imposée sur tous les biens du feed. La position
 *  dans cette plage est ensuite biaisée par l'arrondissement via la
 *  table PRICE_FLOORS. */
const ABSOLUTE_MIN_PER_SQM = 11000
const ABSOLUTE_MAX_PER_SQM = 16000

/**
 * Centre €/m² par arrondissement — bornes calibrées pour rester dans
 * [11 K, 16 K] (cf. règle produit "globalement entre 11 K et 16 K").
 * Les arr les moins chers (12, 13, 14, 19, 20) sont à 11 K, les plus
 * cotés (6, 7) à 15-16 K. Les prompts et la rectification serveur
 * partent toujours de cette table.
 */
const PRICE_FLOORS: Record<number, number> = {
  1: 14000, 2: 13000, 3: 13000, 4: 14000,
  5: 13000, 6: 15000, 7: 15500, 8: 14500,
  9: 12500, 10: 11500, 11: 11500, 12: 11000,
  13: 11000, 14: 11000, 15: 12000, 16: 14000,
  17: 12500, 18: 11500, 19: 11000, 20: 11000,
}

/**
 * Coordonnées approximatives par arrondissement (centre géographique).
 * Sert de base pour `mapLat`/`mapLng` côté serveur, avec ±0.003° de
 * jitter pour varier l'emplacement perçu d'une fiche à l'autre.
 */
const ARR_COORDS: Record<number, [number, number]> = {
  1:  [48.860, 2.347], 2:  [48.865, 2.349], 3:  [48.863, 2.356],
  4:  [48.854, 2.352], 5:  [48.851, 2.346], 6:  [48.849, 2.333],
  7:  [48.856, 2.317], 8:  [48.874, 2.308], 9:  [48.876, 2.338],
  10: [48.876, 2.360], 11: [48.859, 2.379], 12: [48.840, 2.388],
  13: [48.831, 2.362], 14: [48.832, 2.326], 15: [48.841, 2.298],
  16: [48.863, 2.274], 17: [48.884, 2.313], 18: [48.891, 2.344],
  19: [48.882, 2.378], 20: [48.864, 2.397],
}

/**
 * Liste de quartiers grand-public par arrondissement — sert pour
 * `resolveDisplayQuartier` quand l'utilisateur n'a pas choisi de quartier
 * précis (on en pioche un au hasard). Volontairement court : 3-4 noms
 * iconiques par arr qui parlent à n'importe qui.
 */
const ARR_QUARTIERS: Record<number, string[]> = {
  1: ['Louvre', 'Les Halles', 'Palais Royal', 'Tuileries'],
  2: ['Sentier', 'Bourse', 'Montorgueil', 'Vivienne'],
  3: ['Marais', 'République', 'Arts et Métiers', 'Enfants Rouges'],
  4: ['Marais', 'Île Saint-Louis', 'Bastille', 'Hôtel de Ville'],
  5: ['Quartier Latin', 'Mouffetard', 'Jardin des Plantes', 'Panthéon'],
  6: ['Saint-Germain', 'Odéon', 'Luxembourg', 'Saint-Sulpice'],
  7: ['Invalides', 'Champ de Mars', 'Gros-Caillou', 'Sèvres-Babylone'],
  8: ['Madeleine', 'Champs-Élysées', 'Monceau', 'Europe'],
  9: ['Opéra', 'Trinité', 'Saint-Georges', 'Pigalle'],
  10: ['Canal Saint-Martin', 'Gare du Nord', 'Faubourg', 'Saint-Vincent-de-Paul'],
  11: ['Bastille', 'République', 'Oberkampf', 'Voltaire'],
  12: ['Bercy', 'Daumesnil', 'Aligre', 'Nation'],
  13: ['Butte-aux-Cailles', 'Place d\'Italie', 'Olympiades', 'Tolbiac'],
  14: ['Montparnasse', 'Denfert-Rochereau', 'Plaisance', 'Petit-Montrouge'],
  15: ['Beaugrenelle', 'Vaugirard', 'Grenelle', 'Necker'],
  16: ['Passy', 'Auteuil', 'Trocadéro', 'Muette'],
  17: ['Batignolles', 'Monceau', 'Ternes', 'Plaine de Monceaux'],
  18: ['Montmartre', 'Abbesses', 'Goutte d\'Or', 'La Chapelle'],
  19: ['Buttes-Chaumont', 'Villette', 'Pont-de-Flandre', 'Belleville'],
  20: ['Belleville', 'Père-Lachaise', 'Ménilmontant', 'Saint-Fargeau'],
}

const AGENCY_MAP: Record<number, string> = {
  7: 'Barnes Tour Eiffel',
  15: 'Barnes Tour Eiffel',
  16: 'Daniel Féau Passy',
  8: 'Laforêt Monceau',
  17: 'Laforêt Monceau',
  3: 'Engel & Völkers Marais',
  4: 'Engel & Völkers Marais',
  11: 'Century 21 Bastille',
  12: 'Century 21 Bastille',
  6: 'Morriss Montparnasse',
  14: 'Morriss Montparnasse',
  2: "L'Agence des Enfants Rouges",
  10: "L'Agence des Enfants Rouges",
}

/**
 * Tire le numéro d'arrondissement d'une adresse fictive générée par le LLM.
 * Tolère trois formes communes : "Paris 16e/16ème", "Paris 75016",
 * "75016 Paris". Renvoie 0 si rien d'exploitable.
 */
function parseArrFromAddress(address: string): number {
  // 75001 → 1, 75016 → 16, etc. Anywhere in the string.
  const postal = address.match(/\b750(\d{2})\b/)
  if (postal) {
    const n = parseInt(postal[1], 10)
    if (n >= 1 && n <= 20) return n
  }
  // "Paris 1er", "Paris 16e", "Paris 16ème"
  const literal = address.match(/Paris\s+(\d{1,2})(?:er|e|ème|eme)?\b/i)
  if (literal) {
    const n = parseInt(literal[1], 10)
    // Reject when the captured number is the department code (75) used
    // without a postal-code suffix.
    if (n >= 1 && n <= 20) return n
  }
  return 0
}

function resolveAgencyName(address: string): string {
  const arr = parseArrFromAddress(address)
  return AGENCY_MAP[arr] ?? 'Kretz Real Estate'
}

// ─── Cloudinary ID extraction ────────────────────────────────────────────

function extractCloudinaryId(videoUrl: string): string {
  const match = videoUrl.match(/\/upload\/(?:v\d+\/)?(.+?)\.mp4/)
  return match?.[1] ?? videoUrl
}

// ─── Video matching with progressive widening ────────────────────────────

/**
 * Groupes d'arrondissements géographiquement proches — utilisés en
 * dernier recours quand aucune vidéo n'est taggée pour la zone exacte
 * demandée. Les groupes se chevauchent volontairement (ex: 15 est dans
 * Rive gauche ET Ouest) pour mailler le territoire.
 */
const GEO_GROUPS: number[][] = [
  [1, 2, 3, 4],            // Centre
  [5, 6, 7, 13, 14, 15],   // Rive gauche
  [8, 9, 10, 17, 18],      // Nord-Ouest
  [11, 12, 20],            // Est
  [16, 15, 7],             // Ouest
  [19, 20, 10, 11],        // Nord-Est
]

/**
 * Vrai si la vidéo couvre au moins une zone demandée par l'acquéreur.
 * Une dimension non spécifiée par l'utilisateur ne contribue PAS au
 * match — sinon un brief arr=[14], com=[] retournerait toutes les
 * vidéos puisque communeMatch défaultait à true.
 */
function geoMatch(snapshot: BriefSnapshot, tag: VideoTag): boolean {
  const arrs = resolveAllArrs(snapshot)
  const communes = communeIdsToNames(snapshot.communeIds)
  if (arrs.length === 0 && communes.length === 0) return true
  const arrHit = arrs.length > 0 && tag.arrondissements.some((a) => arrs.includes(a))
  const communeHit = communes.length > 0 && tag.communes.some((c) => communes.includes(c))
  return arrHit || communeHit
}

/**
 * Widening progressif — on relâche les contraintes une par une plutôt
 * que de retomber brutalement sur toutes les vidéos. À chaque palier on
 * s'arrête dès qu'on a au moins quelques vidéos exploitables.
 *
 *   1. Géo exacte + budget + surface
 *   2. Géo exacte sans budget/surface
 *   3. Proximité géographique (GEO_GROUPS)
 *   4. Fallback total — toutes les vidéos (avec warning)
 */
function pickMatchedVideos(snapshot: BriefSnapshot, tags: VideoTag[]): VideoTag[] {
  const budget = snapshot.budgetMax ?? Infinity
  const surface = snapshot.minSurface ?? 0
  const requestedArrs = resolveAllArrs(snapshot)
  const byGeoOnly = tags.filter((t) => geoMatch(snapshot, t))

  // 1. Match strict
  let res = tags.filter(
    (tag) =>
      geoMatch(snapshot, tag) &&
      tag.priceRange[0] <= budget &&
      tag.surfaceRange[1] >= surface,
  )
  if (res.length >= 3) return res.slice(0, MAX_FICHES)

  // 2. Géo exacte sans budget/surface
  res = byGeoOnly
  if (res.length >= 3) return res.slice(0, MAX_FICHES)

  // 3. Proximité géographique — agrège tous les arr des groupes contenant
  //    un arr demandé (resolveAllArrs couvre déjà arr + quartier + IRIS).
  if (requestedArrs.length > 0) {
    const nearby = new Set<number>()
    for (const arr of requestedArrs) {
      for (const group of GEO_GROUPS) {
        if (group.includes(arr)) for (const a of group) nearby.add(a)
      }
    }
    res = tags.filter((tag) => tag.arrondissements.some((a) => nearby.has(a)))
    if (res.length >= 2) return res.slice(0, MAX_FICHES)
  }

  // 4. Fallback total
  console.warn('[feed/generate] tier=4-fallback aucune vidéo proche, retour de toutes les vidéos')
  return tags.slice(0, MAX_FICHES)
}

// ─── LLM generation ──────────────────────────────────────────────────────

// Schéma demandé au LLM — 4 fiches max_tokens 2000.
// Les champs annexes (subtitle, bedrooms, totalFloors, guardian,
// agency, lat/lng, charges, marché, matchedCriteria, likes/shares)
// sont dérivés côté serveur — voir ficheToView.
type FicheRoom = { label: string; surface: number }

type Fiche = {
  title: string
  address: string
  price: number
  surface: number
  rooms: number
  floor: number
  propertyType: PropertyTypeStructured
  elevator: boolean
  terrace: boolean
  balcony: boolean
  cellar: boolean
  parking: boolean
  dpe: DpeRating
  ges?: DpeRating
  luminosity: number
  charm: number
  quietness: number
  outdoorUsability: number
  description: string
  composition?: FicheRoom[]
  nearbyPOI?: string[]
}

const SYSTEM_PROMPT = `Tu génères des fiches de biens immobiliers fictifs pour une démo.
Réponds UNIQUEMENT avec un tableau JSON valide, sans texte autour.
Chaque fiche doit être cohérente avec les contraintes fournies.
Les valeurs numériques doivent être réalistes pour le marché parisien.`

/**
 * Bornes par fiche = intersection du brief acquéreur et des tags de la
 * vidéo associée. Garantit que la fiche générée (surface, prix, pièces)
 * soit cohérente avec la vidéo qu'elle illustre.
 *
 * Quand le widening géo a poussé une vidéo en dehors des bornes du brief
 * (intersection vide), on étire un minimum pour ne pas renvoyer un
 * intervalle invalide au LLM.
 */
type VideoContext = {
  videoId: string
  targetArr: number
  quartier: string
  targetSurface: number
  maxSurface: number
  targetPrice: number
  maxPrice: number
  targetRooms: number
  maxRooms: number
}

function buildVideoContext(
  snapshot: BriefSnapshot,
  video: VideoTag,
  userArrs: number[],
): VideoContext {
  const briefMinSurface = snapshot.minSurface ?? 0
  const briefMaxSurface = snapshot.maxSurface ?? Infinity
  const briefMinBudget = snapshot.budgetMin ?? 0
  const briefMaxBudget = snapshot.budgetMax ?? Infinity
  const briefMinRooms = snapshot.minRooms ?? 1
  const briefMaxRooms = snapshot.maxRooms ?? 10

  const targetSurface = Math.max(briefMinSurface, video.surfaceRange[0])
  let maxSurface = Math.min(briefMaxSurface, video.surfaceRange[1])
  if (maxSurface < targetSurface + 10) maxSurface = targetSurface + 20

  const targetPrice = Math.max(briefMinBudget, video.priceRange[0])
  let maxPrice = Math.min(briefMaxBudget, video.priceRange[1])
  if (maxPrice < targetPrice * 1.1) maxPrice = Math.round(targetPrice * 1.1)
  // Plafonner à targetPrice × 1.4 pour éviter que le LLM ne pose le prix
  // au plafond systématiquement (cf. spec correction).
  maxPrice = Math.min(maxPrice, Math.round(targetPrice * 1.4))

  const videoRooms = video.rooms ?? []
  const videoMinRooms = videoRooms[0] ?? 1
  const videoMaxRooms = videoRooms[videoRooms.length - 1] ?? 10
  const targetRooms = Math.max(briefMinRooms, videoMinRooms)
  let maxRooms = Math.min(briefMaxRooms, videoMaxRooms)
  if (maxRooms < targetRooms) maxRooms = targetRooms

  const targetArr = pickArrForFiche(video, userArrs)
  const quartier = resolveDisplayQuartier(snapshot, targetArr)

  return {
    videoId: video.videoId,
    targetArr,
    quartier,
    targetSurface: Math.round(targetSurface),
    maxSurface: Math.round(maxSurface),
    targetPrice: Math.round(targetPrice),
    maxPrice: Math.round(maxPrice),
    targetRooms,
    maxRooms,
  }
}

function buildUserPrompt(
  snapshot: BriefSnapshot,
  videos: VideoTag[],
  contexts: VideoContext[],
  n: number,
): string {
  // Zones effectives = celles demandées par l'acquéreur en priorité ;
  // à défaut (rien sélectionné), l'union des vidéos matchées sert de cadre
  // pour éviter d'envoyer "France entière" au LLM. resolveAllArrs combine
  // arr + quartier + IRIS pour qu'un brief "Auteuil" remonte arr=16.
  const userArrs = resolveAllArrs(snapshot)
  const userCommunes = communeIdsToNames(snapshot.communeIds)
  let arrs = userArrs
  let communes = userCommunes
  if (arrs.length === 0 && communes.length === 0) {
    const arrsSet = new Set<number>()
    const commSet = new Set<string>()
    for (const v of videos) {
      for (const a of v.arrondissements) arrsSet.add(a)
      for (const c of v.communes) commSet.add(c)
    }
    arrs = [...arrsSet].sort((a, b) => a - b)
    communes = [...commSet]
  }

  const zoneParts: string[] = []
  if (arrs.length > 0) {
    zoneParts.push(
      arrs.map((a) => (a === 1 ? 'Paris 1er' : `Paris ${a}e`)).join(', '),
    )
  }
  if (communes.length > 0) zoneParts.push(communes.join(', '))
  const zonesDescription = zoneParts.join(' ; ') || 'Paris intra-muros'

  const chipStates = snapshot.chipStates ?? {}
  const desired = Object.entries(chipStates)
    .filter(([, s]) => s === 1)
    .map(([l]) => l)
  const mandatory = Object.entries(chipStates)
    .filter(([, s]) => s === 2)
    .map(([l]) => l)
  for (const c of snapshot.customCriteria ?? []) {
    if (c.state === 1) desired.push(c.label)
    else if (c.state === 2) mandatory.push(c.label)
  }

  const types =
    snapshot.propertyTypes && snapshot.propertyTypes.length > 0
      ? snapshot.propertyTypes.join(', ')
      : 'appartement'

  // Prix /m² réaliste secteur — moyenne pondérée des centres PRICE_FLOORS
  // sur les arr ciblés. La fourchette envoyée au LLM est ensuite clampée
  // dans [ABSOLUTE_MIN_PER_SQM, ABSOLUTE_MAX_PER_SQM] pour respecter la
  // règle produit "tous les biens entre 11 K et 16 K €/m²".
  const avgPricePerSqm =
    arrs.length > 0
      ? Math.round(
          arrs.reduce((s, a) => s + (PRICE_FLOORS[a] ?? 12000), 0) / arrs.length,
        )
      : 12000
  const minPerSqm = Math.max(
    ABSOLUTE_MIN_PER_SQM,
    Math.round(avgPricePerSqm * 0.85),
  )
  const maxPerSqm = Math.min(
    ABSOLUTE_MAX_PER_SQM,
    Math.round(avgPricePerSqm * 1.3),
  )

  // Contraintes par fiche fournies en argument (déjà calculées) ; on les
  // ré-utilise telles quelles pour que l'ordre du tableau réponse soit
  // verrouillé sur l'ordre des fiches et des vidéos.
  const constraintsBlock = contexts
    .map((c, i) => {
      const arrLabel = c.targetArr === 1 ? 'Paris 1er' : `Paris ${c.targetArr}e`
      return (
        `Fiche ${i + 1}: ${arrLabel} (${c.quartier}) · ` +
        `surface ${c.targetSurface}-${c.maxSurface} m² · ` +
        `pièces ${c.targetRooms}-${c.maxRooms}`
      )
    })
    .join('\n')

  const budgetCap = snapshot.budgetMax
    ? `Plafond budget acquéreur : ${snapshot.budgetMax} € (ne JAMAIS dépasser).`
    : 'Pas de plafond budget acquéreur.'

  return `Génère ${n} fiches de biens immobiliers fictifs DANS CET ORDRE EXACT.
Chaque fiche a SES PROPRES contraintes — ne pas mélanger les fiches.

Zone : ${zonesDescription}
Type : ${types}

RÈGLE PRIX ABSOLUE (marché parisien réel) :
Pour chaque fiche, price = surface × pricePerSqm
où pricePerSqm est OBLIGATOIREMENT entre ${minPerSqm} et ${maxPerSqm} €/m².
Un prix correspondant à moins de ${minPerSqm} €/m² est INVALIDE.
${budgetCap}

Contraintes par fiche (surface + pièces, à respecter pour chaque fiche) :
${constraintsBlock}

Critères souhaités : ${desired.join(', ') || 'aucun'}
Critères obligatoires : ${mandatory.join(', ') || 'aucun'}

Format JSON — tableau de ${n} objets DANS CET ORDRE EXACT (un par fiche ci-dessus) :
{"title":"string","address":"string","price":number,"surface":number,"rooms":number,"floor":number,"propertyType":"appartement|maison|loft|atelier","elevator":boolean,"terrace":boolean,"balcony":boolean,"cellar":boolean,"parking":boolean,"dpe":"A|B|C|D|E|F|G","ges":"A|B|C|D|E|F|G","luminosity":number,"charm":number,"quietness":number,"outdoorUsability":number,"description":"string — 2 phrases","composition":[{"label":"Séjour|Cuisine|Chambre 1|...|Salle de bain|Entrée","surface":number}],"nearbyPOI":["string × 2-3 lieux réels du quartier"]}

Les 4 scores sont entre 0 et 1. Chaque fiche distincte (adresses différentes).
composition : 4 à 7 pièces, somme des surfaces ≈ surface totale (à ±5 m²).
nearbyPOI : 2-3 lieux réels et identifiables du quartier (parc, station de métro emblématique, marché, école renommée…).

CONTRAINTES STRICTES :
- L'arrondissement de l'adresse DOIT être celui indiqué pour la fiche (jamais un autre).
- Pour Paris, format "<numéro> <rue>, 750<NN> Paris" (ex: "12 rue de Passy, 75016 Paris" pour le 16e). Pas de "75e" ni de "Paris 75NNN".
- Pour les communes, format "<numéro> <rue>, <commune>".
- Surface et pièces dans la fourchette indiquée par fiche.
- Prix calculé strictement via la formule ci-dessus, JAMAIS sous ${minPerSqm} €/m².`
}

/**
 * Repère la position du `}` qui ferme le `{` à l'index `start`, en tenant
 * compte des accolades imbriquées et des chaînes de caractères JSON.
 * Renvoie -1 si la fermeture n'est pas trouvée (réponse tronquée).
 */
function findMatchingBrace(text: string, start: number): number {
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Parser tolérant : tente d'abord le tableau JSON complet, puis rabat
 * sur une extraction objet-par-objet pour récupérer les fiches valides
 * même si la réponse a été tronquée par max_tokens.
 */
function parseFiches(text: string): Fiche[] {
  const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]) as unknown
      if (Array.isArray(parsed)) return parsed.filter(isFiche)
    } catch {
      // fall through to salvage parse
    }
  }

  const out: Fiche[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== '{') {
      i++
      continue
    }
    const end = findMatchingBrace(text, i)
    if (end === -1) break
    try {
      const obj = JSON.parse(text.slice(i, end + 1))
      if (isFiche(obj)) out.push(obj)
    } catch {
      // skip malformed object
    }
    i = end + 1
  }
  return out
}

function isFiche(x: unknown): x is Fiche {
  if (!x || typeof x !== 'object') return false
  const f = x as Record<string, unknown>
  return (
    typeof f.title === 'string' &&
    typeof f.address === 'string' &&
    typeof f.price === 'number' &&
    typeof f.surface === 'number' &&
    typeof f.rooms === 'number'
  )
}

async function callLlm(
  snapshot: BriefSnapshot,
  videos: VideoTag[],
  contexts: VideoContext[],
): Promise<Fiche[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []
  const anthropic = new Anthropic({ apiKey })
  const userPrompt = buildUserPrompt(snapshot, videos, contexts, videos.length)
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = res.content[0]
  const text = block?.type === 'text' ? block.text : ''
  return parseFiches(text)
}

// ─── Profile / projection ────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

function derivedBedrooms(rooms: number): number {
  return Math.max(1, rooms - 1)
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Mappe les chips activés du brief sur les attributs effectivement
 * vrais de la fiche générée. Sert à afficher des chips "validés" sous
 * la description courte du feed — uniquement les critères pour lesquels
 * l'utilisateur a exprimé une préférence (chipStates > 0).
 *
 * Le mapping est volontairement local et explicite ; on n'utilise pas
 * `tagsToCriteria` pour rester côté affichage et ne pas mélanger les
 * registres (matching engine vs. surfaçage UI).
 */
function computeMatchedCriteria(fiche: Fiche, snapshot: BriefSnapshot): string[] {
  const chips = snapshot.chipStates ?? {}
  const out: string[] = []
  const has = (label: string): boolean => (chips[label] ?? 0) > 0
  if (has('Ascenseur') && fiche.elevator) out.push('Ascenseur')
  if (has('Terrasse') && fiche.terrace) out.push('Terrasse')
  if (has('Balcon') && fiche.balcony) out.push('Balcon')
  if (has('Cave') && fiche.cellar) out.push('Cave')
  if (has('Parking') && fiche.parking) out.push('Parking')
  if (has('Lumineux') && fiche.luminosity > 0.7) out.push('Lumineux')
  if (has('Calme') && fiche.quietness > 0.7) out.push('Calme')
  if (has('Charme') && fiche.charm > 0.7) out.push('Charme')
  // totalFloors est figé à 6 dans ficheToView → dernier étage = floor 6.
  if (has('Dernier étage') && fiche.floor >= 6) out.push('Dernier étage')
  if (has('Vue dégagée') && fiche.luminosity > 0.75) out.push('Vue dégagée')
  return out
}

/**
 * Composition par défaut quand le LLM en omet ou en renvoie une incohérente
 * (somme des surfaces trop loin de la surface totale). Découpe simple :
 * séjour + cuisine + N chambres + SDB + entrée, normalisée au m² total.
 */
function defaultComposition(surface: number, rooms: number, bedrooms: number): FicheRoom[] {
  const items: FicheRoom[] = []
  items.push({ label: 'Séjour', surface: 0 })
  items.push({ label: 'Cuisine', surface: 0 })
  for (let i = 1; i <= bedrooms; i++) {
    items.push({ label: bedrooms === 1 ? 'Chambre' : `Chambre ${i}`, surface: 0 })
  }
  items.push({ label: 'Salle de bain', surface: 0 })
  items.push({ label: 'Entrée', surface: 0 })

  // Répartition indicative : 35 % séjour, 10 % cuisine, ~22 %/chambre,
  // 7 % SDB, 5 % entrée — ajustée au prorata jusqu'à somme = surface.
  const weights = [0.35, 0.10, ...Array(bedrooms).fill(0.22), 0.07, 0.05]
  const total = weights.reduce((s, w) => s + w, 0)
  return items.map((it, i) => ({
    ...it,
    surface: Math.max(2, Math.round((weights[i] / total) * surface)),
  }))
}

function normaliseComposition(
  raw: FicheRoom[] | undefined,
  fiche: Fiche,
): FicheRoom[] {
  const bedrooms = derivedBedrooms(fiche.rooms)
  if (!Array.isArray(raw) || raw.length === 0) {
    return defaultComposition(fiche.surface, fiche.rooms, bedrooms)
  }
  const sum = raw.reduce((s, r) => s + (typeof r.surface === 'number' ? r.surface : 0), 0)
  if (Math.abs(sum - fiche.surface) > fiche.surface * 0.25) {
    return defaultComposition(fiche.surface, fiche.rooms, bedrooms)
  }
  return raw
    .filter((r) => r && typeof r.label === 'string' && typeof r.surface === 'number')
    .map((r) => ({ label: r.label, surface: Math.max(2, Math.round(r.surface)) }))
}

/** Évolution prix 10 ans — "+15 %" à "+35 %", fenêtre 2026 réaliste Paris. */
function randomMarketEvolution10y(): string {
  const pct = randomInt(15, 35)
  return `+${pct}%`
}

/**
 * Filet de sécurité côté serveur : tous les biens doivent rester
 * strictement dans [11 K, 16 K] €/m² (règle produit). Si le LLM dérape
 * — en dessous du plancher d'arr ou au-dessus du plafond global —, on
 * recale le prix sur le centre d'arr clampé. La formule "price = surface
 * × pricePerSqm" reste exprimée dans le prompt pour le cas nominal ;
 * cette fonction n'intervient qu'en correction.
 */
function rectifyFichePrice(fiche: Fiche): Fiche {
  if (fiche.surface <= 0) return fiche
  const arr = parseArrFromAddress(fiche.address)
  const rawFloor = arr > 0 ? PRICE_FLOORS[arr] ?? 12000 : 12000
  const targetPerSqm = Math.min(
    ABSOLUTE_MAX_PER_SQM,
    Math.max(ABSOLUTE_MIN_PER_SQM, rawFloor),
  )
  const ratio = fiche.price / fiche.surface
  if (ratio < ABSOLUTE_MIN_PER_SQM || ratio > ABSOLUTE_MAX_PER_SQM) {
    return { ...fiche, price: Math.round(fiche.surface * targetPerSqm) }
  }
  return fiche
}

function ficheToProfile(fiche: Fiche, idx: number): PropertyProfile {
  return {
    property_id: `gen-${Date.now()}-${idx}`,
    structured: {
      price: fiche.price,
      property_type: fiche.propertyType,
      floor: fiche.floor,
      total_floors: 6, // Paris haussmannien — défaut quand non précisé.
      has_elevator: fiche.elevator,
      has_terrace: fiche.terrace,
      terrace_surface_m2: fiche.terrace ? 8 : null,
      has_balcony: fiche.balcony,
      balcony_surface_m2: null,
      has_garden: false,
      garden_surface_m2: null,
      has_cellar: fiche.cellar,
      has_parking: fiche.parking,
      has_concierge: false,
      is_ground_floor: fiche.floor === 0,
      surface_m2: fiche.surface,
      room_count: fiche.rooms,
      bedroom_count: derivedBedrooms(fiche.rooms),
      bedroom_street_side: null,
      orientation: [],
      is_quiet_street: null,
      building_year: null,
      dpe_rating: fiche.dpe,
    },
    semantic: {
      luminosity: clamp01(fiche.luminosity),
      quietness: clamp01(fiche.quietness),
      charm: clamp01(fiche.charm),
      spaciousness: null,
      living_quality: null,
      outdoor_usability: clamp01(fiche.outdoorUsability),
    },
    raw_description: fiche.description,
    enriched_at: new Date(),
  }
}

function arrondissementLabel(n: number): string {
  if (n <= 0) return ''
  return n === 1 ? 'Paris 1er' : `Paris ${n}ème`
}

type ChapterRow = { label: string; startSec?: number; fraction?: number }

function ficheToView(
  fiche: Fiche,
  video: VideoTag,
  context: VideoContext,
  snapshot: BriefSnapshot,
  chapters: ChapterRow[] | null,
  aiTags: string[],
  matchScore01: number,
  isExcluded: boolean,
  id: string,
  dbAgency: { name: string; logo: string | null } | null,
): ViewProperty {
  const arrNum = parseArrFromAddress(fiche.address) || context.targetArr
  const arrLabel = arrondissementLabel(arrNum) || fiche.address
  // Agence réelle du bien (ré-assignée par localisation, avec logo Cloudinary).
  // Fallback sur le mapping arrondissement si la vidéo n'est pas reliée en DB.
  const agencyName = dbAgency?.name ?? resolveAgencyName(fiche.address)
  const agencyLogo = dbAgency?.logo ?? null

  const bedrooms = derivedBedrooms(fiche.rooms)
  const quartier = context.quartier
  const subtitle = `Appartement · T${fiche.rooms} · ${fiche.surface} m²`
  // Critères validés = tags IA extraits de la vidéo (PropertyTag/AI_VIDEO,
  // confidence ≥ 0.7) — données réelles, déterministes par vidéo.
  // Fallback sur la dérivation chips snapshot si la vidéo n'a pas de tags.
  const matchedCriteria =
    aiTags.length > 0 ? aiTags : computeMatchedCriteria(fiche, snapshot)

  // Marché : centre €/m² par arr, clampé dans [11K, 16K] (cf. règle prix).
  const rawFloor = arrNum > 0 ? PRICE_FLOORS[arrNum] ?? 12000 : 12000
  const marketAvg = Math.min(
    ABSOLUTE_MAX_PER_SQM,
    Math.max(ABSOLUTE_MIN_PER_SQM, rawFloor),
  )
  const pricePerSqm = Math.round(fiche.price / Math.max(1, fiche.surface))

  // Charges et fiscalité — proxys simples mais cohérents.
  const monthlyCharges = Math.round(fiche.surface * 3) // ~3 €/m²/mois moyenne
  const propertyTax = Math.round(fiche.price * 0.005) // ~0.5 % de la valeur
  const lotCount = randomInt(5, 80)

  // Localisation : ±0.003° de jitter autour du centre d'arr pour donner
  // une position crédible (≈ 200 m).
  const [baseLat, baseLng] = ARR_COORDS[arrNum] ?? [48.857, 2.352]
  const mapLat = +(baseLat + (Math.random() - 0.5) * 0.006).toFixed(5)
  const mapLng = +(baseLng + (Math.random() - 0.5) * 0.006).toFixed(5)

  const composition = normaliseComposition(fiche.composition, fiche)
  const nearbyPlaces = Array.isArray(fiche.nearbyPOI)
    ? fiche.nearbyPOI.filter((p): p is string => typeof p === 'string').slice(0, 5)
    : []

  return {
    id,
    title: fiche.title,
    subtitle,
    arrondissement: arrLabel,
    agentName: agencyName,
    agencyName,
    agencyLogo,
    price: fiche.price,
    pricePerSqm,
    surface: fiche.surface,
    rooms: fiche.rooms,
    bedrooms,
    location: fiche.address,
    district: quartier,
    description: fiche.description,
    tags: matchedCriteria,
    features: matchedCriteria,
    matchedCriteria,
    dpe: fiche.dpe,
    ges: fiche.ges ?? fiche.dpe,
    floor: fiche.floor,
    totalFloors: 6,
    hasElevator: fiche.elevator,
    hasTerrace: fiche.terrace,
    terraceSurfaceM2: fiche.terrace ? 8 : undefined,
    hasBalcony: fiche.balcony,
    hasCellar: fiche.cellar,
    hasParking: fiche.parking,
    hasConcierge: false,
    luminosity: clamp01(fiche.luminosity),
    quietness: clamp01(fiche.quietness),
    charm: clamp01(fiche.charm),
    outdoorUsability: clamp01(fiche.outdoorUsability),
    composition,
    mapLat,
    mapLng,
    nearbyPlaces,
    marketAvgPricePerSqm: marketAvg,
    marketEvolution10y: randomMarketEvolution10y(),
    monthlyCharges,
    propertyTax,
    lotCount,
    likeCount: randomInt(50, 300),
    shareCount: randomInt(50, 300),
    videoUrl: video.videoUrl,
    chapters: chapters as ViewProperty['chapters'] | undefined,
    imageUrlFallback: '',
    gallery: [],
    matchScore: matchScore01,
    isExcluded,
  }
}

// ─── Route ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const snapshot = body as BriefSnapshot

  const tags = readTagsFile()
  if (tags.length === 0) {
    // Tag file vide / manquant — la page feed retombera sur /api/properties.
    return NextResponse.json([])
  }

  const matchedVideos = pickMatchedVideos(snapshot, tags)

  // Contextes par vidéo (arr/quartier/bornes) calculés une seule fois et
  // partagés entre le prompt LLM et la projection ficheToView pour que
  // l'arr et le quartier de la fiche soient déterministes (pas relancés
  // en aval).
  const userArrs = resolveAllArrs(snapshot)
  const contexts = matchedVideos.map((v) => buildVideoContext(snapshot, v, userArrs))

  // Charge par vidéo : chapitres + agence (nom/logo) + tags IA. Chaque
  // fiche est bâtie à partir d'une vidéo, qui correspond à un bien DB :
  // on prend SES tags (résultat de scripts/scrape-and-seed.ts --analyze)
  // pour le bandeau "critères validés" plutôt que de dériver des chips.
  // Un seul findMany pour les ~30 biens.
  const dbProps = await prisma.property.findMany({
    where: { videoAnalysis: { isNot: null }, videoUrl: { not: null } },
    select: {
      videoUrl: true,
      videoAnalysis: { select: { chapitres: true } },
      agency: { select: { name: true, logo: true } },
      propertyTags: {
        where: { source: 'AI_VIDEO' },
        select: { label: true, confidence: true },
        orderBy: { confidence: 'desc' },
      },
    },
  })
  const chaptersByVideoId = new Map<string, ChapterRow[] | null>()
  const agencyByVideoId = new Map<string, { name: string; logo: string | null }>()
  const aiTagsByVideoId = new Map<string, string[]>()
  for (const p of dbProps) {
    if (!p.videoUrl) continue
    const vid = extractCloudinaryId(p.videoUrl)
    const raw = p.videoAnalysis?.chapitres
    chaptersByVideoId.set(
      vid,
      Array.isArray(raw) && raw.length > 0 ? (raw as unknown as ChapterRow[]) : null,
    )
    if (p.agency) agencyByVideoId.set(vid, { name: p.agency.name, logo: p.agency.logo })
    const labels = p.propertyTags
      .filter((t) => t.confidence >= 0.7)
      .map((t) => t.label.charAt(0).toUpperCase() + t.label.slice(1))
    aiTagsByVideoId.set(vid, labels)
  }

  let fiches: Fiche[] = []
  try {
    fiches = await callLlm(snapshot, matchedVideos, contexts)
  } catch (error) {
    console.error('[feed/generate] LLM call failed:', error)
    return NextResponse.json({ error: 'llm_failed' }, { status: 500 })
  }

  if (fiches.length === 0) {
    return NextResponse.json([])
  }

  const brief = buildBriefFromSnapshot(snapshot)
  const scored: ViewProperty[] = fiches.map((rawFiche, i) => {
    const fiche = rectifyFichePrice(rawFiche)
    const profile = ficheToProfile(fiche, i)
    const result = matchProperty(profile, brief)
    const video = matchedVideos[i % matchedVideos.length]
    const context = contexts[i % contexts.length]
    const chapters = chaptersByVideoId.get(video.videoId) ?? null
    const dbAgency = agencyByVideoId.get(video.videoId) ?? null
    const aiTags = aiTagsByVideoId.get(video.videoId) ?? []
    return ficheToView(
      fiche,
      video,
      context,
      snapshot,
      chapters,
      aiTags,
      result.global_score / 100,
      result.is_excluded,
      profile.property_id,
      dbAgency,
    )
  })

  const feed = scored
    .filter((p) => !p.isExcluded)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))

  return NextResponse.json(feed)
}
