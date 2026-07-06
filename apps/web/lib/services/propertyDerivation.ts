/**
 * Shomee — TikTok Studio, dérivation de biens (Jalon 2).
 *
 * LE PONT NEUF : à partir du profil déduit d'UNE vidéo TikTok (caption + champs
 * extraits), demande à Claude Haiku N biens démo plausibles, VARIÉS en zone et
 * budget mais TOUS cohérents en standing avec la vidéo source. Réutilise la
 * forme riche `GeneratedProperty` (~35 champs) et les gardes de cohérence
 * `coerceToProperty` de seed-synthetic-properties.ts.
 *
 * Aucun write ici — la fonction ne fait que PROPOSER. Le write est le Jalon 3.
 *
 * ⚠️ SERVEUR UNIQUEMENT — importe @anthropic-ai/sdk.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  DpeRating,
  ExtractedInfo,
  GeneratedProperty,
  NumRange,
  Orientation,
} from '@/lib/admin/tiktokStudioTypes'
import { VALID_DPE, VALID_ORIENT, COMMUNES } from '@/lib/admin/tiktokStudioTypes'

type Ranges = { price?: NumRange; surface?: NumRange; rooms?: NumRange }

function clampNum(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

const MODEL = 'claude-haiku-4-5-20251001'
const MIN_COUNT = 3
const MAX_COUNT = 14

// ─────────────────────────────────────────────────────────────────────────────
// N suggéré selon la richesse de la caption : plus la source est informative,
// plus on propose de variantes. Clampé [MIN_COUNT, MAX_COUNT].
// ─────────────────────────────────────────────────────────────────────────────

export function suggestCount(caption: string, extracted: ExtractedInfo): number {
  let score = 6
  if (caption.trim().length > 200) score += 2
  else if (caption.trim().length < 60) score -= 2
  const filled = [
    extracted.price,
    extracted.surface,
    extracted.rooms,
    extracted.bedrooms,
    extracted.dpe,
    extracted.floor,
  ].filter((v) => v != null).length
  score += Math.round(filled / 2)
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, score))
}

export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 6
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(n)))
}

// ─────────────────────────────────────────────────────────────────────────────
// Coercition / gardes — port fidèle de seed-synthetic-properties.ts.
// ─────────────────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (n < 0.1) return 0.1
  if (n > 1) return 1
  return n
}

export function coerceToProperty(raw: unknown): GeneratedProperty | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>

  const str = (k: string, fallback = ''): string =>
    typeof v[k] === 'string' && (v[k] as string).trim().length > 0
      ? (v[k] as string).trim()
      : fallback
  const num = (k: string, fallback: number): number =>
    typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : fallback
  const bool = (k: string, fallback = false): boolean =>
    typeof v[k] === 'boolean' ? (v[k] as boolean) : fallback
  const numOrNull = (k: string): number | null =>
    typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : null
  const dpeOf = (k: string, fallback: DpeRating): DpeRating =>
    VALID_DPE.includes(v[k] as DpeRating) ? (v[k] as DpeRating) : fallback

  const orient: Orientation[] = Array.isArray(v.orientationStructured)
    ? (v.orientationStructured as unknown[]).filter(
        (o): o is Orientation => typeof o === 'string' && VALID_ORIENT.includes(o as Orientation),
      )
    : []

  const tags = Array.isArray(v.tags)
    ? (v.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : []
  const features = Array.isArray(v.features)
    ? (v.features as unknown[]).filter((t): t is string => typeof t === 'string')
    : []

  const title = str('title')
  const arrondissement = str('arrondissement')
  if (!title || !arrondissement) return null

  return {
    title,
    arrondissement,
    district: str('district', arrondissement),
    subtitle: str('subtitle', title),
    location: str('location', str('district', arrondissement)),
    address: str('address'),
    price: Math.round(num('price', 500000)),
    surface: num('surface', 60),
    rooms: Math.round(num('rooms', 3)),
    bedrooms: Math.round(num('bedrooms', 1)),
    description: str('description', title),
    dpe: dpeOf('dpe', 'D'),
    ges: dpeOf('ges', 'D'),
    floor: Math.round(num('floor', 2)),
    totalFloors: Math.round(num('totalFloors', 6)),
    hasElevator: bool('hasElevator'),
    hasTerrace: bool('hasTerrace'),
    terraceSurfaceM2: numOrNull('terraceSurfaceM2'),
    hasBalcony: bool('hasBalcony'),
    balconySurfaceM2: numOrNull('balconySurfaceM2'),
    hasGarden: bool('hasGarden'),
    hasCellar: bool('hasCellar'),
    hasParking: bool('hasParking'),
    hasConcierge: bool('hasConcierge'),
    isGroundFloor: bool('isGroundFloor'),
    isQuietStreet: bool('isQuietStreet', true),
    orientationStructured: orient,
    yearBuilt: Math.round(num('yearBuilt', 1900)),
    monthlyCharges: Math.round(num('monthlyCharges', 250)),
    propertyTax: Math.round(num('propertyTax', 1500)),
    luminosity: clamp01(num('luminosity', 0.7)),
    quietness: clamp01(num('quietness', 0.7)),
    charm: clamp01(num('charm', 0.7)),
    spaciousness: clamp01(num('spaciousness', 0.7)),
    livingQuality: clamp01(num('livingQuality', 0.7)),
    outdoorUsability: clamp01(num('outdoorUsability', 0.5)),
    tags,
    features,
    neighborhoodVibe: str('neighborhoodVibe', ''),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt de dérivation — LE cœur neuf. Ancré sur le profil de la vidéo source.
// ─────────────────────────────────────────────────────────────────────────────

function sourceProfileBlock(caption: string, extracted: ExtractedInfo): string {
  const lines: string[] = []
  lines.push(`- Titre déduit : ${extracted.title}`)
  lines.push(`- Localisation source : ${extracted.arrondissement}${extracted.district ? ` — ${extracted.district}` : ''}`)
  if (extracted.price != null) lines.push(`- Prix source : ${extracted.price} €`)
  if (extracted.surface != null) lines.push(`- Surface source : ${extracted.surface} m²`)
  if (extracted.rooms != null) lines.push(`- Pièces source : ${extracted.rooms}`)
  if (extracted.bedrooms != null) lines.push(`- Chambres source : ${extracted.bedrooms}`)
  if (extracted.dpe) lines.push(`- DPE source : ${extracted.dpe}`)
  if (extracted.tags.length) lines.push(`- Tags source : ${extracted.tags.join(', ')}`)
  const caveats: string[] = []
  if (extracted.hasTerrace) caveats.push('terrasse')
  if (extracted.hasBalcony) caveats.push('balcon')
  if (extracted.hasParking) caveats.push('parking')
  if (extracted.hasElevator) caveats.push('ascenseur')
  if (caveats.length) lines.push(`- Atouts visibles : ${caveats.join(', ')}`)
  return lines.join('\n')
}

function buildDerivationPrompt(
  count: number,
  caption: string,
  extracted: ExtractedInfo,
  zones: string[],
  ranges: Ranges,
): string {
  const anyRange = ranges.price || ranges.surface || ranges.rooms
  const budgetRule = anyRange
    ? `- FOURCHETTES (IMPÉRATIF) : respecte STRICTEMENT ces bornes pour CHAQUE bien${
        ranges.price ? `\n  · prix entre ${ranges.price.min} € et ${ranges.price.max} €` : ''
      }${
        ranges.surface
          ? `\n  · surface entre ${ranges.surface.min} et ${ranges.surface.max} m²`
          : ''
      }${
        ranges.rooms ? `\n  · nombre de pièces entre ${ranges.rooms.min} et ${ranges.rooms.max}` : ''
      }\n  Fais varier les valeurs À L'INTÉRIEUR de ces bornes ; garde un prix/m² réaliste.`
    : `- BUDGETS variés mais cohérents : fais varier prix et surface autour du profil source (±40 % environ), en gardant un prix/m² réaliste pour chaque zone choisie.`
  const zoneRule =
    zones.length > 0
      ? `- ZONES — CONTRAINTE STRICTE : utilise EXCLUSIVEMENT ces zones autorisées, AUCUNE autre : ${zones.join(', ')}.
  Le champ "arrondissement" de CHAQUE bien doit être EXACTEMENT l'une de ces valeurs (recopie la chaîne à l'identique, casse et accents compris). ${
    zones.length === 1
      ? `Une seule zone autorisée : TOUS les biens sont dans "${zones[0]}".`
      : `Répartis les ${count} biens de façon équilibrée sur ces ${zones.length} zones.`
  }`
      : `- ZONES variées mais crédibles pour ce standing : répartis les biens sur plusieurs arrondissements parisiens (format "Paris Xème") ET quelques communes de proche banlieue de standing comparable parmi : ${COMMUNES.join(', ')}. Ne mets pas tous les biens dans le même arrondissement.`
  return `Tu es un expert immobilier parisien. À partir d'UNE vidéo immobilière réelle, tu génères des biens de DÉMO plausibles pour une app immobilière.

PROFIL DE LA VIDÉO SOURCE (déduit de sa caption) :
${sourceProfileBlock(caption, extracted)}

CAPTION BRUTE :
"""
${caption.slice(0, 600)}
"""

MISSION : génère EXACTEMENT ${count} biens dérivés de ce profil.

RÈGLES DE COHÉRENCE (impératives) :
- Même GAMME/STANDING que la source. Si la source est un bien de luxe/haussmannien haut de gamme, ne génère JAMAIS de studio bas de gamme ; si c'est un bien modeste, ne génère pas d'hôtel particulier. Reste dans la fourchette de standing de la vidéo.
- Type de bien globalement cohérent (un appartement familial reste un appartement familial ; ne dérive pas un loft industriel d'une vidéo haussmannienne).

RÈGLES DE VARIÉTÉ (impératives) :
${zoneRule}
${budgetRule}
- Varie les styles cohérents avec le standing (haussmannien, années 30, contemporain rénové, pierre de taille…), les étages, les orientations, les atouts extérieurs.

Retourne UNIQUEMENT un JSON array valide, aucun texte autour, aucun markdown.
Chaque bien doit avoir EXACTEMENT ces champs :
{
  "title": string,
  "arrondissement": string,   // OBLIGATOIREMENT une des zones autorisées ci-dessus (copie exacte)
  "district": string,         // quartier précis
  "subtitle": string,         // ex: "Appartement haussmannien avec balcon"
  "location": string,         // même que district
  "address": string,          // adresse exacte PLAUSIBLE : numéro + vraie rue de la zone + CP + ville (ex: "12 rue Saint-Dominique, 75007 Paris"). DOIT être située dans l'arrondissement/commune du bien
  "price": number,            // cohérent avec le standing source
  "surface": number,
  "rooms": number,
  "bedrooms": number,
  "description": string,      // 3-4 phrases réalistes
  "dpe": "A"|"B"|"C"|"D"|"E"|"F"|"G",
  "ges": "A"|"B"|"C"|"D"|"E"|"F"|"G",
  "floor": number,
  "totalFloors": number,
  "hasElevator": boolean,
  "hasTerrace": boolean,
  "terraceSurfaceM2": number|null,
  "hasBalcony": boolean,
  "balconySurfaceM2": number|null,
  "hasGarden": boolean,
  "hasCellar": boolean,
  "hasParking": boolean,
  "hasConcierge": boolean,
  "isGroundFloor": boolean,
  "isQuietStreet": boolean,
  "orientationStructured": ("north"|"south"|"east"|"west")[],
  "yearBuilt": number,        // entre 1850 et 2020
  "monthlyCharges": number,   // entre 100 et 1200
  "propertyTax": number,
  "luminosity": number,       // 0.1 à 1.0
  "quietness": number,
  "charm": number,
  "spaciousness": number,
  "livingQuality": number,
  "outdoorUsability": number,
  "tags": string[],           // 3-6 tags en anglais : outdoor/living/building/ambiance/structure/location
  "features": string[],       // 3-5 features en français
  "neighborhoodVibe": string
}

Assure la cohérence interne : hasTerrace:true ⇒ terraceSurfaceM2 non null ; isGroundFloor:true ⇒ floor:0 ; hasBalcony:true ⇒ balconySurfaceM2 non null.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Appel LLM.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeriveInput {
  caption: string
  extracted: ExtractedInfo
  count: number
  /** Zones autorisées (arrondissements/communes cochés). Vide = variété libre. */
  zones: string[]
  /** Fourchettes pré-réglées sur la vidéo (prix / surface / pièces). */
  priceRange?: NumRange
  surfaceRange?: NumRange
  roomsRange?: NumRange
}

export async function deriveProperties(
  anthropic: Anthropic,
  input: DeriveInput,
): Promise<GeneratedProperty[]> {
  const count = clampCount(input.count)
  const zones = input.zones ?? []
  const ranges: Ranges = {
    price: input.priceRange,
    surface: input.surfaceRange,
    rooms: input.roomsRange,
  }
  const resp = await anthropic.messages.create({
    model: MODEL,
    // ~500 tokens/bien pour la forme riche, + marge.
    max_tokens: Math.min(16000, 1500 + count * 700),
    messages: [
      {
        role: 'user',
        content: buildDerivationPrompt(count, input.caption, input.extracted, zones, ranges),
      },
    ],
  })

  const text = resp.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('')
    .trim()
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error("Claude n'a pas retourné de tableau JSON")
  const arr = JSON.parse(match[0]) as unknown[]
  if (!Array.isArray(arr)) throw new Error("Sortie Claude n'est pas un tableau")

  const props = arr
    .map(coerceToProperty)
    .filter((p): p is GeneratedProperty => p !== null)

  // Filet de sécurité : si le LLM sort d'une zone autorisée malgré la consigne,
  // on rabat l'arrondissement sur une zone cochée (round-robin). Garantit que
  // le libellé affiché == une zone validée par Olivier (le point de la feature).
  if (zones.length > 0) {
    const allowed = new Set(zones)
    let k = 0
    for (const p of props) {
      if (!allowed.has(p.arrondissement)) {
        const z = zones[k % zones.length]
        if (p.location === p.arrondissement) p.location = z
        p.arrondissement = z
        k++
      }
    }
  }

  // Filet de sécurité fourchettes : on force chaque valeur dans ses bornes, quoi
  // que le LLM ait produit — garantit le respect des filigranes de la vidéo.
  for (const p of props) {
    if (ranges.price) p.price = Math.round(clampNum(p.price, ranges.price.min, ranges.price.max))
    if (ranges.surface) p.surface = clampNum(p.surface, ranges.surface.min, ranges.surface.max)
    if (ranges.rooms) {
      p.rooms = Math.round(clampNum(p.rooms, ranges.rooms.min, ranges.rooms.max))
      // Cohérence : pas plus de chambres que (pièces − 1).
      if (p.bedrooms > p.rooms - 1) p.bedrooms = Math.max(0, p.rooms - 1)
    }
  }

  return props
}
