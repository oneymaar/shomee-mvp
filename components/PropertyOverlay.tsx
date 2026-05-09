'use client'

import { ChevronDown, MapPin, Check, Home, Sparkles } from 'lucide-react'
import type { Property } from '@/lib/types'
import { formatLocation } from '@/lib/format'

interface PropertyOverlayProps {
  property: Property
  onMore?: () => void
  agencyTopOffset?: number
  matchScore?: number
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

function MatchBadge({ score, gradId }: { score: number; gradId: string }) {
  const r = 42
  const strokeW = 7
  const circumference = 2 * Math.PI * r
  const dashoffset = circumference * (1 - score / 100)
  // Inner cream circle sits inside the stroke: stroke outer edge = r + strokeW/2
  // Rendered size 56px, viewBox 100 → 1 SVG unit = 0.56px
  // Inner inset in px ≈ (strokeW/2 + 1) / 100 * 56 ≈ 2.5px → use 3px
  const innerInset = 3

  return (
    <div className="relative shrink-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]" style={{ width: 56, height: 56 }}>
      {/* SVG gauge */}
      <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="50%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#14b8a6" />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth={strokeW} />
        {/* Progress arc — starts from top (12h) via rotate -90° */}
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          transform="rotate(-90 50 50)"
        />
      </svg>

      {/* Cream inner circle */}
      <div
        className="absolute rounded-full"
        style={{ inset: innerInset, backgroundColor: '#f5f0e8', zIndex: 1 }}
      />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ zIndex: 2, gap: 1 }}>
        <Sparkles size={11} strokeWidth={1.8} style={{ color: '#3b82f6' }} />
        <span style={{ color: '#914E3C', fontWeight: 900, fontSize: 14, lineHeight: 1 }}>{score}%</span>
        <span style={{ color: '#914E3C', fontWeight: 700, fontSize: 6.5, letterSpacing: '0.07em', lineHeight: 1.2 }}>MATCH</span>
      </div>
    </div>
  )
}

export default function PropertyOverlay({ property, onMore, agencyTopOffset = 0, matchScore }: PropertyOverlayProps) {
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

      {/* ── Bottom — info + match score ── */}
      <div className="absolute left-0 right-0 z-20 px-3" style={{ bottom: 'calc(var(--nav-h) + 24px)' }}>

        {/* Row: text content + match badge */}
        <div className="flex items-end gap-3">

          {/* Left — text stack */}
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
                className="flex items-center gap-x-3 overflow-hidden"
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
          </div>

          {/* Right — match gauge badge */}
          {matchScore !== undefined && (
            <MatchBadge score={matchScore} gradId={`gauge-${property.id}`} />
          )}
        </div>

        {/* Voir l'annonce — own line, left-aligned */}
        {onMore && (
          <button onClick={onMore} className="flex items-center gap-0.5 mt-1.5">
            <span className="text-white text-[14px] font-semibold underline underline-offset-2">Voir l'annonce</span>
            <ChevronDown size={14} className="text-white mt-px" />
          </button>
        )}
      </div>
    </>
  )
}
