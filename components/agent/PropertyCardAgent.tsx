import Link from 'next/link'
import clsx from 'clsx'
import { Video, Star, Sparkles } from 'lucide-react'
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
  DRAFT:     'BROUILLON',
  PUBLISHED: 'PUBLIÉ',
  ARCHIVED:  'ARCHIVÉ',
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
      <div className="flex gap-3 p-3">
        {/* Thumbnail */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrlFallback}
          alt=""
          loading="lazy"
          className="w-24 h-24 rounded-xl object-cover flex-shrink-0 bg-gray-100"
        />

        {/* Right side */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top row: status + plan tags */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded tracking-wide', STATUT_STYLE[statut])}>
              {STATUT_LABEL[statut]}
            </span>
            {isExclusive && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#0a0a0a] text-white tracking-wide inline-flex items-center gap-0.5">
                <Star size={9} className="fill-current" />
                EXCLU
              </span>
            )}
            {isAvantPremiere && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 tracking-wide inline-flex items-center gap-0.5">
                <Sparkles size={9} />
                AVANT-PREMIÈRE
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-[14px] font-semibold text-[#0a0a0a] leading-tight truncate">{title}</h3>

          {/* Address + surface */}
          <p className="text-[12px] text-gray-500 mt-0.5 truncate">
            {arrondissement} · {surface} m²
          </p>

          {/* Price */}
          <p className="text-[14px] font-semibold text-[#0a0a0a] mt-1">{formatPrice(price)}</p>

          {/* Completion bar */}
          <div className="mt-auto pt-2">
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
      </div>

      {/* Missing video banner */}
      {!videoUrl && (
        <div className="flex items-center gap-1.5 px-3 py-2 bg-orange-50 border-t border-orange-100 text-orange-700">
          <Video size={13} />
          <span className="text-[11px] font-medium">Vidéo manquante</span>
        </div>
      )}
    </Link>
  )
}
