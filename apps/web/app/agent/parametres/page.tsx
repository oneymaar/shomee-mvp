import Link from 'next/link'
import { Archive, ChevronRight } from 'lucide-react'
import { PropertyStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAgentOrRedirect } from '@/lib/auth/agentGuard'
import { couleurs, SERIF } from '@/lib/theme'
import ParametresClient from './ParametresClient'

export const dynamic = 'force-dynamic'

/**
 * Paramètres — la page ne se réduit plus au connecteur IA.
 *
 * Un agent qui ouvre cet onglet cherche d'abord à savoir QUI il est connecté et
 * ce que son forfait lui permet. Le connecteur, lui, reste le morceau le plus
 * riche : il garde sa place, juste en dessous.
 */

const PLANS: Record<string, string> = { BASIC: 'Basic', PRO: 'Pro', PREMIUM: 'Premium' }

function Ligne({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex items-baseline gap-3 py-2" style={{ borderTop: `1px solid ${couleurs.ligneDouce}` }}>
      <span className="text-[12.5px] flex-none" style={{ color: couleurs.doux, width: 92 }}>
        {libelle}
      </span>
      <span className="text-[14px] font-medium truncate" style={{ color: couleurs.encre }}>
        {valeur}
      </span>
    </div>
  )
}

export default async function AgentParametresPage() {
  const agent = await requireAgentOrRedirect()

  const [actifs, archives] = await Promise.all([
    prisma.property.count({
      where: { createdByAgentId: agent.id, statut: { not: PropertyStatus.ARCHIVED } },
    }),
    prisma.property.count({
      where: { createdByAgentId: agent.id, statut: PropertyStatus.ARCHIVED },
    }),
  ])

  const max = agent.agency.maxProperties
  const remplissage = max > 0 ? Math.min(100, Math.round((actifs / max) * 100)) : 0
  const plein = actifs >= max

  return (
    <main className="px-5 pb-8 pt-safe-page max-w-3xl mx-auto">
      <h1 className="mb-6" style={{ fontFamily: SERIF, fontSize: 27, color: couleurs.encre }}>
        Paramètres
      </h1>

      {/* ── Le compte ───────────────────────────────────────────────────── */}
      <section
        className="rounded-3xl p-6 mb-4"
        style={{ backgroundColor: couleurs.carte, border: `1px solid ${couleurs.ligne}` }}
      >
        <div
          className="text-[11px] font-bold uppercase mb-3"
          style={{ color: couleurs.terracotta, letterSpacing: '1.8px' }}
        >
          Votre compte
        </div>

        <Ligne libelle="Agent" valeur={agent.name} />
        <Ligne libelle="E-mail" valeur={agent.email} />
        <Ligne libelle="Agence" valeur={agent.agency.name} />
        <Ligne libelle="Forfait" valeur={PLANS[agent.agency.plan] ?? agent.agency.plan} />

        <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${couleurs.ligneDouce}` }}>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[12.5px]" style={{ color: couleurs.doux }}>Biens actifs</span>
            <span className="text-[13px] font-semibold" style={{ color: couleurs.encre }}>
              {actifs} sur {max}
            </span>
          </div>
          <div className="h-[5px] rounded-full overflow-hidden" style={{ backgroundColor: couleurs.sable }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${remplissage}%`,
                backgroundColor: plein ? couleurs.alerte : couleurs.terracotta,
              }}
            />
          </div>
          {plein && (
            <p className="text-[12px] mt-2" style={{ color: couleurs.alerte }}>
              Limite atteinte — archivez un bien ou passez au forfait supérieur pour en publier un
              nouveau.
            </p>
          )}
        </div>
      </section>

      {/* ── Le connecteur IA ────────────────────────────────────────────── */}
      <ParametresClient />

      {/* ── Les archives ────────────────────────────────────────────────── */}
      <Link
        href="/agent/biens/archives"
        className="flex items-center gap-3 rounded-3xl px-5 py-4 mt-4 active:opacity-80"
        style={{ backgroundColor: couleurs.carte, border: `1px solid ${couleurs.ligne}` }}
      >
        <Archive size={17} style={{ color: couleurs.doux }} className="flex-none" />
        <span className="flex-1 text-[14px] font-medium" style={{ color: couleurs.encre }}>
          Biens archivés
        </span>
        <span className="text-[13px]" style={{ color: couleurs.doux }}>{archives}</span>
        <ChevronRight size={17} style={{ color: couleurs.estompe }} className="flex-none" />
      </Link>
    </main>
  )
}
