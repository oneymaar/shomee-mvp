'use client'

/**
 * P0 — Vue publique d'un bien partagé (`/p/<token>`).
 *
 * Ce que voit le client d'un agent quand il tape sur le lien reçu dans
 * WhatsApp : la visite, plein écran, tout de suite. Trois règles de dessin :
 *
 *  1. L'écran de visite ne porte AUCUN bouton. Il montre le bien, le prix,
 *     l'agence qui l'envoie — rien d'autre. La conversion est portée par la
 *     feuille qui monte au bout de quelques secondes.
 *  2. La vidéo ne s'arrête jamais et reste visible : la feuille ne couvre que
 *     le bas de l'écran, on la repousse vers le bas pour revenir à la visite.
 *  3. Mobile d'abord. Sur desktop, colonne centrée à la largeur d'un téléphone
 *     sur fond sombre — digne, sans plus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import { ChevronDown, ChevronRight, CirclePlus, Home, MapPin, Volume2 } from 'lucide-react'
import { formatLocation } from '@shomee/core/utils/format'
import PropertyDetailSheet from '@/components/PropertyDetailSheet'
import VideoProgressBar from '@/components/VideoProgressBar'
import type { Property } from '@/lib/types'

const TERRACOTTA = '#A64B27'
const CREAM = '#FDF5F2'
const INK = '#0a0a0a'
const NIGHT = '#0B0705'

/** Cookie d'attribution posé quand le lien porte un `?ref=`. */
const REF_COOKIE = 'shomee_ref'
const REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 jours

/**
 * Délai avant que la feuille ne monte. Volontairement un compte à rebours fixe
 * et non « la fin de la vidéo » : c'est prévisible, ça ne dépend ni de la durée
 * du clip ni de la vitesse du réseau, et ça arrive pendant que l'envie est
 * encore chaude.
 */
const INVITATION_DELAY_MS = 10000

/**
 * Seconde chance. L'écran de visite ne porte aucun bouton : une fois la
 * feuille repoussée, plus rien ne propose quoi que ce soit. On la fait donc
 * remonter une fois — et une seule. Repoussée deux fois, la réponse est non.
 */
const SECOND_CHANCE_MS = 30000

/** Course/vitesse au-delà desquelles un glissement vers le bas referme. */
const DISMISS_OFFSET_PX = 90
const DISMISS_VELOCITY = 480

export interface SharedPropertyView {
  typeLabel: string
  rooms: number
  surface: number
  price: number
  arrondissement: string
  district: string
  videoUrl: string | null
  posterUrl: string | null
  imageUrl: string
  agencyName: string
  agencyLogo: string | null
}

function formatPrice(price: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(price)} €`
}

export default function ShareVideoView({
  property,
  fullProperty,
  refParam,
}: {
  property: SharedPropertyView
  /** View-model complet — alimente la fiche du bien, celle de l'app. */
  fullProperty: Property
  /** Valeur brute du `?ref=` de l'URL. Nommée ainsi pour ne pas empiéter sur
   *  la prop `ref` de React. */
  refParam: string | null
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [invitationOpen, setInvitationOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)
  const dismissalsRef = useRef(0)
  const secondChanceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ── Cookie d'attribution ──
     Posé côté client : un composant serveur n'a pas le droit d'écrire un
     cookie pendant son rendu, et cette valeur n'a rien de sensible. Elle
     n'alimente RIEN pour l'instant — elle attend le chantier d'attribution. */
  useEffect(() => {
    if (!refParam) return
    try {
      const secure = window.location.protocol === 'https:' ? '; Secure' : ''
      document.cookie =
        `${REF_COOKIE}=${encodeURIComponent(refParam)}` +
        `; path=/; max-age=${REF_COOKIE_MAX_AGE}; SameSite=Lax${secure}`
    } catch {
      /* cookies refusés : l'attribution saute, la visite continue */
    }
  }, [refParam])

  /* ── Lecture automatique ──
     L'attribut `autoPlay` suffit dans la plupart des cas ; on relance
     explicitement en muet si le navigateur a refusé, pour ne jamais laisser
     la visite figée sur la première frame. */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    video.play().catch(() => {
      /* refus d'autoplay : le poster reste affiché, un tap relancera */
    })
  }, [])

  /* ── La feuille monte au bout du délai ── */
  useEffect(() => {
    const timer = setTimeout(() => setInvitationOpen(true), INVITATION_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    return () => {
      if (secondChanceRef.current) clearTimeout(secondChanceRef.current)
    }
  }, [])

  /** Refermeture : on arme la seconde chance au premier refus, jamais après. */
  const closeInvitation = useCallback(() => {
    setInvitationOpen(false)
    dismissalsRef.current += 1
    if (dismissalsRef.current !== 1) return
    secondChanceRef.current = setTimeout(() => setInvitationOpen(true), SECOND_CHANCE_MS)
  }, [])

  const enableSound = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = false
    setMuted(false)
    video.play().catch(() => {
      // Le navigateur a refusé le son : on revient au muet plutôt que de
      // laisser une vidéo arrêtée.
      video.muted = true
      setMuted(true)
    })
  }, [])

  const handleSheetDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > DISMISS_OFFSET_PX || info.velocity.y > DISMISS_VELOCITY) {
        closeInvitation()
      }
    },
    [closeInvitation],
  )

  /* Chapitres projetés en fractions — la barre les affiche en segments dès
     qu'il y en a deux, exactement comme dans le feed. Tant que la durée est
     inconnue, on ne passe rien : la barre reste d'un seul tenant. */
  const fractionalChapters = useMemo(() => {
    const raw = fullProperty.chapters as
      | Array<{ label: string; fraction?: number; startSec?: number }>
      | undefined
    if (!raw || raw.length === 0) return undefined
    if (raw.every((c) => typeof c.fraction === 'number')) {
      return raw.map((c) => ({ label: c.label, fraction: c.fraction as number }))
    }
    if (!videoDuration) return undefined
    return raw
      .map((c) => ({
        label: c.label,
        fraction:
          typeof c.fraction === 'number'
            ? c.fraction
            : typeof c.startSec === 'number'
              ? Math.min(1, Math.max(0, c.startSec / videoDuration))
              : 0,
      }))
      .sort((a, b) => a.fraction - b.fraction)
  }, [fullProperty.chapters, videoDuration])

  const poster = property.posterUrl ?? property.imageUrl
  const roomsLabel = property.rooms > 0 ? `T${property.rooms}` : null
  // Même composition que l'overlay du feed : type · pièces · surface · prix,
  // sur une seule ligne.
  const ligneBien = [
    property.typeLabel,
    roomsLabel,
    `${property.surface} m²`,
    formatPrice(property.price),
  ]
    .filter(Boolean)
    .join(' · ')
  // Défensif : une page publique ne doit jamais tomber sur un champ manquant.
  const agencyName = property.agencyName?.trim() || 'SHOMEE'
  const agencyInitial = (agencyName.charAt(0) || '?').toUpperCase()

  return (
    <div
      className="fixed inset-0 flex items-start justify-center overflow-hidden"
      style={{ backgroundColor: NIGHT }}
    >
      <div
        className="relative w-full max-w-[430px] overflow-hidden"
        style={{ height: '100dvh', backgroundColor: NIGHT }}
      >
        {/* ── Visite ─────────────────────────────────────────────────────── */}
        {property.videoUrl ? (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            src={property.videoUrl}
            poster={poster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration || 0)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}

        {/* Dégradés — mêmes valeurs que la VideoCard du feed. */}
        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background:
              'linear-gradient(to bottom, rgba(0,0,0,0.60) 0%, transparent 28%, transparent 50%, rgba(0,0,0,0.82) 100%)',
          }}
        />

        {/* Zone de tap : active le son. Inerte dès que le son est actif, pour
            ne rien intercepter. */}
        <div
          className="absolute inset-0 z-[15]"
          style={{
            pointerEvents: muted ? 'auto' : 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
          onClick={enableSound}
        />

        {/* ── Agence — c'est elle qui envoie le lien, elle passe devant ──── */}
        <div
          className="absolute left-4 z-20 flex items-center gap-2.5"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 20px)' }}
        >
          <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-neutral-900 border border-white/25 flex items-center justify-center">
            {property.agencyLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={property.agencyLogo}
                alt={agencyName}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-white text-[13px] font-bold">{agencyInitial}</span>
            )}
          </div>
          <p className="text-white font-semibold text-[15px] drop-shadow">{agencyName}</p>
        </div>

        {/* ── Pastille son ───────────────────────────────────────────────── */}
        {muted && (
          <button
            type="button"
            onClick={enableSound}
            className="absolute right-3 z-30 flex items-center gap-1.5 pl-2.5 pr-3 h-9 rounded-full bg-black/45 backdrop-blur-sm border border-white/20 active:scale-95 transition-transform"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 20px)' }}
          >
            <Volume2 size={15} strokeWidth={1.8} className="text-white" />
            <span className="text-white text-[12px] font-medium">Son</span>
          </button>
        )}

        {/* ── Bas : le bien à gauche, la marque à droite. Aucun bouton. ──── */}
        <div
          className="absolute left-0 right-0 bottom-0 z-20 px-4 pt-6 flex items-end gap-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 30px)' }}
        >
          <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
            <div className="flex items-center gap-1.5">
              <MapPin size={14} className="text-white shrink-0" />
              <p className="text-white font-bold text-[15px] leading-[19px] drop-shadow truncate">
                {formatLocation(property.arrondissement, property.district)}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Home size={14} strokeWidth={1.8} className="text-white shrink-0" />
              <p className="text-white text-[15px] leading-[19px] drop-shadow truncate">
                {ligneBien}
              </p>
            </div>

            {/* Même geste que dans le feed : l'icône annonce la destination. */}
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="flex items-center gap-[5px] mt-[5px] self-start"
            >
              <CirclePlus size={15} strokeWidth={1.8} className="text-white shrink-0" />
              <span className="text-white text-[14px] font-semibold underline underline-offset-2 drop-shadow">
                Voir l’annonce
              </span>
              <ChevronDown size={14} className="text-white" />
            </button>
          </div>

          <Image
            src="/logo blanc.png"
            alt="SHOMEE"
            width={44}
            height={50}
            priority
            className="object-contain shrink-0 drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
          />
        </div>

        {/* ── Feuille d'invitation — le haut de la visite reste net ──────── */}
        <AnimatePresence>
          {invitationOpen && !detailOpen && (
            <motion.div
              key="invitation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="absolute inset-0 z-[100] flex items-end"
            >
              {/* Au-dessus de la feuille : la vidéo, nette et cliquable pour
                  refermer. En dessous : le flou qui porte la feuille. */}
              <div className="absolute inset-0" onClick={closeInvitation} />
              {/* Aucun flou, aucun voile : la visite reste nette de bout en
                  bout. La feuille est opaque, son ombre portée suffit à la
                  détacher. */}

              <motion.div
                role="dialog"
                aria-label="Vous souhaitez recevoir plus de biens comme celui-ci ?"
                onClick={(e) => e.stopPropagation()}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 32, stiffness: 300 }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.7 }}
                onDragEnd={handleSheetDragEnd}
                className="relative w-full rounded-t-[28px] px-6 pt-5 flex flex-col items-center gap-3 text-center shadow-2xl touch-none"
                style={{
                  background: CREAM,
                  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 30px)',
                }}
              >
                <div className="w-10 h-1 rounded-full bg-black/15" />

                {/* Le logo porte déjà le nom : l'écrire à côté l'énoncerait
                    deux fois. Il parle seul, la signature le prolonge — en
                    terracotta, pas en gris : c'est une promesse de marque, pas
                    une légende. */}
                <Image
                  src="/logo terracotta.png"
                  alt="SHOMEE"
                  width={56}
                  height={64}
                  className="object-contain mt-1"
                />
                <p
                  className="text-[14px] font-medium leading-snug -mt-1"
                  style={{ color: TERRACOTTA }}
                >
                  L’application immo premium en vidéo
                </p>

                <h2
                  className="font-bold text-[19px] leading-snug tracking-tight px-2"
                  style={{ color: INK }}
                >
                  Vous souhaitez recevoir plus de biens comme celui-ci ?
                </h2>

                <a
                  href="/onboarding"
                  className="flex w-full items-center justify-center gap-1.5 mt-1 py-3.5 rounded-2xl font-semibold text-[15.5px] text-white transition-opacity active:opacity-90"
                  style={{ backgroundColor: TERRACOTTA }}
                >
                  Décrivez votre recherche en 2mn
                  <ChevronRight size={17} strokeWidth={2.4} className="shrink-0" />
                </a>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Barre de lecture — le composant du feed, à sa place habituelle :
            en bas, sous les informations du bien. Segmentée par chapitres et
            navigable au doigt, comme dans l'app. */}
        {property.videoUrl && (
          <VideoProgressBar
            videoRef={videoRef}
            chapters={fractionalChapters}
            bottom="calc(env(safe-area-inset-bottom, 0px) + 6px)"
          />
        )}

        {/* Fiche complète — le composant de l'app, sans sa barre d'actions :
            message, appel et visite n'ont pas de sens sur un lien public. */}
        <PropertyDetailSheet
          property={fullProperty}
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          isFavorite={false}
          onToggleFavorite={() => {}}
          hideBottomBar
          publicMode
        />
      </div>
    </div>
  )
}
