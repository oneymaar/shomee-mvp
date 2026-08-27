'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Heart, MessageCircle, User } from 'lucide-react'
import clsx from 'clsx'
import { useShomeeStore, hasUnread } from '@/lib/store'
import { couleurs } from '@/lib/theme'

const tabs = [
  { label: 'Biens', href: '/feed', icon: Home },
  { label: 'Favoris', href: '/favorites', icon: Heart },
  { label: 'Messages', href: '/messages', icon: MessageCircle },
  { label: 'Profil', href: '/profile', icon: User },
]

/**
 * Deux peintures, une seule géométrie — exactement comme le natif
 * (`apps/mobile/src/app/(tabs)/_layout.tsx`).
 *
 * Sur le FEED, la barre passe en chrome SOMBRE : la vidéo occupe tout l'écran,
 * une barre crème lui poserait un socle blanc en bas. Partout ailleurs
 * (favoris, messages, profil) elle reste crème.
 */
type Peinture = { actif: string; inactif: string; fond: string; filet: string }

const CLAIR: Peinture = {
  actif: couleurs.terracotta,
  inactif: couleurs.doux,
  fond: couleurs.creme,
  filet: couleurs.ligne,
}

const SOMBRE: Peinture = {
  actif: couleurs.terracottaClair,
  inactif: 'rgba(246,237,230,0.42)',
  fond: couleurs.nuitHaute,
  filet: couleurs.filetSurSombre,
}

interface BottomNavProps {
  previewMode?: boolean
  /** Forcer le chrome sombre. Par défaut : déduit de l'écran (feed = sombre). */
  sombre?: boolean
}

export default function BottomNav({ previewMode = false, sombre }: BottomNavProps = {}) {
  const pathname = usePathname()
  const conversations = useShomeeStore(s => s.conversations)
  const unreadCount = conversations.filter(hasUnread).length

  // Le feed et les fiches en plein écran vivent sur fond vidéo.
  const surVideo = sombre ?? (pathname === '/feed' || pathname.startsWith('/favorites/'))
  const p = surVideo ? SOMBRE : CLAIR

  return (
    <nav
      className={clsx(
        'bottom-0 left-0 right-0 z-50',
        previewMode ? 'absolute pointer-events-none' : 'fixed',
      )}
      style={{ backgroundColor: p.fond, borderTop: `1px solid ${p.filet}` }}
    >
      <div className="flex items-center justify-around px-2 h-[60px]">
        {tabs.map(({ label, href, icon: Icon }) => {
          const active = pathname.startsWith(href)
          const isMessages = href === '/messages'

          return (
            <Link
              key={href}
              href={href}
              data-tab={label.toLowerCase()}
              className="flex flex-col items-center gap-0.5 px-5 py-1.5 transition-all duration-200"
              style={{ color: active ? p.actif : p.inactif }}
            >
              <div className="relative">
                <Icon size={23} strokeWidth={active ? 1.5 : 1.8} className={active ? 'fill-current' : ''} />
                {isMessages && unreadCount > 0 && (
                  <span
                    className="absolute rounded-full"
                    style={{
                      top: -2,
                      right: -4,
                      width: 8,
                      height: 8,
                      backgroundColor: p.actif,
                      border: `2px solid ${p.fond}`,
                    }}
                  />
                )}
              </div>
              <span className="text-[10.5px] font-medium tracking-wide">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
