'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Video, Pencil, EyeOff, Check, Trash2, Archive, ArchiveRestore, Share, Loader2 } from 'lucide-react'
import type { PropertyStatus, MandatType } from '@prisma/client'
import { useShareBien } from './useShareBien'
import { couleurs, SERIF } from '@/lib/theme'

// Aucune clé d'API ici : l'agent est authentifié par son cookie de session, et
// authenticateBearer l'accepte en repli. Une clé écrite en dur partait dans le
// bundle de tous les navigateurs — et comme c'était celle d'un AUTRE compte,
// chaque appel se heurtait au contrôle d'agence et revenait en 403.

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

/** Un fond, une encre — pris dans la charte, jamais dans la palette Tailwind. */
const STATUT_STYLE: Record<PropertyStatus, { backgroundColor: string; color: string }> = {
  DRAFT:       { backgroundColor: couleurs.sable,     color: couleurs.doux },
  PUBLISHED:   { backgroundColor: couleurs.vertPale,  color: couleurs.vert },
  UNPUBLISHED: { backgroundColor: '#F1E9E2',          color: couleurs.encre },
  ARCHIVED:    { backgroundColor: '#F6E5E0',          color: couleurs.alerte },
}

/** Bouton d'action d'une carte — trois intentions, trois peintures. */
const ACTION = {
  principale: { backgroundColor: couleurs.terracotta, color: couleurs.cremeSurSombre },
  neutre:     { color: couleurs.doux },
  destructive:{ color: couleurs.alerte },
} as const

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

  // P0 — partage depuis la liste : l'agent envoie un bien sans avoir a l'ouvrir.
  const {
    share: shareBien,
    warm: warmShare,
    busy: shareBusy,
    toast: shareToast,
    error: shareError,
    fallbackUrl: shareFallbackUrl,
  } = useShareBien(id)

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
        headers: { 'Content-Type': 'application/json' },
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
      className="rounded-2xl overflow-hidden transition-colors"
      style={
        isMuted
          ? { backgroundColor: '#FDFAF7', border: `1px dashed ${couleurs.ligne}` }
          : { backgroundColor: couleurs.carte, border: `1px solid ${couleurs.ligne}` }
      }
    >
      <Link href={`/agent/biens/${id}/editer`} className="block active:bg-black/[0.02]">
        <div className="flex gap-3 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrlFallback}
            alt=""
            loading="lazy"
            className={clsx('rounded-xl object-cover flex-shrink-0', isMuted && 'opacity-75')}
            style={{ width: 96, aspectRatio: '3 / 4', backgroundColor: couleurs.sable }}
          />

          <div className="flex-1 min-w-0 flex flex-col">
            <div>
              <span
                className="inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full tracking-wide"
                style={STATUT_STYLE[statut]}
              >
                {STATUT_LABEL[statut]}
              </span>
            </div>

            {hasSecondaryBadges && (
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                {isAvantPremiere && (
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: couleurs.sable, color: couleurs.encre, border: `1px solid ${couleurs.ligne}` }}
                  >
                    Avant-première
                  </span>
                )}
                {isExclusive && (
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'rgba(166,81,43,.08)', color: couleurs.terracotta, border: '1px solid rgba(166,81,43,.22)' }}
                  >
                    Exclusivité
                  </span>
                )}
              </div>
            )}

            <h3 className="text-[14px] font-semibold leading-tight truncate mt-2" style={{ color: couleurs.encre }}>{title}</h3>
            <p className="text-[12px] truncate mt-0.5" style={{ color: couleurs.doux }}>{arrondissement} · {surface} m²</p>
            <p className="mt-1" style={{ fontFamily: SERIF, fontSize: 18, color: couleurs.encre }}>{formatPrice(price)}</p>

            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: couleurs.doux }}>
                <span>Complétion</span>
                <span className="font-semibold" style={{ color: couleurs.encre }}>{completionPct}%</span>
              </div>
              {/* Une seule couleur de progression : le terracotta de la marque,
                  qui passe au vert quand la fiche est complète. Trois couleurs
                  (rouge/ambre/vert) faisaient croire à une alerte là où il n'y
                  a qu'un remplissage en cours. */}
              <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: couleurs.sable }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${completionPct}%`,
                    backgroundColor: completionPct >= 100 ? couleurs.vert : couleurs.terracotta,
                  }}
                />
              </div>
            </div>

            {!videoUrl && (
              <div className="flex items-center gap-1 mt-1.5" style={{ color: couleurs.alerte }}>
                <Video size={11} />
                <span className="text-[10px] font-medium">Vidéo manquante</span>
              </div>
            )}
          </div>
        </div>
      </Link>

      {/* Action buttons (outside Link so <button> isn't nested in <a>) */}
      <div
        className="flex text-xs"
        style={{ borderTop: `1px solid ${couleurs.ligne}` }}
      >
        {statut === 'DRAFT' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStatut('PUBLISHED')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-semibold disabled:opacity-60 transition-colors active:opacity-85"
              style={ACTION.principale}
            >
              <Check size={13} strokeWidth={2.4} />
              Publier
            </button>
            <Link
              href={`/agent/biens/${id}/editer`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium disabled:opacity-60 transition-colors active:opacity-70"
              style={{ ...ACTION.neutre, borderLeft: `1px solid ${couleurs.ligne}` }}
            >
              <Pencil size={13} />
              Modifier
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmKind('delete')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium disabled:opacity-60 transition-colors active:opacity-70"
              style={{ ...ACTION.destructive, borderLeft: `1px solid ${couleurs.ligne}` }}
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
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium disabled:opacity-60 transition-colors active:opacity-70"
              style={{ ...ACTION.neutre, borderLeft: `1px solid ${couleurs.ligne}` }}
            >
              <Pencil size={13} />
              Modifier
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStatut('UNPUBLISHED')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium disabled:opacity-60 transition-colors active:opacity-70"
              style={{ ...ACTION.neutre, borderLeft: `1px solid ${couleurs.ligne}` }}
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
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium disabled:opacity-60 transition-colors active:opacity-70"
              style={{ ...ACTION.neutre, borderLeft: `1px solid ${couleurs.ligne}` }}
            >
              <Pencil size={13} />
              Modifier
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStatut('PUBLISHED')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-semibold disabled:opacity-60 transition-colors active:opacity-85"
              style={ACTION.principale}
            >
              <Check size={13} strokeWidth={2.4} />
              Publier
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmKind('archive')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium disabled:opacity-60 transition-colors active:opacity-70"
              style={{ ...ACTION.neutre, borderLeft: `1px solid ${couleurs.ligne}` }}
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
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium disabled:opacity-60 transition-colors active:opacity-70"
              style={{ ...ACTION.neutre, borderLeft: `1px solid ${couleurs.ligne}` }}
            >
              <ArchiveRestore size={13} />
              Désarchiver
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmKind('delete')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-medium disabled:opacity-60 transition-colors active:opacity-70"
              style={{ ...ACTION.destructive, borderLeft: `1px solid ${couleurs.ligne}` }}
            >
              <Trash2 size={13} />
              Supprimer
            </button>
          </>
        )}
      </div>

      {/* P0 — partage : disponible directement dans la liste, archives exclues. */}
      {statut !== 'ARCHIVED' && (
        <div style={{ borderTop: `1px solid ${couleurs.ligne}` }}>
          <button
            type="button"
            onPointerDown={warmShare}
            onClick={shareBien}
            disabled={shareBusy}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold disabled:opacity-60 transition-colors active:opacity-70"
            style={{ color: couleurs.encre }}
          >
            {shareBusy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : shareToast ? (
              <Check size={13} strokeWidth={2.4} />
            ) : (
              <Share size={13} />
            )}
            {shareToast ?? 'Partager le bien'}
          </button>

          {shareFallbackUrl && (
            <input
              readOnly
              value={shareFallbackUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full px-3 py-2 text-[11px]"
              style={{ backgroundColor: '#FDFAF7', borderTop: `1px solid ${couleurs.ligne}`, color: couleurs.encre }}
            />
          )}
          {shareError && (
            <p className="px-3 pb-2 text-[11px]" style={{ color: couleurs.alerte }}>{shareError}</p>
          )}
        </div>
      )}

      <AnimatePresence>
        {confirmKind && (
          <ConfirmDialog
            key="confirm"
            kind={confirmKind}
            busy={busy}
            onCancel={() => setConfirmKind(null)}
            onConfirm={() => {
              if (confirmKind === 'delete') hardDelete()
              else setStatut('ARCHIVED').then(() => setConfirmKind(null))
            }}
          />
        )}
      </AnimatePresence>
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
    <motion.div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[180] bg-black/50 flex items-center justify-center px-6"
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit   ={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-sm rounded-3xl p-5 shadow-xl"
        style={{ backgroundColor: couleurs.carte }}
      >
        <h3 className="text-[17px]" style={{ fontFamily: SERIF, color: couleurs.encre }}>
          {isDelete ? 'Supprimer ce bien ?' : 'Archiver ce bien ?'}
        </h3>
        <p className="text-[13.5px] mt-2 leading-snug" style={{ color: couleurs.doux }}>
          {isDelete
            ? 'Êtes-vous sûr de vouloir supprimer ce bien ? Cette action est définitive.'
            : 'Le bien ne sera plus visible dans votre dashboard. Vous le retrouverez dans la page Archives.'}
        </p>
        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2.5 rounded-full text-[13.5px] font-medium disabled:opacity-60"
            style={{ border: `1px solid ${couleurs.ligne}`, color: couleurs.doux }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-2.5 rounded-full text-[13.5px] font-semibold disabled:opacity-60 active:opacity-85"
            style={{
              backgroundColor: isDelete ? couleurs.alerte : couleurs.encre,
              color: couleurs.cremeSurSombre,
            }}
          >
            {isDelete ? 'Supprimer' : 'Archiver'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
