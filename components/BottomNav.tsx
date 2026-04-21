'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Heart, MessageCircle, User } from 'lucide-react'
import clsx from 'clsx'
import { useShomeeStore, hasUnread } from '@/lib/store'

const tabs = [
  { label: 'Biens', href: '/feed', icon: Home },
  { label: 'Favoris', href: '/favorites', icon: Heart },
  { label: 'Messages', href: '/messages', icon: MessageCircle },
  { label: 'Profil', href: '/profile', icon: User },
]

export default function BottomNav() {
  const pathname = usePathname()
  const conversations = useShomeeStore(s => s.conversations)
  const unreadCount = conversations.filter(hasUnread).length

  return (
    <nav className="absolute bottom-0 left-0 right-0 z-50 bg-black border-t border-white/10 pb-0">
      <div className="flex items-center justify-around px-2 h-[60px]">
        {tabs.map(({ label, href, icon: Icon }) => {
          const active = pathname.startsWith(href)
          const isMessages = href === '/messages'

          return (
            <Link
              key={href}
              href={href}
              data-tab={label.toLowerCase()}
              className={clsx(
                'flex flex-col items-center gap-0.5 px-5 py-1.5 transition-all duration-200',
                active ? 'text-white' : 'text-white/60',
              )}
            >
              <div className="relative">
                <Icon size={23} strokeWidth={active ? 2.5 : 1.8} />
                {isMessages && unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-1 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </div>
              <span className="text-[12px] font-medium tracking-wide">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
