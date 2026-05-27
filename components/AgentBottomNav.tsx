'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, MessageCircle, BarChart3, Settings, Plus } from 'lucide-react'
import clsx from 'clsx'

const tabs = [
  { label: 'Mes biens',      href: '/agent/biens',       icon: Home },
  { label: 'Messagerie',     href: '/agent/messages',    icon: MessageCircle },
  { label: 'Statistiques',   href: '/agent/stats',       icon: BarChart3 },
  { label: 'Paramètres',     href: '/agent/parametres',  icon: Settings },
]

export default function AgentBottomNav() {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom,0px)]">
      <div className="relative flex items-end justify-around px-2 h-[64px]">
        {/* Left two tabs */}
        {tabs.slice(0, 2).map(({ label, href, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex flex-col items-center gap-0.5 px-4 py-2 transition-colors',
                active ? 'text-[#0a0a0a]' : 'text-neutral-400',
              )}
            >
              <Icon size={22} strokeWidth={active ? 2 : 1.6} />
              <span className="text-[11px] font-medium tracking-wide">{label}</span>
            </Link>
          )
        })}

        {/* Center + button (raised) */}
        <button
          type="button"
          onClick={() => router.push('/agent/biens/nouveau')}
          aria-label="Nouveau bien"
          className="-mt-6 w-14 h-14 bg-[#0a0a0a] text-white rounded-full flex items-center justify-center shadow-[0_6px_16px_-2px_rgba(0,0,0,0.25)] active:scale-95 transition-transform"
        >
          <Plus size={26} strokeWidth={2.4} />
        </button>

        {/* Right two tabs */}
        {tabs.slice(2).map(({ label, href, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex flex-col items-center gap-0.5 px-4 py-2 transition-colors',
                active ? 'text-[#0a0a0a]' : 'text-neutral-400',
              )}
            >
              <Icon size={22} strokeWidth={active ? 2 : 1.6} />
              <span className="text-[11px] font-medium tracking-wide">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
