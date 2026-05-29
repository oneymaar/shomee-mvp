import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { PropertyStatus } from '@prisma/client'
import PropertyCardAgent from '@/components/agent/PropertyCardAgent'

export const dynamic = 'force-dynamic'

export default async function AgentArchivesPage() {
  const agent = await prisma.agent.findFirst()
  if (!agent) {
    return (
      <main className="px-5 pt-6">
        <h1 className="text-xl font-bold mb-2">Aucun agent en base</h1>
      </main>
    )
  }

  const properties = await prisma.property.findMany({
    where: { createdByAgentId: agent.id, statut: PropertyStatus.ARCHIVED },
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

  return (
    <main className="px-5 pt-6 pb-32">
      <header className="flex items-center gap-2 mb-5">
        <Link
          href="/agent/dashboard"
          aria-label="Retour au dashboard"
          className="w-9 h-9 -ml-2 rounded-full flex items-center justify-center active:bg-black/5"
        >
          <ArrowLeft size={22} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-[15px] font-semibold text-[#0a0a0a]">Biens archivés</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {properties.length} {properties.length > 1 ? 'biens archivés' : 'bien archivé'}
          </p>
        </div>
      </header>

      {properties.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-6 text-center">
          <p className="text-sm text-gray-500">Aucun bien archivé.</p>
          <p className="text-[11px] text-gray-400 mt-1">
            Les biens archivés depuis votre dashboard apparaissent ici.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {properties.map((p) => (
            <PropertyCardAgent
              key={p.id}
              id={p.id}
              title={p.title}
              arrondissement={p.arrondissement}
              surface={p.surface}
              price={p.price}
              statut={p.statut}
              completionRate={p.completionRate}
              videoUrl={p.videoUrl}
              imageUrlFallback={p.imageUrlFallback}
              avantPremiere={p.avantPremiere}
              mandatType={p.mandatType}
              badges={p.badges}
            />
          ))}
        </div>
      )}
    </main>
  )
}
