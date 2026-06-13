'use client'

import { useRouter } from 'next/navigation'
import { User, Bell, Shield, ChevronRight, Settings, RefreshCw } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'
import { useShomeeStore } from '@/lib/store'
import { useSearchStore } from '@/lib/searchStore'
import { useFeedStore } from '@/lib/feedStore'
import { properties } from '@shomee/core/utils/mockData'

const MENU_ITEMS = [
  { icon: Bell,     label: 'Notifications',  description: 'Alertes et rappels' },
  { icon: Shield,   label: 'Confidentialité', description: 'Données et sécurité' },
  { icon: Settings, label: 'Paramètres',      description: "Préférences de l'app" },
]

function formatBudget(max: number | null): string {
  if (!max) return 'Non défini'
  if (max >= 99_000_000) return '> 1 500 000 €'
  return `≤ ${(max / 1000).toFixed(0)} 000 €`
}

export default function ProfilePage() {
  const router = useRouter()
  const { favorites } = useShomeeStore()
  const { locationLabel, budgetMax, propertyTypes, resetOnboarding } = useSearchStore()

  const handleResetOnboarding = () => {
    resetOnboarding()
    // Invalide le feed en mémoire pour forcer une régénération au prochain
    // onboarding (sinon /feed afficherait l'ancien feed via hasFeed()).
    useFeedStore.getState().clearFeed()
    router.push('/onboarding')
  }

  const searchPrefs = [
    {
      label: 'Localisation',
      value: locationLabel || 'Non définie',
    },
    {
      label: 'Budget max',
      value: formatBudget(budgetMax),
    },
    {
      label: 'Type de bien',
      value: propertyTypes.length > 0
        ? propertyTypes.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')
        : 'Non défini',
    },
  ]

  return (
    <MobileFrame>
      <div className="absolute inset-0 overflow-y-auto scrollbar-hide" style={{ bottom: '60px' }}>

        {/* Header */}
        <div
          className="sticky top-0 z-10 border-b border-black/8 px-5 pb-4"
          style={{ backgroundColor: '#FDF5F2', paddingTop: 'max(20px, env(safe-area-inset-top, 20px))' }}
        >
          <h1 className="text-neutral-900 font-bold text-xl tracking-tight">Mon profil</h1>
          <p className="text-neutral-500 text-xs mt-0.5">Utilisateur SHOMEE</p>
        </div>

        {/* Avatar + stats */}
        <div className="px-5 pt-8 pb-6">
          <div className="flex flex-col items-center gap-3 mb-6">
            <div className="w-20 h-20 rounded-full bg-black/5 border border-black/8 flex items-center justify-center">
              <User size={36} className="text-neutral-400" />
            </div>
          </div>

          <div className="flex gap-3">
            {[
              { label: 'Favoris', value: favorites.length },
              { label: 'Vus',     value: properties.length },
              { label: 'Alertes', value: 0 },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="flex-1 bg-white border border-black/8 rounded-2xl px-3 py-3.5 text-center"
              >
                <p className="text-neutral-900 font-bold text-2xl">{value}</p>
                <p className="text-neutral-500 text-xs mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-black/8 mx-5" />

        {/* Search preferences */}
        <div className="px-5 pt-6 mb-6">
          <p className="text-neutral-400 text-xs font-semibold uppercase tracking-widest mb-3">
            Recherche
          </p>
          <div className="bg-white border border-black/8 rounded-2xl divide-y divide-black/6">
            {searchPrefs.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-4 py-3.5">
                <span className="text-neutral-900 text-sm">{label}</span>
                <span className="text-neutral-500 text-sm truncate max-w-[160px] text-right">{value}</span>
              </div>
            ))}
          </div>
          <button
            onClick={handleResetOnboarding}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-black/8 bg-white text-sm font-medium active:bg-black/4 transition-colors"
            style={{ color: '#A64B27' }}
          >
            <RefreshCw size={14} />
            Modifier ma recherche
          </button>
        </div>

        {/* Account */}
        <div className="px-5 mb-6">
          <p className="text-neutral-400 text-xs font-semibold uppercase tracking-widest mb-3">
            Compte
          </p>
          <div className="bg-white border border-black/8 rounded-2xl divide-y divide-black/6">
            {MENU_ITEMS.map(({ icon: Icon, label, description }) => (
              <button
                key={label}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-black/4"
              >
                <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-neutral-500" />
                </div>
                <div className="flex-1">
                  <p className="text-neutral-900 text-sm font-medium">{label}</p>
                  <p className="text-neutral-500 text-xs">{description}</p>
                </div>
                <ChevronRight size={14} className="text-neutral-400" />
              </button>
            ))}
          </div>
        </div>

        {/* Version */}
        <p className="text-neutral-400 text-xs text-center pb-[76px]">SHOMEE · Sprint 2 · v0.2.0</p>

      </div>
      <BottomNav />
    </MobileFrame>
  )
}
