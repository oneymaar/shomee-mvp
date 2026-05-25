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
  const favProperties = favorites
    .map((fid) => properties.find((p) => p.id === fid))
    .filter(Boolean) as typeof properties

  return (
    <MobileFrame>
      <div className="absolute inset-0 overflow-y-auto scrollbar-hide" style={{ bottom: '60px' }}>

        {/* Header */}
        <div
          className="sticky top-0 z-10 border-b border-black/8 px-5 pb-4"
          style={{ backgroundColor: '#FDF5F2', paddingTop: 'max(20px, env(safe-area-inset-top, 20px))' }}
        >
          <h1 className="text-neutral-900 font-bold text-xl tracking-tight">Favoris</h1>
          <p className="text-neutral-500 text-xs mt-0.5">
            {favProperties.length} bien{favProperties.length !== 1 ? 's' : ''} sauvegardé{favProperties.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Content */}
        {favProperties.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 px-8 text-center" style={{ minHeight: 'calc(100dvh - 180px)' }}>
            <div className="w-16 h-16 rounded-full bg-black/5 border border-black/8 flex items-center justify-center">
              <Heart size={28} className="text-neutral-400" />
            </div>
            <p className="text-neutral-500 text-sm leading-relaxed">
              Sauvegardez des biens depuis le feed pour les retrouver ici.
            </p>
            <Link
              href="/feed"
              className="font-semibold text-sm border rounded-full px-5 py-2.5 transition-colors active:opacity-70"
              style={{ color: '#A64B27', borderColor: '#A64B27' }}
            >
              Explorer les biens
            </Link>
          </div>
        ) : (
          <div className="px-4 pt-4 pb-[76px] grid grid-cols-2 gap-3">
            {favProperties.map((property) => {
              const formatted = new Intl.NumberFormat('fr-FR', {
                style: 'currency',
                currency: 'EUR',
                maximumFractionDigits: 0,
              }).format(property.price)

              return (
                <Link key={property.id} href={`/favorites/${property.id}`}>
                  <div className="bg-white border border-black/8 rounded-2xl overflow-hidden active:scale-[0.97] transition-transform">
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
                      <p className="text-neutral-900 font-semibold text-xs leading-tight line-clamp-1">
                        {property.title}
                      </p>
                      <p className="text-neutral-900 font-bold text-sm mt-1">{formatted}</p>
                      <p className="text-neutral-500 text-xs mt-0.5">{property.surface} m²</p>
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
