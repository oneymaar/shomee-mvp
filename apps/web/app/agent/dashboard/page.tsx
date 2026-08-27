import { prisma } from '@/lib/prisma'
import { PropertyStatus } from '@prisma/client'
import DashboardListClient from '@/components/agent/DashboardListClient'
import type { DashboardFilter } from '@/components/agent/DashboardFilterPills'
import { EnteteAgence, BandeauNotifications, Tuile } from '@/components/agent/EnteteAgence'
import { Crown } from 'lucide-react'
import Link from 'next/link'
import { requireAgentOrRedirect } from '@/lib/auth/agentGuard'
import { compterNotifications } from '@/lib/agent/notifications'
import { couleurs } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/**
 * « Il y a sept jours ». Isolée hors du composant : la règle de pureté du
 * compilateur React interdit Date.now() dans un corps de composant, sans faire
 * la différence avec un Server Component, exécuté une fois par requête.
 */
const depuisUneSemaine = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

function parseFilter(raw: string | string[] | undefined): DashboardFilter {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (v === 'draft' || v === 'published' || v === 'unpublished') return v
  return 'all'
}

export default async function AgentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>
}) {
  const { filter: filterParam } = await searchParams
  const initialFilter = parseFilter(filterParam)

  // Identité = la SESSION (cookie), plus jamais « le premier agent de la
  // base » : chacun ne voit que ses biens et ses fils.
  const agent = await requireAgentOrRedirect()

  const properties = await prisma.property.findMany({
    where: {
      createdByAgentId: agent.id,
      statut: { not: PropertyStatus.ARCHIVED },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      arrondissement: true,
      surface: true,
      price: true,
      statut: true,
      completionRate: true,
      videoUrl: true,
      imageUrlFallback: true,
      avantPremiere: true,
      mandatType: true,
      badges: true,
    },
  })

  const [archivedCount, notif] = await Promise.all([
    prisma.property.count({
      where: { createdByAgentId: agent.id, statut: PropertyStatus.ARCHIVED },
    }),
    compterNotifications(agent.id),
  ])

  const draftsCount    = properties.filter((p) => p.statut === PropertyStatus.DRAFT).length
  const publishedCount = properties.filter((p) => p.statut === PropertyStatus.PUBLISHED).length
  const activeCount    = properties.length
  // Vraies vues des 7 derniers jours — c'était une valeur en dur (1247), qui
  // s'affichait donc à l'identique sur un compte créé la minute d'avant.
  const weeklyViews = properties.length === 0
    ? 0
    : await prisma.interactionEvent.count({
        where: {
          propertyId: { in: properties.map((p) => p.id) },
          type: 'video_start',
          createdAt: { gte: depuisUneSemaine() },
        },
      })
  const quotaReached   = activeCount >= agent.agency.maxProperties

  return (
    <main className="px-5 pt-safe-page">
      <EnteteAgence
        agence={agent.agency.name}
        logo={agent.agency.logo}
        plan={agent.agency.plan}
        agent={agent.name}
        dessous={`${activeCount} bien${activeCount > 1 ? 's' : ''} sur ${agent.agency.maxProperties}`}
      />

      <BandeauNotifications notif={notif} />

      <section className="grid grid-cols-3 gap-2 mb-6">
        <Tuile libelle="Publiés" valeur={publishedCount} />
        <Tuile libelle="Brouillons" valeur={draftsCount} />
        <Tuile libelle="Vues 7 j" valeur={weeklyViews.toLocaleString('fr-FR')} />
      </section>

      <DashboardListClient
        properties={properties}
        initialFilter={initialFilter}
        archivedCount={archivedCount}
      />

      {/* Quota — collé au-dessus de la barre d'onglets. */}
      {quotaReached && (
        <div
          className="fixed left-0 right-0 z-40 px-4 pb-2"
          style={{ bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
        >
          <div
            className="rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg"
            style={{ backgroundColor: couleurs.nuit, color: couleurs.cremeSurSombre }}
          >
            <Crown size={20} style={{ color: couleurs.terracottaClair }} className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold leading-tight">Limite atteinte</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(246,237,230,.6)' }}>
                {activeCount}/{agent.agency.maxProperties} biens actifs — passez en Pro
              </p>
            </div>
            <Link
              href="/agent/parametres"
              className="text-[12px] font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: couleurs.terracotta, color: couleurs.cremeSurSombre }}
            >
              Passer Pro
            </Link>
          </div>
        </div>
      )}
    </main>
  )
}
