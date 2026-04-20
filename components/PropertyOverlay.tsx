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
      {/* Bottom info: agent + price + BAIA */}
      <div className="absolute bottom-6 left-0 right-0 z-20 px-3">
        <div className="flex items-end justify-between gap-2">
          {/* Agent info */}
          <div className="flex items-end gap-2.5 min-w-0">
            {/* Avatar */}
            <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 mb-0.5 bg-neutral-900 border border-white/25 flex items-center justify-center">
              {property.agentAvatar ? (
                <img src={property.agentAvatar} alt={property.agentName} className="w-full h-full object-contain" />
              ) : (
                <span className="text-white text-xs font-bold">{property.agentName.charAt(0)}</span>
              )}
            </div>

            {/* Text */}
            <div className="min-w-0">
              <p className="text-white font-bold text-[15px] leading-tight drop-shadow mb-px">
                {property.agentName}
              </p>
              <p className="text-white text-[15px] leading-tight drop-shadow mt-0 mb-[-3px] border-0 border-white">
                {property.location} · {property.district}
              </p>
              <button
                onClick={onMore}
                className="flex items-center gap-0 mt-0.5"
              >
                <span className="text-white text-[15px] leading-tight drop-shadow font-normal mt-0">
                  {property.surface}m² · {formatted} €
                </span>
                <span className="text-white/75 font-medium text-[14px] ml-2.5 border-0 border-white/67">Plus</span>
                <ChevronDown size={18} className="text-white/75 mt-px" />
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
