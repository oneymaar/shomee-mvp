'use client'

/**
 * P0 — Bloc « Partage » de l'éditeur de bien.
 *
 * Deux gestes, un garde-fou :
 *   - « Partager le bien » ouvre la feuille de partage du téléphone (WhatsApp,
 *     Messages, Mail…) avec le lien et son texte d'accompagnement. Le token est
 *     généré une fois pour toutes côté serveur : repartager rend le même lien,
 *     ceux déjà envoyés restent vivants.
 *   - « Partage public » coupe la page à distance — c'est le garde-fou des
 *     mandats off-market. Persistance immédiate, sans passer par la barre de
 *     sauvegarde de l'éditeur.
 *
 * Un bien archivé n'est pas partageable ; brouillon et dépublié le sont, c'est
 * l'avant-première.
 */

import { useCallback, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Loader2, Share } from 'lucide-react'
import clsx from 'clsx'
import { useShareBien } from './useShareBien'

// Aucune clé d'API ici : l'agent est authentifié par son cookie de session, et
// authenticateBearer l'accepte en repli. Une clé écrite en dur partait dans le
// bundle de tous les navigateurs — et comme c'était celle d'un AUTRE compte,
// chaque appel se heurtait au contrôle d'agence et revenait en 403.

export default function SharePropertyPanel({
  propertyId,
  statut,
  initialIsShareable,
}: {
  propertyId: string
  statut: string
  initialIsShareable: boolean
}) {
  const [isShareable, setIsShareable] = useState(initialIsShareable)
  const [toggling, setToggling] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)

  const { share, warm, busy, toast, error, fallbackUrl } = useShareBien(propertyId)

  const isArchived = statut === 'ARCHIVED'

  const toggleShareable = useCallback(
    async (next: boolean) => {
      if (toggling) return
      const previous = isShareable
      setIsShareable(next) // optimiste : l'interrupteur doit répondre au doigt
      setToggling(true)
      setToggleError(null)
      try {
        const res = await fetch(`/api/properties/${propertyId}/share-link`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isShareable: next }),
        })
        if (!res.ok) {
          setIsShareable(previous)
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          setToggleError(body?.error ?? 'Modification impossible, réessayez.')
        }
      } catch {
        setIsShareable(previous)
        setToggleError('Modification impossible, réessayez.')
      } finally {
        setToggling(false)
      }
    },
    [isShareable, propertyId, toggling],
  )

  return (
    <section className="relative bg-white border border-gray-200 rounded-2xl px-4 py-4 flex flex-col gap-3">
      <div>
        <h2 className="text-[15px] font-semibold text-[#0a0a0a]">Partage</h2>
        <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">
          Un lien public par bien, à envoyer à vos acquéreurs.
        </p>
      </div>

      <button
        type="button"
        onPointerDown={isArchived ? undefined : warm}
        onClick={share}
        disabled={isArchived || busy}
        className={clsx(
          'w-full py-3 rounded-xl font-semibold text-[14px] flex items-center justify-center gap-2 transition-colors',
          isArchived
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-[#0a0a0a] text-white active:bg-[#222]',
          busy && 'opacity-70',
        )}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Share size={15} />}
        Partager le bien
      </button>

      {isArchived && (
        <p className="text-[12px] text-gray-500 -mt-1">Désarchivez le bien pour le partager.</p>
      )}

      {fallbackUrl && (
        <input
          readOnly
          value={fallbackUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-[#0a0a0a]"
        />
      )}

      {/* Interrupteur — même dessin que les ToggleRow de l'éditeur. */}
      <div className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
        <span className="text-[13px] text-[#0a0a0a]">Partage public</span>
        <button
          type="button"
          onClick={() => toggleShareable(!isShareable)}
          disabled={toggling}
          role="switch"
          aria-checked={isShareable}
          aria-label="Partage public"
          className={clsx(
            'relative inline-flex items-center w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-60',
            isShareable ? 'bg-[#0a0a0a]' : 'bg-gray-300',
          )}
        >
          <span
            className={clsx(
              'inline-block w-4 h-4 rounded-full bg-white shadow transition-transform duration-150',
              isShareable ? 'translate-x-[24px]' : 'translate-x-[4px]',
            )}
          />
        </button>
      </div>

      {!isShareable && (
        <p className="text-[12px] text-gray-500 -mt-1">Le lien de partage est désactivé.</p>
      )}

      {(error || toggleError) && (
        <p className="text-[12px] text-red-600">{error ?? toggleError}</p>
      )}

      {/* Toast — posé dans le bloc, hors du flux, pour ne rien décaler. */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            className="absolute left-1/2 -translate-x-1/2 -top-3 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0a0a0a] text-white text-[12px] font-medium shadow-lg"
          >
            <Check size={13} strokeWidth={2.6} />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
