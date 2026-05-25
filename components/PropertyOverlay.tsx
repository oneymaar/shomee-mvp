'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronDown, MapPin, Check, Home } from 'lucide-react'
import type { Property } from '@/lib/types'
import { formatLocation } from '@/lib/format'

interface PropertyOverlayProps {
  property: Property
  onMore?: () => void
  agencyTopOffset?: number
  matchScore?: number
  isActive?: boolean
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

function MatchBadge({ score, isActive }: { score: number; isActive: boolean }) {
  const [displayScore, setDisplayScore] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!isActive) return
    // Reset and animate when card becomes active
    setDisplayScore(0)
    const duration = 2000
    const start = performance.now()

    const tick = (now: number) => {
      const elapsed = now - start
      const t = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplayScore(Math.round(eased * score))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isActive, score])

  return (
    <div
      className="relative shrink-0 drop-shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
      style={{ width: 58, height: 58 }}
    >
      {/* Outer ring — conic-gradient gauge, clearly OUTSIDE inner circle */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, #3b82f6 0%, #6366f1 ${displayScore / 2}%, #14b8a6 ${displayScore}%, rgba(0,0,0,0.10) ${displayScore}% 100%)`,
        }}
      />
      {/* Inner cream circle — 7px ring visible */}
      <div
        className="absolute rounded-full"
        style={{ inset: 7, backgroundColor: '#FDF5F2' }}
      />
      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap: 2 }}>
        <span style={{ color: '#BC4F29', fontWeight: 900, fontSize: 15, lineHeight: 1 }}>
          {displayScore}%
        </span>
        <span style={{ color: '#BC4F29', fontWeight: 700, fontSize: 6.5, letterSpacing: '0.07em', lineHeight: 1 }}>
          MATCH
        </span>
      </div>
    </div>
  )
}

export default function PropertyOverlay({ property, onMore, agencyTopOffset = 0, matchScore, isActive = false }: PropertyOverlayProps) {
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

      {/* ── Bottom ── */}
      <div className="absolute left-0 right-0 z-20 px-3" style={{ bottom: 'calc(var(--nav-h) + 24px)' }}>
        <div className="flex items-end gap-3">

          {/* Left — text stack + Voir l'annonce at bottom */}
          <div className="flex-1 min-w-0">

            {/* Badges */}
            {property.badges && property.badges.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-1.5">
                {property.badges.map(badge => {
                  const { label, className } = BADGE_STYLES[badge]
                  return (
                    <span key={badge} className={`backdrop-blur-sm text-[11px] font-semibold px-2.5 py-1 rounded-full tracking-wide ${className}`}>
                      {label}
                    </span>
                  )
                })}
              </div>
            )}

            {/* Address */}
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin size={13} className="text-white shrink-0" />
              <p className="text-white font-bold text-[15px] leading-tight drop-shadow">
                {formatLocation(property.arrondissement, property.district)}
              </p>
            </div>

            {/* Type · rooms · surface · price */}
            <div className="flex items-center gap-2 mb-0.5">
              <Home size={13} strokeWidth={1.8} className="text-white shrink-0" />
              <p className="text-white text-[15px] drop-shadow">
                Appartement · T{property.rooms} · {property.surface} m² · {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)} €
              </p>
            </div>

            {/* Criteria */}
            {property.features && property.features.filter(f => f !== 'Cave').length > 0 && (
              <div
                className="flex items-center gap-x-3 overflow-hidden mb-1"
                style={{ maxHeight: '1.4em', maskImage: 'linear-gradient(to right, black 85%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)' }}
              >
                {property.features.filter(f => f !== 'Cave').map(f => (
                  <div key={f} className="flex items-center gap-1 shrink-0">
                    <Check size={10} className="text-emerald-400 shrink-0" />
                    <span className="text-white text-[13px] drop-shadow">{f}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Voir l'annonce — bottom of left column, aligns with badge */}
            {onMore && (
              <button onClick={onMore} className="flex items-center gap-0.5">
                <span className="text-white text-[14px] font-semibold underline underline-offset-2">Voir l'annonce</span>
                <ChevronDown size={14} className="text-white mt-px" />
              </button>
            )}
          </div>

          {/* Right — match gauge badge, bottom-aligned with left column */}
          {matchScore !== undefined && (
            <MatchBadge score={matchScore} isActive={isActive} />
          )}
        </div>
      </div>
    </>
  )
}
