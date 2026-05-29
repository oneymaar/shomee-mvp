'use client'

import { AnimatePresence, motion } from 'framer-motion'
import PropertyCardAgent from './PropertyCardAgent'
import type { PropertyCardData } from './DashboardListClient'

export default function ArchivesListClient({ properties }: { properties: PropertyCardData[] }) {
  if (properties.length === 0) {
    return (
      <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-6 text-center">
        <p className="text-sm text-gray-500">Aucun bien archivé.</p>
        <p className="text-[11px] text-gray-400 mt-1">
          Les biens archivés depuis votre dashboard apparaissent ici.
        </p>
      </div>
    )
  }

  return (
    <motion.div layout className="space-y-3">
      <AnimatePresence mode="popLayout" initial={false}>
        {properties.map((p) => (
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
  )
}
