'use client'

import { motion } from 'framer-motion'
import { couleurs } from '@/lib/theme'

export type DashboardFilter = 'all' | 'draft' | 'published' | 'unpublished'

const PILLS: Array<{ value: DashboardFilter; label: string }> = [
  { value: 'all',         label: 'Tous' },
  { value: 'draft',       label: 'Brouillons' },
  { value: 'published',   label: 'Publiés' },
  { value: 'unpublished', label: 'Dépubliés' },
]

export default function DashboardFilterPills({
  active, counts, onChange,
}: {
  active: DashboardFilter
  counts: Record<DashboardFilter, number>
  onChange: (next: DashboardFilter) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-3 scrollbar-hide">
      {PILLS.map((pill) => {
        const isActive = pill.value === active
        return (
          <button
            key={pill.value}
            type="button"
            onClick={() => onChange(pill.value)}
            className="relative flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-medium transition-colors"
            style={
              isActive
                ? { color: couleurs.cremeSurSombre, border: `1px solid ${couleurs.encre}` }
                : { backgroundColor: couleurs.carte, color: couleurs.doux, border: `1px solid ${couleurs.ligne}` }
            }
          >
            {isActive && (
              <motion.span
                layoutId="dashboard-filter-active"
                className="absolute inset-0 rounded-full"
                style={{ backgroundColor: couleurs.encre }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative z-10">{pill.label}</span>
            <span
              className="relative z-10 inline-flex items-center justify-center text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1"
              style={
                isActive
                  ? { backgroundColor: 'rgba(246,237,230,.22)', color: couleurs.cremeSurSombre }
                  : { backgroundColor: couleurs.sable, color: couleurs.doux }
              }
            >
              {counts[pill.value]}
            </span>
          </button>
        )
      })}
    </div>
  )
}
