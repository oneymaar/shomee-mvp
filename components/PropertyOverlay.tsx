'use client'

import { ChevronDown } from 'lucide-react'
import type { Property } from '@/lib/types'

interface PropertyOverlayProps {
  property: Property
  onMore: () => void
  onBaia: () => void
}

export default function PropertyOverlay({ property, onMore, onBaia }: PropertyOverlayProps) {
  const formatted = new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(property.price)

  return (
    <>
      {/* Top info: arrondissement + subtitle */}
      <div className="absolute top-0 left-0 right-0 z-20 pt-10 pb-16 bg-gradient-to-b from-black/70 via-black/20 to-transparent pointer-events-none">
        <div className="flex flex-col items-center gap-1 px-4">
          <h2 className="text-white font-black text-xl tracking-[0.08em] drop-shadow-lg">
            {property.arrondissement}
          </h2>
          <p className="text-white/90 text-sm italic font-light drop-shadow">
            {property.subtitle}
          </p>
        </div>
      </div>

      {/* Bottom info: agent + price + BAIA */}
      <div className="absolute bottom-6 left-0 right-0 z-20 px-3">
        <div className="flex items-end justify-between gap-2">
          {/* Agent info */}
          <div className="flex items-end gap-2.5 min-w-0">
            {/* Avatar */}
            <div className="w-9 h-9 rounded-full bg-white/20 border border-white/30 flex items-center justify-center shrink-0 mb-0.5 overflow-hidden">
              <span className="text-white text-xs font-bold">
                {property.agentName.charAt(0)}
              </span>
            </div>

            {/* Text */}
            <div className="min-w-0">
              <p className="text-white font-bold text-sm leading-tight drop-shadow">
                {property.agentName}
              </p>
              <p className="text-white/80 text-[13px] leading-tight drop-shadow">
                {property.location} · {property.district}
              </p>
              <button
                onClick={onMore}
                className="flex items-center gap-1 mt-0.5"
              >
                <span className="text-white text-[13px] leading-tight drop-shadow font-medium">
                  {property.surface}m² · {formatted} €
                </span>
                <span className="text-white font-medium text-[13px] ml-1">Plus</span>
                <ChevronDown size={13} className="text-white mt-px" />
              </button>
            </div>
          </div>

          {/* BAIA button */}
          <button
            onClick={onBaia}
            className="shrink-0 w-14 h-14 rounded-full bg-white flex items-center justify-center shadow-lg hover:bg-white/90 transition-colors active:scale-95"
          >
            <span className="text-black font-black text-[13px] tracking-wider">BAIA</span>
          </button>
        </div>
      </div>
    </>
  )
}
