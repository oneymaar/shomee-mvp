'use client'

import Link from 'next/link'
import clsx from 'clsx'

export type DashboardFilter = 'all' | 'draft' | 'published' | 'unpublished'

const PILLS: Array<{ value: DashboardFilter; label: string }> = [
  { value: 'all',         label: 'Tous' },
  { value: 'draft',       label: 'Brouillons' },
  { value: 'published',   label: 'Publiés' },
  { value: 'unpublished', label: 'Dépubliés' },
]

export default function DashboardFilterPills({
  active, counts,
}: {
  active: DashboardFilter
  counts: Record<DashboardFilter, number>
}) {
  return (
    <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-3 no-scrollbar">
      {PILLS.map((pill) => {
        const isActive = pill.value === active
        const href = pill.value === 'all' ? '/agent/dashboard' : `/agent/dashboard?filter=${pill.value}`
        return (
          <Link
            key={pill.value}
            href={href}
            scroll={false}
            className={clsx(
              'flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors',
              isActive
                ? 'bg-[#0a0a0a] text-white border-[#0a0a0a]'
                : 'bg-white text-[#0a0a0a] border-gray-200 active:bg-gray-50',
            )}
          >
            {pill.label}
            <span
              className={clsx(
                'inline-flex items-center justify-center text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1',
                isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600',
              )}
            >
              {counts[pill.value]}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
