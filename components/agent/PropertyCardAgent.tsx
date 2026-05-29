'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { Video, Pencil, EyeOff, Check, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import type { PropertyStatus, MandatType } from '@prisma/client'

const DEMO_API_KEY = 'shomee_test_kr3tz_0001'

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
  DRAFT:       'Brouillon',
  PUBLISHED:   'Publié',
  UNPUBLISHED: 'Dépublié',
  ARCHIVED:    'Archivé',
}

const STATUT_STYLE: Record<PropertyStatus, string> = {
  DRAFT:       'bg-gray-200 text-gray-800',
  PUBLISHED:   'bg-emerald-100 text-emerald-700',
  UNPUBLISHED: 'bg-amber-100 text-amber-700',
  ARCHIVED:    'bg-red-100 text-red-700',
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(price)
}

type ConfirmKind = 'delete' | 'archive' | null

export default function PropertyCardAgent(props: PropertyCardAgentProps) {
  const {
    id, title, arrondissement, surface, price, statut, completionRate,
    videoUrl, imageUrlFallback, avantPremiere, mandatType, badges,
  } = props

  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null)

  const isExclusive = badges.includes('EXCLUSIVITE') || mandatType === 'EXCLUSIF'
  const isAvantPremiere = avantPremiere || badges.includes('AVANT_PREMIERE')
  const completionPct = Math.round(completionRate * 100)
  const isMuted = statut === 'DRAFT' || statut === 'UNPUBLISHED' || statut === 'ARCHIVED'
  const hasSecondaryBadges = isAvantPremiere || isExclusive

  async function setStatut(next: PropertyStatus) {
    setBusy(true)
    try {
      const res = await fetch(`/api/biens/${id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${DEMO_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ statut: next }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? 'Erreur')
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function hardDelete() {
    setBusy(true)
    try {
      const res = await fetch(`/api/biens/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${DEMO_API_KEY}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? 'Erreur')
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
      setConfirmKind(null)
    }
  }

  return (
    <article
      className={clsx(
        'rounded-2xl overflow-hidden transition-colors',
        isMuted
          ? 'bg-gray-50 border border-dashed border-gray-300'
          : 'bg-white border border-gray-200',
      )}
    >
      <Link href={`/agent/biens/${id}/editer`} className="block active:bg-black/[0.02]">
        <div className="flex gap-3 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrlFallback}
            alt=""
            loading="lazy"
            className={clsx(
              'rounded-xl object-cover flex-shrink-0 bg-gray-100',
              isMuted && 'opacity-75',
            )}
            style={{ width: 96, aspectRatio: '3 / 4' }}
          />

          <div className="flex-1 min-w-0 flex flex-col">
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

            {hasSecondaryBadges && (
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
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

            <h3 className="text-[14px] font-semibold text-[#0a0a0a] leading-tight truncate mt-2">{title}</h3>
            <p className="text-[12px] text-gray-500 truncate mt-0.5">{arrondissement} · {surface} m²</p>
            <p className="text-[14px] font-bold text-[#0a0a0a] mt-0.5">{formatPrice(price)}</p>

            <div className="mt-2">
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

            {!videoUrl && (
              <div className="flex items-center gap-1 mt-1.5 text-orange-600">
                <Video size={11} />
                <span className="text-[10px] font-medium">Vidéo manquante</span>
              </div>
            )}
          </div>
        </div>
      </Link>

      {/* Action buttons (outside Link so <button> isn't nested in <a>) */}
      <div className="flex border-t border-gray-200 divide-x divide-gray-200 text-xs">
        {statut === 'DRAFT' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStatut('PUBLISHED')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-semibold bg-gray-100 text-[#0a0a0a] active:bg-gray-200 disabled:opacity-60 transition-colors"
            >
              <Check size={13} strokeWidth={2.4} />
              Publier
            </button>
            <Link
              href={`/agent/biens/${id}/editer`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-gray-700 active:bg-gray-100 transition-colors"
            >
              <Pencil size={13} />
              Modifier
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmKind('delete')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-red-600 active:bg-red-50 disabled:opacity-60 transition-colors"
            >
              <Trash2 size={13} />
              Supprimer
            </button>
          </>
        )}

        {statut === 'PUBLISHED' && (
          <>
            <Link
              href={`/agent/biens/${id}/editer`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-gray-700 active:bg-gray-50 transition-colors"
            >
              <Pencil size={13} />
              Modifier
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStatut('UNPUBLISHED')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-gray-500 active:bg-gray-50 disabled:opacity-60 transition-colors"
            >
              <EyeOff size={13} />
              Dépublier
            </button>
          </>
        )}

        {statut === 'UNPUBLISHED' && (
          <>
            <Link
              href={`/agent/biens/${id}/editer`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-gray-700 active:bg-gray-50 transition-colors"
            >
              <Pencil size={13} />
              Modifier
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStatut('PUBLISHED')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-semibold bg-gray-100 text-[#0a0a0a] active:bg-gray-200 disabled:opacity-60 transition-colors"
            >
              <Check size={13} strokeWidth={2.4} />
              Publier
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmKind('archive')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-gray-700 active:bg-gray-50 disabled:opacity-60 transition-colors"
            >
              <Archive size={13} />
              Archiver
            </button>
          </>
        )}

        {statut === 'ARCHIVED' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStatut('UNPUBLISHED')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-gray-700 active:bg-gray-50 disabled:opacity-60 transition-colors"
            >
              <ArchiveRestore size={13} />
              Désarchiver
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmKind('delete')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium text-red-600 active:bg-red-50 disabled:opacity-60 transition-colors"
            >
              <Trash2 size={13} />
              Supprimer
            </button>
          </>
        )}
      </div>

      {confirmKind && (
        <ConfirmDialog
          kind={confirmKind}
          busy={busy}
          onCancel={() => setConfirmKind(null)}
          onConfirm={() => {
            if (confirmKind === 'delete') hardDelete()
            else setStatut('ARCHIVED').then(() => setConfirmKind(null))
          }}
        />
      )}
    </article>
  )
}

function ConfirmDialog({
  kind, busy, onCancel, onConfirm,
}: {
  kind: 'delete' | 'archive'
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const isDelete = kind === 'delete'
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-[180] bg-black/50 flex items-center justify-center px-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl"
      >
        <h3 className="text-[15px] font-semibold text-[#0a0a0a]">
          {isDelete ? 'Supprimer ce bien ?' : 'Archiver ce bien ?'}
        </h3>
        <p className="text-[13px] text-gray-600 mt-1.5 leading-snug">
          {isDelete
            ? 'Êtes-vous sûr de vouloir supprimer ce bien ? Cette action est définitive.'
            : 'Le bien ne sera plus visible dans votre dashboard. Vous le retrouverez dans la page Archives.'}
        </p>
        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[#0a0a0a] text-[13px] font-medium active:bg-gray-50 disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={clsx(
              'flex-1 py-2.5 rounded-xl text-white text-[13px] font-semibold disabled:opacity-60',
              isDelete ? 'bg-red-600 active:bg-red-700' : 'bg-[#0a0a0a] active:bg-[#222]',
            )}
          >
            {isDelete ? 'Supprimer' : 'Archiver'}
          </button>
        </div>
      </div>
    </div>
  )
}
