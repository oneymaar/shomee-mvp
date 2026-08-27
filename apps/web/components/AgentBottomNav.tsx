'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, MessageCircle, BarChart3, Settings, Plus } from 'lucide-react'
import clsx from 'clsx'
import { couleurs } from '@/lib/theme'
import type { Notifications } from '@/lib/agent/notifications'

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

/**
 * Le compteur de non-lus, tenu à jour en fond.
 *
 * Trente secondes de polling, plus un rafraîchissement dès que l'onglet
 * redevient visible : un agent qui revient sur la page après une heure voit le
 * bon chiffre tout de suite, sans attendre le prochain tour.
 */
function useNotifications(actif: boolean): Notifications | null {
  const [notif, setNotif] = useState<Notifications | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    if (!actif) return
    let stop = false
    const charger = async () => {
      try {
        const res = await fetch('/api/agent/notifications')
        if (!res.ok) return
        const j = (await res.json()) as Notifications
        if (!stop) setNotif(j)
      } catch {}
    }
    void charger()
    const t = setInterval(charger, 30000)
    const reveil = () => {
      if (document.visibilityState === 'visible') void charger()
    }
    document.addEventListener('visibilitychange', reveil)
    return () => {
      stop = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', reveil)
    }
    // `pathname` : quitter la boîte de réception marque les fils comme lus —
    // le badge doit retomber sans attendre trente secondes.
  }, [pathname, actif])

  return notif
}

function TabLink({ tab, active, badge }: { tab: Tab; active: boolean; badge: number }) {
  const Icon = tab.icon
  return (
    <Link
      href={tab.href}
      className="flex flex-col items-center justify-end gap-1 h-full pb-2 transition-colors"
      style={{ color: active ? couleurs.terracotta : couleurs.doux }}
    >
      <span className="relative">
        <Icon size={21} strokeWidth={active ? 2.1 : 1.7} />
        {badge > 0 && (
          <span
            className="absolute flex items-center justify-center text-[9.5px] font-bold rounded-full"
            style={{
              top: -5,
              right: -9,
              minWidth: 17,
              height: 17,
              padding: '0 4px',
              backgroundColor: couleurs.terracotta,
              color: couleurs.cremeSurSombre,
              border: `2px solid ${couleurs.carte}`,
            }}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="text-[9.5px] font-medium tracking-wide whitespace-nowrap max-w-full truncate px-0.5">
        {tab.label}
      </span>
    </Link>
  )
}

export default function AgentBottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  // Masquée sur les assistants et l'éditeur plein écran — inutile d'y
  // interroger le serveur toutes les trente secondes.
  const cachee = pathname.endsWith('/editer') || pathname.endsWith('/nouveau')
  const notif = useNotifications(!cachee)

  const isActive = (tab: Tab) => tab.match.some((m) => pathname === m || pathname.startsWith(m + '/'))
  // Le badge additionne les fils non lus et les visites à caler : les deux
  // demandent la même chose à l'agent — ouvrir sa boîte.
  const badgeMessages = notif ? notif.fils + notif.aCaler : 0

  if (cachee) return null

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 pb-safe-nav"
      style={{ backgroundColor: couleurs.carte, borderTop: `1px solid ${couleurs.ligne}` }}
    >
      <div className="relative h-[64px]">
        {/* Grille en 5 colonnes : 4 onglets + une place centrale pour le
            bouton +. La grille garantit une symétrie parfaite. */}
        <div className="grid grid-cols-5 h-full px-1.5">
          <TabLink tab={tabs[0]} active={isActive(tabs[0])} badge={0} />
          <TabLink tab={tabs[1]} active={isActive(tabs[1])} badge={badgeMessages} />
          <div aria-hidden />
          <TabLink tab={tabs[2]} active={isActive(tabs[2])} badge={0} />
          <TabLink tab={tabs[3]} active={isActive(tabs[3])} badge={0} />
        </div>

        {/* Le bouton central — terracotta, parce que c'est L'action du
            back-office (« un rôle unique par couleur », direction A). */}
        <button
          type="button"
          onClick={() => router.push('/agent/biens/nouveau')}
          aria-label="Nouveau bien"
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            bottom: 16,
            backgroundColor: couleurs.terracotta,
            color: couleurs.cremeSurSombre,
            boxShadow: '0 10px 22px rgba(166,81,43,.32)',
          }}
          className={clsx(
            'absolute left-1/2 -translate-x-1/2 flex items-center justify-center',
            'active:scale-95 transition-transform',
          )}
        >
          <Plus size={26} strokeWidth={2.4} />
        </button>
      </div>
    </nav>
  )
}
