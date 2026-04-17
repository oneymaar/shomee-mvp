'use client'

import { User, Bell, Shield, ChevronRight, Settings } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'
import { useShomeeStore } from '@/lib/store'
import { properties } from '@/lib/mockData'

export default function ProfilePage() {
  const { favorites } = useShomeeStore()

  const menuItems = [
    { icon: Bell, label: 'Notifications', description: 'Alertes et rappels' },
    { icon: Shield, label: 'Confidentialité', description: 'Données et sécurité' },
    { icon: Settings, label: 'Paramètres', description: "Préférences de l'app" },
  ]

  return (
    <MobileFrame>
      <div className="h-full overflow-y-auto scrollbar-hide pb-20">
        {/* Header */}
        <div className="px-5 pt-8 pb-6">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-20 h-20 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
              <User size={36} className="text-white/60" />
            </div>
            <div className="text-center">
              <h2 className="text-white font-bold text-xl">Mon profil</h2>
              <p className="text-white/40 text-sm mt-0.5">Utilisateur SHOMEE</p>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-4 mt-6">
            {[
              { label: 'Favoris', value: favorites.length },
              { label: 'Vus', value: properties.length },
              { label: 'Alertes', value: 0 },
            ].map(({ label, value }) => (
              <div key={label} className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-3 py-3 text-center">
                <p className="text-white font-bold text-2xl">{value}</p>
                <p className="text-white/40 text-xs mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Search preferences */}
        <div className="px-5 mb-6">
          <h3 className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">
            Recherche
          </h3>
          <div className="bg-white/5 border border-white/10 rounded-2xl divide-y divide-white/10">
            {[
              { label: 'Budget max', value: 'Non défini' },
              { label: 'Localisation', value: 'Paris' },
              { label: 'Type de bien', value: 'Appartement' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-4 py-3.5">
                <span className="text-white text-sm">{label}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-white/40 text-sm">{value}</span>
                  <ChevronRight size={14} className="text-white/20" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Menu */}
        <div className="px-5">
          <h3 className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">
            Compte
          </h3>
          <div className="bg-white/5 border border-white/10 rounded-2xl divide-y divide-white/10">
            {menuItems.map(({ icon: Icon, label, description }) => (
              <button
                key={label}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/5 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-white/8 flex items-center justify-center">
                  <Icon size={15} className="text-white/70" />
                </div>
                <div className="flex-1">
                  <p className="text-white text-sm font-medium">{label}</p>
                  <p className="text-white/40 text-xs">{description}</p>
                </div>
                <ChevronRight size={14} className="text-white/20" />
              </button>
            ))}
          </div>
        </div>

        {/* Version */}
        <p className="text-white/20 text-xs text-center mt-8">SHOMEE · Sprint 1 · v0.1.0</p>
      </div>

      <BottomNav />
    </MobileFrame>
  )
}
