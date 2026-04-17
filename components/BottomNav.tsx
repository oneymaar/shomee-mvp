'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Heart, MessageCircle, User } from 'lucide-react'
import clsx from 'clsx'

const tabs = [
  { label: 'Biens', href: '/feed', icon: Home },
  { label: 'Favoris', href: '/favorites', icon: Heart },
  { label: 'Messages', href: '/messages', icon: MessageCircle },
  { label: 'Profil', href: '/profile', icon: User },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="absolute bottom-0 left-0 right-0 z-50 bg-black border-t border-white/10"
    >
      <div className="flex items-center justify-around px-2 h-[60px]">
        {tabs.map(({ label, href, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex flex-col items-center gap-0.5 px-5 py-1.5 transition-all duration-200',
                active ? 'text-white' : 'text-white/35',
              )}
            >
              <Icon size={23} strokeWidth={active ? 2.5 : 1.8} />
              <span className="text-[10px] font-medium tracking-wide">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
