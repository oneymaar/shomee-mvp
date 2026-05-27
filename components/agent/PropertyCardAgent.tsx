import Link from 'next/link'
import clsx from 'clsx'
import { Video, Pencil, EyeOff, Check } from 'lucide-react'
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
  DRAFT:     'bg-gray-200 text-gray-800',
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
  const isDraft = statut === 'DRAFT'

  return (
    <article
      className={clsx(
        'rounded-2xl overflow-hidden transition-colors',
        isDraft
          ? 'bg-gray-50 border border-dashed border-gray-300'
          : 'bg-white border border-gray-200',
      )}
    >
      {/* Clickable body — thumbnail left, info right */}
      <Link href={`/agent/biens/${id}/editer`} className="block active:bg-black/[0.02]">
        <div className="flex gap-3 p-3">
          {/* Thumbnail */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrlFallback}
            alt=""
            loading="lazy"
            className={clsx(
              'w-24 h-24 rounded-xl object-cover flex-shrink-0 bg-gray-100',
              isDraft && 'opacity-75',
            )}
          />

          {/* Info */}
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            {/* Status + secondary pills on one wrap row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={clsx(
                  'inline-block rounded-full tracking-wide',
                  STATUT_STYLE[statut],
                  isDraft
                    ? 'text-[12px] font-bold px-3 py-1'
                    : 'text-[11px] font-semibold px-2.5 py-0.5',
                )}
              >
                {STATUT_LABEL[statut]}
              </span>
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

            {/* Title */}
            <h3 className="text-[14px] font-semibold text-[#0a0a0a] leading-tight truncate mt-0.5">{title}</h3>

            {/* Location · surface */}
            <p className="text-[12px] text-gray-500 truncate">
              {arrondissement} · {surface} m²
            </p>

            {/* Price */}
            <p className="text-[14px] font-bold text-[#0a0a0a]">{formatPrice(price)}</p>

            {/* Completion bar */}
            <div className="mt-auto pt-1">
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                <span>Complétion</span>
                <span className="font-medium text-[#0a0a0a]">{completionPct}%</span>
              </div>
              <div className="h-1 bg-gray-200/60 rounded-full overflow-hidden">
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
      </Link>

      {/* Action buttons row (outside Link so buttons aren't nested in <a>) */}
      <div className="flex border-t border-gray-200 divide-x divide-gray-200 text-xs">
        {statut === 'DRAFT' && (
          <>
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-semibold bg-emerald-50 text-emerald-700 active:bg-emerald-100 transition-colors"
            >
              <Check size={13} strokeWidth={2.4} />
              Publier
            </button>
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-gray-700 active:bg-gray-100 transition-colors"
            >
              <Pencil size={13} />
              Modifier
            </button>
          </>
        )}
        {statut === 'PUBLISHED' && (
          <>
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-gray-700 active:bg-gray-50 transition-colors"
            >
              <Pencil size={13} />
              Modifier
            </button>
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-gray-500 active:bg-gray-50 transition-colors"
            >
              <EyeOff size={13} />
              Dépublier
            </button>
          </>
        )}
        {statut === 'ARCHIVED' && (
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-gray-700 active:bg-gray-50 transition-colors"
          >
            <Pencil size={13} />
            Modifier
          </button>
        )}
      </div>

      {/* Missing video banner */}
      {!videoUrl && (
        <div className="flex items-center gap-1.5 px-4 py-2 bg-orange-50 border-t border-orange-100 text-orange-700">
          <Video size={13} />
          <span className="text-[11px] font-medium">Vidéo manquante</span>
        </div>
      )}
    </article>
  )
}
