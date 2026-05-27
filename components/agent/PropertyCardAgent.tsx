import Link from 'next/link'
import clsx from 'clsx'
import { Video } from 'lucide-react'
import type { PropertyStatus, MandatType } from '@prisma/client'

interface PropertyCardAgentProps {
  id: string
  title: string
  arrondissement: string
  surface: number
  price: number
  statut: PropertyStatus
  completionRate: number
  videoUrl: string | null
  imageUrlFallback: string
  avantPremiere: boolean
  mandatType: MandatType
  badges: Array<'AVANT_PREMIERE' | 'EXCLUSIVITE'>
}

const STATUT_LABEL: Record<PropertyStatus, string> = {
  DRAFT:     'Brouillon',
  PUBLISHED: 'Publié',
  ARCHIVED:  'Archivé',
}

const STATUT_STYLE: Record<PropertyStatus, string> = {
  DRAFT:     'bg-gray-100 text-gray-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  ARCHIVED:  'bg-red-100 text-red-700',
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(price)
}

export default function PropertyCardAgent(props: PropertyCardAgentProps) {
  const {
    id, title, arrondissement, surface, price, statut, completionRate,
    videoUrl, imageUrlFallback, avantPremiere, mandatType, badges,
  } = props

  const isExclusive = badges.includes('EXCLUSIVITE') || mandatType === 'EXCLUSIF'
  const isAvantPremiere = avantPremiere || badges.includes('AVANT_PREMIERE')
  const completionPct = Math.round(completionRate * 100)

  return (
    <Link
      href={`/agent/biens/${id}/editer`}
      className="block bg-white border border-gray-200 rounded-2xl overflow-hidden active:bg-gray-50 transition-colors"
    >
      {/* Thumbnail — full width, 16/9 */}
      <div className="relative w-full bg-gray-100" style={{ aspectRatio: '16 / 9' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrlFallback}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      {/* Info section */}
      <div className="p-4 flex flex-col gap-1.5">
        {/* Line 1 — status pill */}
        <div>
          <span
            className={clsx(
              'inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full tracking-wide',
              STATUT_STYLE[statut],
            )}
          >
            {STATUT_LABEL[statut]}
          </span>
        </div>

        {/* Line 2 — avant-première / exclusivité pills */}
        {(isAvantPremiere || isExclusive) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {isAvantPremiere && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/40 text-amber-700">
                Avant-première
              </span>
            )}
            {isExclusive && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-400/15 border border-violet-400/40 text-violet-700">
                Exclusivité
              </span>
            )}
          </div>
        )}

        {/* Line 3 — title */}
        <h3 className="text-[15px] font-semibold text-[#0a0a0a] leading-tight truncate mt-1">{title}</h3>

        {/* Line 4 — location · surface */}
        <p className="text-[12px] text-gray-500 truncate">
          {arrondissement} · {surface} m²
        </p>

        {/* Line 5 — price */}
        <p className="text-[16px] font-bold text-[#0a0a0a] mt-0.5">{formatPrice(price)}</p>

        {/* Line 6 — completion bar */}
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
            <span>Complétion</span>
            <span className="font-medium text-[#0a0a0a]">{completionPct}%</span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-full rounded-full transition-all',
                completionPct >= 90 ? 'bg-emerald-500' : completionPct >= 60 ? 'bg-amber-500' : 'bg-red-400',
              )}
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Missing video banner */}
      {!videoUrl && (
        <div className="flex items-center gap-1.5 px-4 py-2 bg-orange-50 border-t border-orange-100 text-orange-700">
          <Video size={13} />
          <span className="text-[11px] font-medium">Vidéo manquante</span>
        </div>
      )}
    </Link>
  )
}
