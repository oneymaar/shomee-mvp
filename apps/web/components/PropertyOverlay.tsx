'use client'

/**
 * Surcouche du feed — posée en absolu par-dessus la VideoCard.
 *
 * Jumelle web de `apps/mobile/src/components/PropertyOverlay.tsx` : mêmes
 * tailles, mêmes icônes, même jauge de match terracotta. C'est l'un des deux
 * seuls écrans que voit un visiteur venu d'un lien LLM (parcours teaser S9),
 * il doit donc être au pixel près celui de l'app.
 */

import { useState, useEffect } from 'react'
import { Check, ChevronDown, CirclePlus, Home, MapPin } from 'lucide-react'
import type { Property } from '@/lib/types'
import { formatLocation } from '@shomee/core/utils/format'

interface PropertyOverlayProps {
  property: Property
  onMore?: () => void
  agencyTopOffset?: number
  /** Score de match en pourcentage (0..100). Absent → pas de jauge. */
  matchScore?: number
  isActive?: boolean
}

const TERRACOTTA = '#A64B27'
const TRACK = 'rgba(166,75,39,0.18)'
const CREAM = '#FDF5F2'

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

/* ── Jauge de match ───────────────────────────────────────────────────────
   Anneau terracotta sur piste terracotta pâle, disque crème au centre.
   Géométrie et rythme repris tels quels du natif (MatchBadge.tsx) :
   58 px, trait de 5, départ en haut, remplissage en 1,4 s (ease-out cubic). */
const SIZE = 58
const STROKE = 5
const R = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * R
const DISC = SIZE - STROKE * 2
const FILL_DURATION = 1400

function MatchBadge({ score, isActive }: { score: number; isActive: boolean }) {
  const [displayScore, setDisplayScore] = useState(0)

  useEffect(() => {
    if (!isActive) return
    let raf = 0
    let cancelled = false
    const start = performance.now()

    const tick = (now: number) => {
      if (cancelled) return
      const t = Math.min((now - start) / FILL_DURATION, 1)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic, comme le natif
      setDisplayScore(eased * score)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    // Remise à zéro + départ hors du corps de l'effet (react-hooks).
    queueMicrotask(() => {
      if (cancelled) return
      setDisplayScore(0)
      raf = requestAnimationFrame(tick)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [isActive, score])

  const clamped = Math.max(0, Math.min(100, displayScore))

  return (
    <div
      className="relative shrink-0 drop-shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
      style={{ width: SIZE, height: SIZE }}
    >
      <svg width={SIZE} height={SIZE} className="absolute inset-0" fill="none">
        {/* Piste */}
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={TRACK} strokeWidth={STROKE} fill="none" />
        {/* Jauge — départ en haut */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={TERRACOTTA}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped / 100)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>

      {/* Disque crème */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="rounded-full flex flex-col items-center justify-center"
          style={{ width: DISC, height: DISC, backgroundColor: CREAM }}
        >
          <span style={{ color: TERRACOTTA, fontWeight: 900, fontSize: 15, lineHeight: '16px' }}>
            {Math.round(clamped)}%
          </span>
          <span
            style={{ color: TERRACOTTA, fontWeight: 700, fontSize: 7, letterSpacing: '0.5px' }}
          >
            MATCH
          </span>
        </div>
      </div>
    </div>
  )
}

export default function PropertyOverlay({
  property,
  onMore,
  agencyTopOffset = 0,
  matchScore,
  isActive = false,
}: PropertyOverlayProps) {
  const brandName = property.agencyName ?? property.agentName
  const brandLogo = property.agencyLogo ?? property.agentAvatar
  const initial = (brandName?.trim().charAt(0) ?? '?').toUpperCase()
  const features = (property.features ?? []).filter((f) => f !== 'Cave')

  return (
    <>
      {/* ── Haut — agence ── */}
      <div
        className="absolute top-0 left-0 right-0 z-20 px-3"
        style={{ paddingTop: `calc(env(safe-area-inset-top, 0px) + ${12 + agencyTopOffset}px)` }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-neutral-900 border border-white/25 flex items-center justify-center">
            {brandLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brandLogo} alt={brandName} className="w-full h-full object-contain" />
            ) : (
              <span className="text-white text-[13px] font-bold">{initial}</span>
            )}
          </div>
          <p className="text-white font-semibold text-[15px] drop-shadow">{brandName}</p>
        </div>
      </div>

      {/* ── Bas — infos bien + jauge ── */}
      <div
        className="absolute left-0 right-0 z-20 px-3"
        style={{ bottom: 'calc(var(--nav-h) + 24px)' }}
      >
        <div className="flex items-end gap-3">
          {/* Colonne gauche */}
          <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
            {/* Badges — donnée propre au web, absente du seed. */}
            {property.badges && property.badges.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-0.5">
                {property.badges.map((badge) => {
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

            {/* Adresse */}
            <div className="flex items-center gap-1.5">
              <MapPin size={14} className="text-white shrink-0" />
              <p className="text-white font-bold text-[15px] leading-[19px] drop-shadow truncate">
                {formatLocation(property.arrondissement, property.district)}
              </p>
            </div>

            {/* Type · pièces · surface · prix */}
            <div className="flex items-center gap-1.5">
              <Home size={14} strokeWidth={1.8} className="text-white shrink-0" />
              <p className="text-white text-[15px] leading-[19px] drop-shadow truncate">
                Appartement · T{property.rooms} · {property.surface} m² ·{' '}
                {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)}{' '}
                €
              </p>
            </div>

            {/* Critères — une seule ligne, fondue vers la transparence sur les
                30 px de droite (même valeur que le masque natif). */}
            {features.length > 0 && (
              <div
                className="flex items-center gap-x-3 overflow-hidden"
                style={{
                  height: 20,
                  marginTop: 1,
                  maskImage:
                    'linear-gradient(to right, black calc(100% - 30px), transparent 100%)',
                  WebkitMaskImage:
                    'linear-gradient(to right, black calc(100% - 30px), transparent 100%)',
                }}
              >
                {features.map((f) => (
                  <div key={f} className="flex items-center gap-1 shrink-0">
                    <Check size={11} className="text-emerald-400 shrink-0" />
                    <span className="text-white text-[13px] drop-shadow">{f}</span>
                  </div>
                ))}
              </div>
            )}

            {/* L'icône en tête annonce la destination : c'est ici qu'on ouvre
                l'annonce détaillée. */}
            {onMore && (
              <button onClick={onMore} className="flex items-center gap-[5px] mt-[5px] self-start">
                <CirclePlus size={15} strokeWidth={1.8} className="text-white shrink-0" />
                <span className="text-white text-[14px] font-semibold underline underline-offset-2">
                  Voir l’annonce
                </span>
                <ChevronDown size={14} className="text-white" />
              </button>
            )}
          </div>

          {/* Colonne droite — jauge de match, alignée au bas de la colonne gauche */}
          {matchScore !== undefined && <MatchBadge score={matchScore} isActive={isActive} />}
        </div>
      </div>
    </>
  )
}
