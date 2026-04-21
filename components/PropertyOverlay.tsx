'use client'

import { ChevronDown, MapPin, Check, Home } from 'lucide-react'
import type { Property } from '@/lib/types'

interface PropertyOverlayProps {
  property: Property
  onMore?: () => void
  onBaia?: () => void
  agencyTopOffset?: number
}

const BADGE_STYLES = {
  'avant-premiere': {
    label: 'Avant-première',
    className: 'bg-amber-400/15 border border-amber-300/35 text-amber-200',
  },
  'exclusivite': {
    label: 'Exclusivité',
    className: 'bg-violet-400/15 border border-violet-300/35 text-violet-200',
  },
} as const

export default function PropertyOverlay({ property, onMore, onBaia, agencyTopOffset = 0 }: PropertyOverlayProps) {
  return (
    <>
      {/* ── Top — agency ── */}
      <div
        className="absolute top-0 left-0 right-0 z-20 px-3"
        style={{ paddingTop: `calc(env(safe-area-inset-top, 0px) + ${12 + agencyTopOffset}px)` }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-neutral-900 border border-white/25 flex items-center justify-center">
            {property.agentAvatar ? (
              <img src={property.agentAvatar} alt={property.agentName} className="w-full h-full object-contain" />
            ) : (
              <span className="text-white text-xs font-bold">{property.agentName.charAt(0)}</span>
            )}
          </div>
          <p className="text-white font-semibold text-[15px] drop-shadow">{property.agentName}</p>
        </div>
      </div>

      {/* ── Bottom — badges + district + features (+ BAIA on right) ── */}
      <div className="absolute bottom-6 left-0 right-0 z-20 px-3">
        <div className="flex items-end gap-3">

          {/* Left column — text content */}
          <div className="flex-1 min-w-0">

            {/* Badges */}
            {property.badges && property.badges.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-1.5">
                {property.badges.map(badge => {
                  const { label, className } = BADGE_STYLES[badge]
                  return (
                    <span
                      key={badge}
                      className={`backdrop-blur-sm text-[11px] font-semibold px-2.5 py-1 rounded-full tracking-wide ${className}`}
                    >
                      {label}
                    </span>
                  )
                })}
              </div>
            )}

            {/* District + arrondissement */}
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin size={13} className="text-white shrink-0" />
              <p className="text-white font-bold text-[15px] leading-tight drop-shadow">
                {property.district} · {property.arrondissement}
              </p>
            </div>

            {/* Features — single line with check icons, truncated (Cave excluded like in detail sheet) */}
            {property.features && property.features.filter(f => f !== 'Cave').length > 0 && (
              <div className="flex items-center gap-x-3 overflow-hidden mb-0.5" style={{ maxHeight: '1.4em', maskImage: 'linear-gradient(to right, black 90%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black 90%, transparent 100%)' }}>
                {property.features.filter(f => f !== 'Cave').map(f => (
                  <div key={f} className="flex items-center gap-1 shrink-0">
                    <Check size={10} className="text-emerald-400 shrink-0" />
                    <span className="text-white text-[13px] drop-shadow">{f}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Typologie · surface · prix + Plus */}
            <div className="flex items-center gap-2">
              <Home size={13} strokeWidth={1.8} className="text-white shrink-0" />
              <p className="text-white text-[15px] drop-shadow">
                T{property.rooms} · {property.surface} m² · {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)} €
              </p>
              {onMore && (
                <button onClick={onMore} className="flex items-center gap-0 shrink-0">
                  <span className="text-white/65 text-[15px] font-bold">Plus</span>
                  <ChevronDown size={16} className="text-white/65 mt-px" />
                </button>
              )}
            </div>
          </div>

          {/* Right — BAIA */}
          {onBaia && (
            <button
              onClick={onBaia}
              className="shrink-0 w-14 h-14 rounded-full bg-white flex items-center justify-center shadow-lg hover:bg-white/90 transition-colors active:scale-95"
            >
              <span className="text-black font-black text-[13px] tracking-wider">BAIA</span>
            </button>
          )}
        </div>
      </div>
    </>
  )
}
