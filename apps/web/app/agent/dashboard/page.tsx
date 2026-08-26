import { prisma } from '@/lib/prisma'
import { PropertyStatus } from '@prisma/client'
import DashboardListClient from '@/components/agent/DashboardListClient'
import type { DashboardFilter } from '@/components/agent/DashboardFilterPills'
import { Eye, FileText, CheckCircle2, Crown } from 'lucide-react'
import Link from 'next/link'
import { requireAgentOrRedirect } from '@/lib/auth/agentGuard'

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

  const archivedCount = await prisma.property.count({
    where: { createdByAgentId: agent.id, statut: PropertyStatus.ARCHIVED },
  })

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
      {/* Header — agency logo (circle) + name + plan */}
      <header className="flex items-center gap-3 mb-5">
        {agent.agency.logo ? (
          <div
            className="flex-shrink-0 rounded-full overflow-hidden bg-white border border-gray-200 flex items-center justify-center"
            style={{ width: 44, height: 44 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={agent.agency.logo}
              alt={agent.agency.name}
              className="w-full h-full object-contain p-1"
            />
          </div>
        ) : (
          <div
            className="flex-shrink-0 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center"
            style={{ width: 44, height: 44 }}
            aria-label={agent.agency.name}
          >
            <span className="text-[13px] font-bold text-gray-700">
              {agent.agency.name
                .split(/\s+/)
                .slice(0, 2)
                .map((s) => s[0]?.toUpperCase() ?? '')
                .join('')}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[15px] font-semibold text-[#0a0a0a] truncate">{agent.agency.name}</h1>
            <span className="text-[9px] font-semibold uppercase tracking-[0.12em] px-1.5 py-[3px] rounded border border-[#0a0a0a]/25 text-[#0a0a0a]/75">
              {agent.agency.plan}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">{agent.name} · Espace agent</p>
        </div>
        <nav className="flex items-center gap-3 flex-none">
          <Link href="/agent/messages" className="text-[12.5px] font-semibold underline" style={{ color: '#A6512B' }}>
            Messages
          </Link>
          <Link href="/agent/parametres" className="text-[12.5px] font-semibold underline" style={{ color: '#A6512B' }}>
            Réglages
          </Link>
        </nav>
      </header>

      {/* Quick stats */}
      <section className="grid grid-cols-3 gap-2 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl px-3 py-3">
          <div className="flex items-center gap-1 text-gray-500 mb-1">
            <CheckCircle2 size={12} />
            <span className="text-[10px] uppercase tracking-wider">Publiés</span>
          </div>
          <p className="text-[20px] font-bold text-[#0a0a0a] leading-none">{publishedCount}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl px-3 py-3">
          <div className="flex items-center gap-1 text-gray-500 mb-1">
            <FileText size={12} />
            <span className="text-[10px] uppercase tracking-wider">Brouillons</span>
          </div>
          <p className="text-[20px] font-bold text-[#0a0a0a] leading-none">{draftsCount}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl px-3 py-3">
          <div className="flex items-center gap-1 text-gray-500 mb-1">
            <Eye size={12} />
            <span className="text-[10px] uppercase tracking-wider">Vues 7j</span>
          </div>
          <p className="text-[20px] font-bold text-[#0a0a0a] leading-none">{weeklyViews.toLocaleString('fr-FR')}</p>
        </div>
      </section>

      <DashboardListClient
        properties={properties}
        initialFilter={initialFilter}
        archivedCount={archivedCount}
      />

      {/* Quota banner (sticky above bottom nav) */}
      {quotaReached && (
        <div
          className="fixed left-0 right-0 z-40 px-4 pb-2"
          style={{ bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="bg-[#0a0a0a] text-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg">
            <Crown size={20} className="text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold leading-tight">Limite atteinte</p>
              <p className="text-[11px] text-gray-300 mt-0.5">
                {activeCount}/{agent.agency.maxProperties} biens actifs — passez en Pro
              </p>
            </div>
            <Link
              href="/agent/parametres/forfait"
              className="bg-white text-[#0a0a0a] text-[12px] font-semibold px-3 py-1.5 rounded-lg flex-shrink-0"
            >
              Passer Pro
            </Link>
          </div>
        </div>
      )}
    </main>
  )
}
