'use client'

import clsx from 'clsx'
import { motion } from 'framer-motion'

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
            className={clsx(
              'relative flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors',
              isActive
                ? 'text-white border-[#0a0a0a]'
                : 'bg-white text-[#0a0a0a] border-gray-200 active:bg-gray-50',
            )}
          >
            {isActive && (
              <motion.span
                layoutId="dashboard-filter-active"
                className="absolute inset-0 rounded-full bg-[#0a0a0a]"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative z-10">{pill.label}</span>
            <span
              className={clsx(
                'relative z-10 inline-flex items-center justify-center text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1',
                isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600',
              )}
            >
              {counts[pill.value]}
            </span>
          </button>
        )
      })}
    </div>
  )
}
