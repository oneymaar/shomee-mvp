/**
 * P0 — Partage de bien : briques serveur du lien public `/p/<token>`.
 *
 * Quatre responsabilités, volontairement réunies dans un seul module pour que
 * la route API et la page publique partagent exactement les mêmes règles :
 *   1. la fabrication du token non devinable ;
 *   2. les statuts qui donnent droit à une page publique ;
 *   3. le libellé du bien (titre OG + texte de partage) ;
 *   4. la dérivation de la vignette Cloudinary et la reconnaissance des
 *      crawlers d'aperçu.
 *
 * Ce module vit côté serveur (`node:crypto`) — il ne doit jamais être importé
 * depuis un composant client.
 */

import { randomBytes } from 'node:crypto'
import { PropertyStatus } from '@prisma/client'
import { formatArrondissement } from '@shomee/core/utils/format'

/** Longueur du token de partage. 14 caractères sur 58 symboles ≈ 2^82. */
export const SHARE_TOKEN_LENGTH = 14

/**
 * Base62 débarrassée des glyphes ambigus (`0`, `O`, `l`, `I`) : un lien lu à
 * voix haute ou recopié à la main reste transcriptible. 58 symboles.
 */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Plus grand multiple de 58 tenant dans un octet. Tout octet au-delà est
 * rejeté plutôt que replié par modulo : sans ce filtre les premiers symboles
 * de l'alphabet sortiraient plus souvent que les derniers.
 */
const REJECTION_CEILING = 256 - (256 % ALPHABET.length)

/**
 * Token de partage aléatoire, `crypto` de Node — aucune dépendance ajoutée.
 * Tire par paquets d'octets et rejette les valeurs biaisées jusqu'à remplir
 * la longueur demandée.
 */
export function generateShareToken(length: number = SHARE_TOKEN_LENGTH): string {
  let out = ''
  while (out.length < length) {
    const buf = randomBytes(length * 2)
    for (const byte of buf) {
      if (byte >= REJECTION_CEILING) continue
      out += ALPHABET[byte % ALPHABET.length]
      if (out.length === length) break
    }
  }
  return out
}

/**
 * Statuts qui donnent droit à une page publique.
 *
 * Tout sauf `ARCHIVED`. Un agent partage aussi des biens qui ne sont PAS sur
 * la plateforme — avant-première, mandat off-market montré à trois clients
 * choisis : c'est même l'usage le plus précieux du lien. `ARCHIVED` reste
 * exclu : un bien retiré doit rendre une page morte, pas une visite.
 */
export const SHAREABLE_STATUSES: PropertyStatus[] = [
  PropertyStatus.DRAFT,
  PropertyStatus.PUBLISHED,
  PropertyStatus.UNPUBLISHED,
]

export function isShareableStatus(statut: PropertyStatus): boolean {
  return SHAREABLE_STATUSES.includes(statut)
}

/** Le modèle ne porte pas encore de type de bien ; l'app affiche « Appartement »
 *  partout (cf. PropertyOverlay). On reste cohérent plutôt que d'inventer. */
export const DEFAULT_TYPE_LABEL = 'Appartement'

/** Phrase canonique de la description OG — ne pas la réécrire. */
export const OG_DESCRIPTION = 'Visite en vidéo sur SHOMEE, la recherche immobilière en vidéo.'

export interface ShareLabelSource {
  rooms: number
  price: number
  district: string
  arrondissement: string
}

function formatPrice(price: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(price)} €`
}

/**
 * « Appartement 4 pièces — Le Marais · 2 450 000 € », en sautant proprement ce
 * qui manque. Sert à la fois de titre OG (l'aperçu WhatsApp) et de première
 * ligne du texte de partage : une seule source, aucun écart possible entre ce
 * que l'agent envoie et ce que la conversation affiche.
 */
export function buildShareTitle(property: ShareLabelSource): string {
  const rooms =
    property.rooms > 0
      ? `${property.rooms} ${property.rooms === 1 ? 'pièce' : 'pièces'}`
      : null
  const bien = [DEFAULT_TYPE_LABEL, rooms].filter(Boolean).join(' ')

  const quartier =
    property.district?.trim() ||
    (property.arrondissement?.trim()
      ? formatArrondissement(property.arrondissement.trim())
      : null) ||
    null
  const prix = property.price > 0 ? formatPrice(property.price) : null
  const contexte = [quartier, prix].filter(Boolean).join(' · ')

  return [bien, contexte].filter(Boolean).join(' — ') || 'SHOMEE'
}

/**
 * Texte qui accompagne le lien dans la feuille de partage iOS. WhatsApp le
 * colle tel quel puis déplie l'aperçu sous le message : deux lignes suffisent,
 * l'image et le prix arrivent par les métadonnées OG.
 */
export function buildShareText(property: ShareLabelSource): string {
  return `${buildShareTitle(property)}\nVisite en vidéo sur SHOMEE :`
}

/** Format d'aperçu attendu par WhatsApp, Messages et les réseaux : une carte
 *  large 1200×630. Sans dimensions imposées, une frame de vidéo verticale
 *  arrive en vignette carrée minuscule dans la conversation. */
export const SHARE_THUMBNAIL_WIDTH = 1200
export const SHARE_THUMBNAIL_HEIGHT = 630

/**
 * Vignette JPEG dérivée de l'URL vidéo Cloudinary : première frame (`so_0`)
 * recadrée au format carte, insérée juste après `/upload/`, extension
 * remplacée par `.jpg`. Même famille de transformation que `feed/generate`.
 *
 * Renvoie `null` dès que l'URL n'est pas une vidéo Cloudinary exploitable —
 * mieux vaut pas d'`og:image` du tout qu'une vignette cassée dans WhatsApp.
 */
export function deriveShareThumbnail(videoUrl: string | null | undefined): string | null {
  return deriveCloudinaryFrame(
    videoUrl,
    `so_0,w_${SHARE_THUMBNAIL_WIDTH},h_${SHARE_THUMBNAIL_HEIGHT},c_fill,f_jpg`,
  )
}

/**
 * Poster de la page publique : la MÊME première frame, mais au format natif de
 * la vidéo (vertical), simplement redimensionnée. Recadrer en 1200×630 comme
 * la vignette OG donnerait une bande centrale étirée en plein écran.
 */
export function deriveSharePoster(videoUrl: string | null | undefined): string | null {
  return deriveCloudinaryFrame(videoUrl, 'so_0,w_720,f_jpg')
}

/** Insère une transformation Cloudinary après `/upload/` et bascule en `.jpg`. */
function deriveCloudinaryFrame(
  videoUrl: string | null | undefined,
  transformation: string,
): string | null {
  if (!videoUrl) return null
  try {
    const url = new URL(videoUrl)
    if (!url.hostname.endsWith('cloudinary.com')) return null

    const marker = '/upload/'
    const at = url.pathname.indexOf(marker)
    if (at === -1) return null

    const head = url.pathname.slice(0, at + marker.length)
    const tail = url.pathname.slice(at + marker.length)
    if (!tail) return null

    // L'extension doit exister ET appartenir au dernier segment : une URL sans
    // extension (ou dont le point est dans un dossier) n'est pas dérivable.
    const lastSlash = tail.lastIndexOf('/')
    const lastDot = tail.lastIndexOf('.')
    if (lastDot <= lastSlash + 1) return null

    url.pathname = `${head}${transformation}/${tail.slice(0, lastDot)}.jpg`
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Crawlers d'aperçu de lien. Coller l'URL dans une conversation WhatsApp
 * déclenche un hit serveur avant même que quiconque ait tapé dessus : ces
 * vues sont enregistrées mais marquées, pour ne pas gonfler les statistiques.
 */
const CRAWLER_SIGNATURES = [
  'facebookexternalhit',
  'whatsapp',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'telegrambot',
  'googlebot',
  'bingbot',
  'discordbot',
  'skypeuripreview',
]

export function isCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return CRAWLER_SIGNATURES.some((sig) => ua.includes(sig))
}
