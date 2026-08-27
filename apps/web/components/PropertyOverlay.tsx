'use client'

/**
 * Surcouche du feed — posée en absolu par-dessus la VideoCard.
 *
 * Jumelle web de `apps/mobile/src/components/PropertyOverlay.tsx`. Elle avait
 * pris deux mois de retard sur le natif : c'est ce décalage que la
 * prévisualisation agent donnait à voir (« l'ancien design du feed »). Elle
 * reprend maintenant la hiérarchie de la REFONTE (direction A, 21/08) :
 *
 *   1. la LOCALISATION passe en tête, en petites capitales — l'info n°1 ;
 *   2. le PRIX descend en serif 23 px, avec le €/m² en retrait : « on vend du
 *      luxe, le prix ne doit pas sauter aux yeux » ;
 *   3. les caractéristiques essentielles sur une ligne ;
 *   4. les critères satisfaits à coche verte, fondus au bord droit ;
 *   5. « Voir l'annonce » devient un bouton FANTÔME (pilule bordée), chevron
 *      vers le BAS — la fiche s'ouvre en descendant.
 *
 * Le dégradé de lisibilité, lui, reste porté par la VideoCard — un seul
 * calque, en noir CHAUD (#140F0C) : un noir pur jure avec la palette.
 */

import { useState, useEffect } from 'react'
import { Check, ChevronDown, MapPin } from 'lucide-react'
import type { Property } from '@/lib/types'
import { formatLocation } from '@shomee/core/utils/format'
import { couleurs, SERIF, taillesSerif } from '@/lib/theme'

interface PropertyOverlayProps {
  property: Property
  onMore?: () => void
  agencyTopOffset?: number
  /** Score de match en pourcentage (0..100). Absent → pas de jauge. */
  matchScore?: number
  isActive?: boolean
  /** Le bloc du haut gère lui-même l'encoche. Faux quand un bandeau est déjà
   *  posé au-dessus (prévisualisation agent) et a consommé la marge. */
  safeTop?: boolean
}

const TERRACOTTA = couleurs.terracotta
const TRACK = 'rgba(166,81,43,0.18)'
const OMBRE = '0 1px 8px rgba(0,0,0,0.45)'

const BADGE_STYLES = {
  'avant-premiere': { label: 'Avant-première' },
  'exclusivite': { label: 'Exclusivité' },
} as const

/** Prix formaté « 1 350 000 € ». */
function formatPrice(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}

/* ── Jauge de match ───────────────────────────────────────────────────────
   Anneau terracotta sur piste terracotta pâle, disque crème au centre.
   Géométrie et rythme repris tels quels du natif (MatchBadge.tsx). */
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
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={TRACK} strokeWidth={STROKE} fill="none" />
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

      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="rounded-full flex flex-col items-center justify-center"
          style={{ width: DISC, height: DISC, backgroundColor: couleurs.creme }}
        >
          <span style={{ color: TERRACOTTA, fontFamily: SERIF, fontSize: taillesSerif.score, lineHeight: '21px' }}>
            {Math.round(clamped)}
          </span>
          <span style={{ color: TERRACOTTA, fontWeight: 700, fontSize: 7, letterSpacing: '0.5px' }}>
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
  safeTop = true,
}: PropertyOverlayProps) {
  const brandName = property.agencyName ?? property.agentName
  const brandLogo = property.agencyLogo ?? property.agentAvatar
  const initial = (brandName?.trim().charAt(0) ?? '?').toUpperCase()

  // Coches vertes = critères RÉELLEMENT satisfaits quand le moteur les fournit,
  // sinon les caractéristiques du bien — comportement du natif.
  const matched = property.matchedCriteria ?? []
  const tags = (matched.length > 0 ? matched : (property.features ?? [])).filter((f) => f !== 'Cave')

  // €/m² : fourni par l'API quand il existe, sinon déduit. Jamais affiché sans
  // surface (division impossible).
  const perSqm =
    property.pricePerSqm ?? (property.surface > 0 ? property.price / property.surface : null)

  const specs = [
    `T${property.rooms}`,
    property.bedrooms != null && property.bedrooms > 0
      ? `${property.bedrooms} chambre${property.bedrooms > 1 ? 's' : ''}`
      : null,
    `${property.surface} m²`,
    property.floor != null && property.floor > 0 ? `${property.floor}ᵉ étage` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const hautMarge = safeTop
    ? `calc(env(safe-area-inset-top, 0px) + ${12 + agencyTopOffset}px)`
    : `${12 + agencyTopOffset}px`

  return (
    <>
      {/* ── Haut — agence. Le logo reste ROND (consigne du 20/08). ── */}
      <div className="absolute top-0 left-0 right-0 z-20 px-4" style={{ paddingTop: hautMarge }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-10 h-10 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
            style={{ backgroundColor: couleurs.cremeSurSombre }}
          >
            {brandLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brandLogo} alt={brandName} className="w-full h-full object-contain" />
            ) : (
              <span style={{ fontFamily: SERIF, fontSize: taillesSerif.avatar, color: couleurs.encre }}>
                {initial}
              </span>
            )}
          </div>
          <p className="text-white font-semibold text-[15px] truncate" style={{ textShadow: OMBRE }}>
            {brandName}
          </p>
        </div>
      </div>

      {/* ── Bas — infos bien + jauge ── */}
      <div className="absolute left-4 right-4 z-20" style={{ bottom: 'calc(var(--nav-h) + 24px)' }}>
        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-0">
            {/* Badges — donnée propre au web. */}
            {property.badges && property.badges.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {property.badges.map((badge) => (
                  <span
                    key={badge}
                    className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full tracking-wide"
                    style={{
                      backgroundColor: couleurs.fumeeLegere,
                      border: `1px solid ${couleurs.bordFantome}`,
                      color: couleurs.cremeSurSombre,
                      backdropFilter: 'blur(4px)',
                    }}
                  >
                    {BADGE_STYLES[badge].label}
                  </span>
                ))}
              </div>
            )}

            {/* 1. La localisation — l'info n°1 */}
            <div className="flex items-center gap-[5px] max-w-full">
              <MapPin size={11} strokeWidth={2.2} className="shrink-0" color={couleurs.cremeSurSombre} />
              <p
                className="truncate text-[10.5px] font-semibold"
                style={{ color: couleurs.cremeSurSombre, letterSpacing: '1.5px', textShadow: OMBRE }}
              >
                {formatLocation(property.arrondissement, property.district).toUpperCase()}
              </p>
            </div>

            {/* 2. Le prix, en serif discrète, €/m² en retrait */}
            <div className="flex items-baseline gap-2 mt-2 mb-px">
              <span
                className="text-white"
                style={{ fontFamily: SERIF, fontSize: taillesSerif.prixFeed, textShadow: OMBRE }}
              >
                {formatPrice(property.price)}
              </span>
              {perSqm != null && (
                <span className="text-[12.5px] font-medium" style={{ color: 'rgba(246,237,230,0.7)' }}>
                  {formatPrice(perSqm).replace(' €', ' €/m²')}
                </span>
              )}
            </div>

            {/* 3. Les caractéristiques essentielles */}
            <p
              className="truncate text-[13px] font-medium mb-1.5"
              style={{ color: 'rgba(246,237,230,0.88)', textShadow: OMBRE }}
            >
              {specs}
            </p>

            {/* 4. Les critères satisfaits — coche verte, fondu au bord droit.
                Le fondu DIT qu'il reste quelque chose de ce côté-là. */}
            {tags.length > 0 && (
              <div
                className="flex items-center gap-x-3 overflow-x-auto scrollbar-hide mb-2.5"
                style={{
                  height: 18,
                  maskImage: 'linear-gradient(to right, black calc(100% - 30px), transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 30px), transparent 100%)',
                }}
              >
                {tags.map((f) => (
                  <div key={f} className="flex items-center gap-1 shrink-0">
                    <Check size={12} strokeWidth={2.4} color={couleurs.vertSurSombre} className="shrink-0" />
                    <span className="text-[11.5px] font-medium whitespace-nowrap" style={{ color: 'rgba(246,237,230,0.85)' }}>
                      {f}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 5. Le bouton fantôme — chevron vers le BAS. */}
            {onMore && (
              <button
                type="button"
                onClick={onMore}
                className="inline-flex items-center justify-center gap-[5px] active:opacity-75 transition-opacity"
                style={{
                  height: 34,
                  paddingLeft: 14,
                  paddingRight: 14,
                  borderRadius: 17,
                  border: `1px solid ${couleurs.bordFantome}`,
                  backgroundColor: couleurs.fumeeLegere,
                  backdropFilter: 'blur(4px)',
                }}
              >
                <span className="text-[12.5px] font-semibold" style={{ color: couleurs.cremeSurSombre }}>
                  Voir l’annonce
                </span>
                <ChevronDown size={15} strokeWidth={2.2} color={couleurs.cremeSurSombre} />
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
