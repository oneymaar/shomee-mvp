import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { requireAgentOrRedirect } from '@/lib/auth/agentGuard'
import { PropertyStatus } from '@prisma/client'
import ArchivesListClient from '@/components/agent/ArchivesListClient'

export const dynamic = 'force-dynamic'

export default async function AgentArchivesPage() {
  const agent = await requireAgentOrRedirect()

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
    <main className="px-5 pt-safe-page pb-32">
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

      <ArchivesListClient properties={properties} />
    </main>
  )
}
