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
import { matchProperty } from '@/lib/matching/engine'
import type {
  PropertyProfile,
  PropertyTypeStructured,
  DpeRating,
} from '@/lib/matching/types'
import type { Property as ViewProperty } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_FICHES = 6
const MAX_TOKENS = 1200
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
    const tags = Array.isArray(parsed) ? (parsed as VideoTag[]) : []
    const withArrs = tags.filter(
      (t) => Array.isArray(t.arrondissements) && t.arrondissements.length > 0,
    ).length
    const withCommunes = tags.filter(
      (t) => Array.isArray(t.communes) && t.communes.length > 0,
    ).length
    console.log(
      `[feed/generate] tags file path=${TAGS_FILE} loaded=${tags.length} ` +
        `withArr=${withArrs} withCommune=${withCommunes}`,
    )
    for (let i = 0; i < Math.min(3, tags.length); i++) {
      const t = tags[i]
      console.log(
        `[feed/generate] tag[${i}] id=${t.videoId} ` +
          `arr=${JSON.stringify(t.arrondissements)} ` +
          `com=${JSON.stringify(t.communes)}`,
      )
    }
    return tags
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
    for (const arr of qMap.get(id) ?? []) out.add(arr)
  }
  return [...out].sort((a, b) => a - b)
}

// ─── Agency map (spec) ───────────────────────────────────────────────────

/**
 * Prix plancher /m² par arrondissement (€/m², ordre de grandeur 2026).
 * Sert à brider la génération LLM qui sinon sort des biens à 5 000 €/m²
 * dans le 7e. Lu par buildUserPrompt pour exposer une fourchette
 * réaliste au modèle.
 */
const PRICE_FLOORS: Record<number, number> = {
  1: 13000, 2: 12000, 3: 12000, 4: 13000,
  5: 12000, 6: 15000, 7: 16000, 8: 14000,
  9: 11000, 10: 10000, 11: 10000, 12: 9000,
  13: 8500, 14: 9000, 15: 10000, 16: 13000,
  17: 11000, 18: 9500, 19: 8500, 20: 8500,
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
  const requestedCommunes = communeIdsToNames(snapshot.communeIds)
  const byGeoOnly = tags.filter((t) => geoMatch(snapshot, t))
  console.log(
    `[feed/generate] match input: requestedArrs=${JSON.stringify(requestedArrs)} ` +
      `(arr=${JSON.stringify(snapshot.arrondissementIds ?? [])} ` +
      `quartier=${JSON.stringify(snapshot.quartierIds ?? [])} ` +
      `iris=${(snapshot.irisIds ?? []).length}) ` +
      `requestedCommunes=${JSON.stringify(requestedCommunes)} ` +
      `budgetMax=${snapshot.budgetMax ?? '∞'} minSurface=${snapshot.minSurface ?? 0} ` +
      `| ${byGeoOnly.length}/${tags.length} vidéos passent le filtre géo`,
  )

  // ─── LOG 3 : verdict arrMatch vidéo par vidéo ──────────────────────
  // Affiche pour CHAQUE vidéo du fichier : videoId, ses arrondissements
  // tagués, et true/false selon que ses arrs ∩ requestedArrs ≠ ∅.
  // Une dimension non spécifiée par l'utilisateur n'accorde plus de match
  // implicite — cf. geoMatch après fix du bug 26/26.
  for (const tag of tags) {
    const arrHit =
      requestedArrs.length > 0 &&
      tag.arrondissements.some((a) => requestedArrs.includes(a))
    const communeHit =
      requestedCommunes.length > 0 &&
      tag.communes.some((c) => requestedCommunes.includes(c))
    console.log(
      `[feed/generate] video ${tag.videoId} arr=${JSON.stringify(
        tag.arrondissements,
      )} → arrMatch=${arrHit}${communeHit ? ' communeMatch=true' : ''}`,
    )
  }

  const finalize = (picked: VideoTag[], tier: string): VideoTag[] => {
    const sliced = picked.slice(0, MAX_FICHES)
    console.log(
      `[feed/generate] tier=${tier} picked=${sliced.length} ids=[` +
        sliced.map((v) => v.videoId).join(', ') +
        ']',
    )
    return sliced
  }

  // 1. Match strict
  let res = tags.filter(
    (tag) =>
      geoMatch(snapshot, tag) &&
      tag.priceRange[0] <= budget &&
      tag.surfaceRange[1] >= surface,
  )
  if (res.length >= 3) return finalize(res, '1-strict')

  // 2. Géo exacte sans budget/surface
  res = byGeoOnly
  if (res.length >= 3) return finalize(res, '2-geo-only')

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
    console.log(
      `[feed/generate] tier=3 nearby=${JSON.stringify([...nearby].sort((a, b) => a - b))} ` +
        `match=${res.length}`,
    )
    if (res.length >= 2) return finalize(res, '3-proximity')
  }

  // 4. Fallback total
  console.warn('[feed/generate] tier=4-fallback aucune vidéo proche, retour de toutes les vidéos')
  return finalize(tags, '4-fallback')
}

// ─── LLM generation ──────────────────────────────────────────────────────

// Schéma demandé au LLM — tenu volontairement court pour rester sous
// max_tokens=1200 avec 6 fiches. Les champs annexes (subtitle, bedrooms,
// totalFloors, terraceSurface, guardian) sont dérivés côté serveur.
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
  luminosity: number
  charm: number
  quietness: number
  outdoorUsability: number
  description: string
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
  targetSurface: number
  maxSurface: number
  targetPrice: number
  maxPrice: number
  targetRooms: number
  maxRooms: number
}

function buildVideoContext(snapshot: BriefSnapshot, video: VideoTag): VideoContext {
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

  return {
    videoId: video.videoId,
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

  // Repère prix moyen secteur — toujours dans le prompt comme guide, en
  // plus des bornes par fiche, pour rester réaliste sur le marché parisien.
  const avgPricePerSqm =
    arrs.length > 0
      ? Math.round(
          arrs.reduce((s, a) => s + (PRICE_FLOORS[a] ?? 10000), 0) / arrs.length,
        )
      : 10000

  // Contraintes par fiche : intersection brief ∩ vidéo. C'est le coeur
  // de la cohérence fiche/vidéo — l'ordre du tableau de retour DOIT
  // correspondre à l'ordre des contextes ci-dessous.
  const contexts = videos.map((v) => buildVideoContext(snapshot, v))
  const constraintsBlock = contexts
    .map(
      (c, i) =>
        `Fiche ${i + 1}: surface ${c.targetSurface}-${c.maxSurface} m² · ` +
        `prix ${c.targetPrice}-${c.maxPrice} € · ` +
        `pièces ${c.targetRooms}-${c.maxRooms}`,
    )
    .join('\n')

  return `Génère ${n} fiches de biens immobiliers fictifs DANS CET ORDRE EXACT.
Chaque fiche a SES PROPRES contraintes — ne pas mélanger les fiches.

Zone : ${zonesDescription}
Type : ${types}
Prix moyen secteur : ${avgPricePerSqm} €/m²

Contraintes par fiche (À RESPECTER IMPÉRATIVEMENT, jamais hors borne) :
${constraintsBlock}

Critères souhaités : ${desired.join(', ') || 'aucun'}
Critères obligatoires : ${mandatory.join(', ') || 'aucun'}

Format JSON — tableau de ${n} objets DANS CET ORDRE EXACT (un par fiche ci-dessus) :
{"title":"string","address":"string","price":number,"surface":number,"rooms":number,"floor":number,"propertyType":"appartement|maison|loft|atelier","elevator":boolean,"terrace":boolean,"balcony":boolean,"cellar":boolean,"parking":boolean,"dpe":"A|B|C|D|E|F|G","luminosity":number,"charm":number,"quietness":number,"outdoorUsability":number,"description":"string — 1 phrase courte"}

Les 4 scores sont entre 0 et 1. Chaque fiche distincte (adresses différentes).

CONTRAINTES STRICTES :
- L'adresse DOIT être située dans l'une des zones listées ci-dessus, et nulle part ailleurs.
- Pour Paris, format "<numéro> <rue>, 750<NN> Paris" (ex: "12 rue de Passy, 75016 Paris" pour le 16e). Pas de "75e" ni de "Paris 75NNN".
- Pour les communes, format "<numéro> <rue>, <commune>".
- Surface, prix et pièces de chaque fiche DOIVENT être dans la fourchette indiquée pour cette fiche-là.`
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

async function callLlm(snapshot: BriefSnapshot, videos: VideoTag[]): Promise<Fiche[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[feed/generate] ANTHROPIC_API_KEY missing — returning [].')
    return []
  }
  const anthropic = new Anthropic({ apiKey })
  const userPrompt = buildUserPrompt(snapshot, videos, videos.length)
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
  chapters: ChapterRow[] | null,
  matchScore01: number,
  isExcluded: boolean,
  id: string,
  dbAgency: { name: string; logo: string | null } | null,
): ViewProperty {
  const arrNum = parseArrFromAddress(fiche.address)
  const arrLabel = arrondissementLabel(arrNum) || fiche.address
  // Agence réelle du bien (ré-assignée par localisation, avec logo Cloudinary).
  // Fallback sur le mapping arrondissement si la vidéo n'est pas reliée en DB.
  const agencyName = dbAgency?.name ?? resolveAgencyName(fiche.address)
  const agencyLogo = dbAgency?.logo ?? null

  const bedrooms = derivedBedrooms(fiche.rooms)
  const subtitle = `Appartement · T${fiche.rooms} · ${fiche.surface} m²`

  return {
    id,
    title: fiche.title,
    subtitle,
    arrondissement: arrLabel,
    agentName: agencyName,
    agencyName,
    agencyLogo,
    price: fiche.price,
    surface: fiche.surface,
    rooms: fiche.rooms,
    bedrooms,
    location: fiche.address,
    district: arrLabel,
    description: fiche.description,
    tags: [],
    features: [],
    dpe: fiche.dpe,
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

  // ─── LOG 1 : valeurs brutes telles que reçues dans le body POST ─────
  // Pas de reconstruction : on imprime ce qui arrive réellement côté serveur.
  console.log(
    `[feed/generate] raw body — ` +
      `selectedArrIds=${JSON.stringify(snapshot.arrondissementIds)} ` +
      `selectedCommuneIds=${JSON.stringify(snapshot.communeIds)} ` +
      `selectedQuartierIds=${JSON.stringify(snapshot.quartierIds)} ` +
      `selectedIrisIds=${JSON.stringify(snapshot.irisIds)}`,
  )

  // ─── LOG 2 : requestedArrs après parsing arr-N → N ──────────────────
  // Référence exacte au fait que l'utilisateur attend [16] pour Paris 16.
  const parsedRequestedArrs = (snapshot.arrondissementIds ?? [])
    .map((id) => parseInt(id.replace('arr-', ''), 10))
    .filter((n) => Number.isFinite(n))
  console.log(
    `[feed/generate] parsedRequestedArrs (depuis selectedArrIds uniquement) = ` +
      JSON.stringify(parsedRequestedArrs),
  )
  console.log(
    `[feed/generate] resolveAllArrs (arr + quartier + iris combinés) = ` +
      JSON.stringify(resolveAllArrs(snapshot)),
  )

  const tags = readTagsFile()
  if (tags.length === 0) {
    // Tag file vide / manquant — la page feed retombera sur /api/properties.
    return NextResponse.json([])
  }

  const matchedVideos = pickMatchedVideos(snapshot, tags)
  console.log(
    `[feed/generate] tags=${tags.length} matched=${matchedVideos.length} ` +
      `(arr=${(snapshot.arrondissementIds ?? []).join(',') || '-'}, ` +
      `com=${(snapshot.communeIds ?? []).join(',') || '-'}, ` +
      `budget≤${snapshot.budgetMax ?? '∞'}, surf≥${snapshot.minSurface ?? 0})`,
  )

  // Charge la map videoId → chapitres + agence (nom/logo) pour réinjecter au
  // moment de la projection. Chaque fiche est bâtie à partir d'une vidéo, qui
  // correspond à un bien DB : on prend SON agence (déjà ré-assignée par
  // localisation) plutôt qu'un mapping arrondissement hardcodé sans logo.
  // Un seul findMany pour les ~30 biens.
  const dbProps = await prisma.property.findMany({
    where: { videoAnalysis: { isNot: null }, videoUrl: { not: null } },
    select: {
      videoUrl: true,
      videoAnalysis: { select: { chapitres: true } },
      agency: { select: { name: true, logo: true } },
    },
  })
  const chaptersByVideoId = new Map<string, ChapterRow[] | null>()
  const agencyByVideoId = new Map<string, { name: string; logo: string | null }>()
  for (const p of dbProps) {
    if (!p.videoUrl) continue
    const vid = extractCloudinaryId(p.videoUrl)
    const raw = p.videoAnalysis?.chapitres
    chaptersByVideoId.set(
      vid,
      Array.isArray(raw) && raw.length > 0 ? (raw as unknown as ChapterRow[]) : null,
    )
    if (p.agency) agencyByVideoId.set(vid, { name: p.agency.name, logo: p.agency.logo })
  }

  let fiches: Fiche[] = []
  try {
    fiches = await callLlm(snapshot, matchedVideos)
  } catch (error) {
    console.error('[feed/generate] LLM call failed:', error)
    return NextResponse.json({ error: 'llm_failed' }, { status: 500 })
  }

  if (fiches.length === 0) {
    console.warn('[feed/generate] LLM returned 0 fiches, falling back to empty.')
    return NextResponse.json([])
  }

  const brief = buildBriefFromSnapshot(snapshot)
  const scored: ViewProperty[] = fiches.map((fiche, i) => {
    const profile = ficheToProfile(fiche, i)
    const result = matchProperty(profile, brief)
    const video = matchedVideos[i % matchedVideos.length]
    const chapters = chaptersByVideoId.get(video.videoId) ?? null
    const dbAgency = agencyByVideoId.get(video.videoId) ?? null
    return ficheToView(
      fiche,
      video,
      chapters,
      result.global_score / 100,
      result.is_excluded,
      profile.property_id,
      dbAgency,
    )
  })

  const feed = scored
    .filter((p) => !p.isExcluded)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))

  console.log(
    `[feed/generate] fiches=${fiches.length} scored=${scored.length} ` +
      `kept=${feed.length} top=${feed[0]?.matchScore?.toFixed(2) ?? '-'}`,
  )

  return NextResponse.json(feed)
}
