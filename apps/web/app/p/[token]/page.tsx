/**
 * P0 — Page publique de partage d'un bien : `/p/<token>`.
 *
 * C'est la munition qu'un agent colle dans le fil WhatsApp de son client :
 * un lien par bien, qui ouvre la visite vidéo, donne accès à la fiche
 * complète, puis propose de décrire sa recherche. La page vit par le partage,
 * pas par Google — d'où `noindex`.
 *
 * Trois issues, jamais d'erreur nue :
 *   - bien trouvé, `isShareable`, statut partageable → la visite ;
 *   - tout le reste (token inconnu, partage coupé, bien archivé, base
 *     injoignable) → la page morte, qui convertit quand même ;
 *   - aucune trace technique visible, aucun 500.
 */

import { cache } from 'react'
import type { Metadata } from 'next'
import Image from 'next/image'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { toViewProperty } from '@/lib/serializers/property'
import type { Property } from '@/lib/types'
import {
  DEFAULT_TYPE_LABEL,
  OG_DESCRIPTION,
  SHARE_THUMBNAIL_HEIGHT,
  SHARE_THUMBNAIL_WIDTH,
  buildShareTitle,
  deriveSharePoster,
  deriveShareThumbnail,
  isCrawlerUserAgent,
  isShareableStatus,
} from '@/lib/shareLink'
import ShareVideoView, { type SharedPropertyView } from './ShareVideoView'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Bornes de stockage — on ne garde pas des chaînes arbitrairement longues. */
const MAX_REF_LENGTH = 64
const MAX_USER_AGENT_LENGTH = 512
/** Aucun token émis ne dépasse cette taille : au-delà, inutile d'interroger la base. */
const MAX_TOKEN_LENGTH = 64

/**
 * Résolution du token. `cache()` déduplique l'appel entre `generateMetadata`
 * et le rendu de la page — une seule requête par requête HTTP.
 *
 * On charge le bien ENTIER : la fiche complète (`PropertyDetailSheet`, la même
 * que dans l'app) est ouverte depuis cette page et attend le view-model au
 * complet.
 *
 * Renvoie `null` pour TOUTES les issues mortes, y compris une base
 * injoignable : le visiteur voit une page soignée, jamais une stack trace.
 */
const resolveSharedProperty = cache(async (token: string) => {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null
  try {
    const property = await prisma.property.findUnique({
      where: { shareToken: token },
      include: { agency: { select: { name: true, logo: true } } },
    })
    if (!property) return null
    if (!property.isShareable) return null
    if (!isShareableStatus(property.statut)) return null
    return property
  } catch {
    return null
  }
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const property = await resolveSharedProperty(token)

  // La page vit par le partage : jamais d'indexation, dans les deux issues.
  const robots = { index: false, follow: false }

  if (!property) {
    return { title: 'SHOMEE', description: OG_DESCRIPTION, robots }
  }

  const title = buildShareTitle(property)
  const thumbnail = deriveShareThumbnail(property.videoUrl)
  // Pas de vignette dérivable → pas d'`og:image` du tout, plutôt qu'une image
  // cassée dans la conversation. Les dimensions sont déclarées : sans elles,
  // WhatsApp rétrograde l'aperçu en petite vignette carrée.
  const images = thumbnail
    ? [{ url: thumbnail, width: SHARE_THUMBNAIL_WIDTH, height: SHARE_THUMBNAIL_HEIGHT }]
    : undefined

  return {
    title,
    description: OG_DESCRIPTION,
    robots,
    openGraph: {
      title,
      description: OG_DESCRIPTION,
      siteName: 'SHOMEE',
      type: 'website',
      images,
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title,
      description: OG_DESCRIPTION,
      images: thumbnail ? [thumbnail] : undefined,
    },
  }
}

/**
 * Comptage des vues. Une ligne par rendu de la VISITE (jamais de la page
 * morte). Les crawlers d'aperçu sont enregistrés mais marqués : coller le lien
 * dans WhatsApp déclenche un hit avant que quiconque ait tapé dessus.
 *
 * Attendue volontairement — c'est un unique INSERT, et une promesse laissée
 * flottante serait tuée avec la lambda, donc jamais écrite. Le try/catch tient
 * la garantie qui compte : le comptage ne fait jamais échouer le rendu.
 */
async function recordShareView(propertyId: string, ref: string | null, userAgent: string | null) {
  try {
    await prisma.shareView.create({
      data: {
        propertyId,
        ref: ref ? ref.slice(0, MAX_REF_LENGTH) : null,
        userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
        isBot: isCrawlerUserAgent(userAgent),
      },
    })
  } catch {
    /* le comptage est un bonus, la visite est le produit */
  }
}

export default async function SharedPropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ token }, query] = await Promise.all([params, searchParams])
  const property = await resolveSharedProperty(token)

  if (!property) return <DeadShareLink />

  const rawRef = query.ref
  const ref = (Array.isArray(rawRef) ? rawRef[0] : rawRef) ?? null
  const userAgent = (await headers()).get('user-agent')

  await recordShareView(property.id, ref, userAgent)

  // UNE seule source pour le nom de l'enseigne : l'enregistrement Agency.
  // `Property.agentName` est un champ libre rempli différemment selon le
  // chemin de création (libellé « Kretz · quartier » au seed, nom de l'agent
  // à l'import LLM, nom d'agence à la génération de feed) : il dériverait
  // d'un bien à l'autre. Ni la visite ni la fiche ne le lisent.
  const agencyName = property.agency.name.trim()
  const agencyLogo = property.agency.logo

  const view: SharedPropertyView = {
    typeLabel: DEFAULT_TYPE_LABEL,
    rooms: property.rooms,
    surface: property.surface,
    price: property.price,
    arrondissement: property.arrondissement,
    district: property.district,
    videoUrl: property.videoUrl,
    posterUrl: deriveSharePoster(property.videoUrl),
    imageUrl: property.imageUrlFallback,
    agencyName,
    agencyLogo,
  }

  // View-model complet pour la fiche — celle de l'app, à l'identique.
  const fullProperty: Property = {
    ...toViewProperty(property),
    agencyName,
    agencyLogo,
  }

  return <ShareVideoView property={view} fullProperty={fullProperty} refParam={ref} />
}

/**
 * Page morte — token inconnu, partage coupé, bien archivé. Même un lien mort
 * convertit : on annonce la fin de l'histoire, puis on ouvre la suivante.
 */
function DeadShareLink() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-8 text-center"
      style={{ background: '#FDF5F2' }}
    >
      <Image
        src="/logo terracotta.png"
        alt="SHOMEE"
        width={64}
        height={73}
        priority
        className="object-contain"
      />

      <div>
        <h1 className="text-[20px] font-bold text-neutral-900 leading-tight tracking-tight">
          Ce bien n’est plus disponible.
        </h1>
        <p className="text-[13.5px] text-neutral-600 mt-2 max-w-[300px] mx-auto leading-relaxed">
          Mais d’autres vous attendent — décrivez votre recherche en 2 minutes.
        </p>
      </div>

      <a
        href="/onboarding"
        className="block w-full max-w-[320px] py-3.5 rounded-2xl font-semibold text-[15.5px] text-white text-center transition-opacity active:opacity-90"
        style={{ backgroundColor: '#A64B27' }}
      >
        Décrire ma recherche
      </a>
    </div>
  )
}
