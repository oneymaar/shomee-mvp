'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { Archive } from 'lucide-react'
import type { PropertyStatus, MandatType } from '@prisma/client'

import PropertyCardAgent from './PropertyCardAgent'
import DashboardFilterPills, { type DashboardFilter } from './DashboardFilterPills'
import { couleurs, SERIF } from '@/lib/theme'

export type PropertyCardData = {
  id: string
  title: string
  arrondissement: string
  surface: number
  price: number
  statut: PropertyStatus
  completionRate: number
  videoUrl: string | null
  imageUrlFallback: string
  avantPremiere: boolean
  mandatType: MandatType
  badges: Array<'AVANT_PREMIERE' | 'EXCLUSIVITE'>
}

const FILTER_TO_STATUT: Record<Exclude<DashboardFilter, 'all'>, PropertyStatus> = {
  draft:       'DRAFT',
  published:   'PUBLISHED',
  unpublished: 'UNPUBLISHED',
}

export default function DashboardListClient({
  properties, initialFilter, archivedCount,
}: {
  properties: PropertyCardData[]
  initialFilter: DashboardFilter
  archivedCount: number
}) {
  const [filter, setFilter] = useState<DashboardFilter>(initialFilter)

  // Sync URL with active filter (no Next-router re-render — pure URL update).
  useEffect(() => {
    const url = filter === 'all' ? '/agent/dashboard' : `/agent/dashboard?filter=${filter}`
    window.history.replaceState(null, '', url)
  }, [filter])

  const counts = useMemo<Record<DashboardFilter, number>>(() => ({
    all:         properties.length,
    draft:       properties.filter((p) => p.statut === 'DRAFT').length,
    published:   properties.filter((p) => p.statut === 'PUBLISHED').length,
    unpublished: properties.filter((p) => p.statut === 'UNPUBLISHED').length,
  }), [properties])

  const filtered = useMemo(() => {
    if (filter === 'all') return properties
    const statut = FILTER_TO_STATUT[filter]
    return properties.filter((p) => p.statut === statut)
  }, [filter, properties])

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 style={{ fontFamily: SERIF, fontSize: 19, color: couleurs.encre }}>Mes biens</h3>
        <span className="text-[11.5px]" style={{ color: couleurs.doux }}>
          {properties.length} {properties.length > 1 ? 'biens' : 'bien'}
        </span>
      </div>

      <DashboardFilterPills active={filter} counts={counts} onChange={setFilter} />

      {filtered.length === 0 ? (
        <motion.div
          key="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl p-7 text-center"
          style={{ backgroundColor: couleurs.carte, border: `1px dashed ${couleurs.ligne}` }}
        >
          <p className="text-[14px]" style={{ color: couleurs.doux }}>
            {filter === 'all'
              ? "Aucun bien pour l'instant."
              : 'Aucun bien dans cette catégorie.'}
          </p>
          {filter === 'all' && (
            <p className="text-[12px] mt-1.5" style={{ color: couleurs.estompe }}>
              Appuyez sur le bouton « + » pour créer votre premier bien.
            </p>
          )}
        </motion.div>
      ) : (
        <motion.div layout className="space-y-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {filtered.map((p) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <PropertyCardAgent {...p} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {archivedCount > 0 && (
        <Link
          href="/agent/biens/archives"
          className="mt-5 flex items-center justify-center gap-2 py-3 rounded-2xl text-[13px] font-medium active:opacity-70"
          style={{ border: `1px dashed ${couleurs.ligne}`, color: couleurs.doux }}
        >
          <Archive size={14} />
          Voir les biens archivés ({archivedCount})
        </Link>
      )}
    </section>
  )
}
