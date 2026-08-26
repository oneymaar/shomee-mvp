'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, MessageCircle, BarChart3, Settings, Plus } from 'lucide-react'
import clsx from 'clsx'

type Tab = {
  label: string
  href: string
  icon: typeof Home
  match: string[]
}

const tabs: Tab[] = [
  { label: 'Biens',       href: '/agent/biens',      icon: Home,          match: ['/agent/dashboard', '/agent/biens'] },
  { label: 'Messages',    href: '/agent/messages',   icon: MessageCircle, match: ['/agent/messages'] },
  { label: 'Stats',       href: '/agent/stats',      icon: BarChart3,     match: ['/agent/stats'] },
  { label: 'Paramètres',  href: '/agent/parametres', icon: Settings,      match: ['/agent/parametres'] },
]

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  const Icon = tab.icon
  return (
    <Link
      href={tab.href}
      className={clsx(
        'flex flex-col items-center justify-end gap-0.5 h-full pb-2 transition-colors',
        active ? 'text-[#0a0a0a]' : 'text-neutral-400',
      )}
    >
      <Icon size={22} strokeWidth={active ? 2 : 1.6} />
      <span className="text-[10px] font-medium tracking-wide whitespace-nowrap max-w-full truncate px-0.5">{tab.label}</span>
    </Link>
  )
}

export default function AgentBottomNav() {
  const pathname = usePathname()
  const router = useRouter()

  // Hide on full-screen wizards/editors
  if (pathname.endsWith('/editer') || pathname.endsWith('/nouveau')) return null

  const isActive = (tab: Tab) => tab.match.some((m) => pathname === m || pathname.startsWith(m + '/'))

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 pb-safe-nav"
    >
      <div className="relative h-[64px]">
        {/* 5-column grid: 4 tabs + a centered slot for the + button.
            grid guarantees perfect symmetry around the center. */}
        <div className="grid grid-cols-5 h-full px-1.5">
          <TabLink tab={tabs[0]} active={isActive(tabs[0])} />
          <TabLink tab={tabs[1]} active={isActive(tabs[1])} />
          <div aria-hidden /> {/* + button slot */}
          <TabLink tab={tabs[2]} active={isActive(tabs[2])} />
          <TabLink tab={tabs[3]} active={isActive(tabs[3])} />
        </div>

        {/* Center + button — perfectly round, raised above nav */}
        <button
          type="button"
          onClick={() => router.push('/agent/biens/nouveau')}
          aria-label="Nouveau bien"
          style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0, bottom: 16 }}
          className="absolute left-1/2 -translate-x-1/2 bg-[#0a0a0a] text-white flex items-center justify-center shadow-[0_6px_16px_-2px_rgba(0,0,0,0.25)] active:scale-95 transition-transform"
        >
          <Plus size={26} strokeWidth={2.4} />
        </button>
      </div>
    </nav>
  )
}
