'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Heart } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'
import { useShomeeStore } from '@/lib/store'
import { properties } from '@/lib/mockData'

export default function FavoritesPage() {
  const { favorites } = useShomeeStore()
  const favProperties = properties.filter((p) => favorites.includes(p.id))

  return (
    <MobileFrame>
      <div className="h-full overflow-y-auto scrollbar-hide pb-20">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-md border-b border-white/10 px-5 py-4">
          <h1 className="text-white font-bold text-xl tracking-tight">Favoris</h1>
          <p className="text-white/40 text-sm mt-0.5">
            {favProperties.length} bien{favProperties.length !== 1 ? 's' : ''} sauvegardé
            {favProperties.length !== 1 ? 's' : ''}
          </p>
        </div>

        {favProperties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] gap-4 px-8 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
              <Heart size={28} className="text-white/30" />
            </div>
            <p className="text-white/50 text-sm leading-relaxed">
              Sauvegardez des biens depuis le feed pour les retrouver ici.
            </p>
            <Link
              href="/feed"
              className="text-white font-semibold text-sm border border-white/20 rounded-full px-5 py-2.5 hover:border-white/40 transition-colors"
            >
              Explorer les biens
            </Link>
          </div>
        ) : (
          <div className="px-4 pt-4 grid grid-cols-2 gap-3">
            {favProperties.map((property) => {
              const formatted = new Intl.NumberFormat('fr-FR', {
                style: 'currency',
                currency: 'EUR',
                maximumFractionDigits: 0,
              }).format(property.price)

              return (
                <Link key={property.id} href={`/feed/${property.id}`}>
                  <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-white/30 transition-all active:scale-[0.97]">
                    <div className="relative h-36">
                      <Image
                        src={property.imageUrlFallback}
                        alt={property.title}
                        fill
                        className="object-cover"
                        sizes="200px"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    </div>
                    <div className="p-3">
                      <p className="text-white font-semibold text-xs leading-tight line-clamp-1">
                        {property.title}
                      </p>
                      <p className="text-white font-bold text-sm mt-1">{formatted}</p>
                      <p className="text-white/40 text-xs mt-0.5">{property.surface} m²</p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      <BottomNav />
    </MobileFrame>
  )
}
