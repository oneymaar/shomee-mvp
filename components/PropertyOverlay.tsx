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
      {/* ── TOP: agence (sous la barre de progression) ── */}
      <div
        className="absolute left-0 right-0 z-20 px-4"
        style={{ top: 'calc(env(safe-area-inset-top, 8px) + 36px)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 bg-neutral-900 border border-white/25 flex items-center justify-center">
            {property.agentAvatar ? (
              <img src={property.agentAvatar} alt={property.agentName} className="w-full h-full object-contain" />
            ) : (
              <span className="text-white text-[10px] font-bold">{property.agentName.charAt(0)}</span>
            )}
          </div>
          <span className="text-white text-[13px] font-semibold drop-shadow">
            {property.agentName}
          </span>
        </div>
      </div>

      {/* ── BOTTOM: infos bien + BAIA ── */}
      <div className="absolute bottom-6 left-0 right-0 z-20 px-3">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-white text-[15px] leading-tight drop-shadow mb-0.5">
              {property.location} · {property.district}
            </p>
            <button onClick={onMore} className="flex items-center gap-0">
              <span className="text-white text-[15px] leading-tight drop-shadow font-normal">
                {property.surface}m² · {formatted} €
              </span>
              <span className="text-white/75 font-medium text-[14px] ml-2.5">Plus</span>
              <ChevronDown size={18} className="text-white/75 mt-px" />
            </button>
          </div>

          {/* BAIA */}
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
