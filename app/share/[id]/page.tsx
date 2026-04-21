'use client'

import { useState, use } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Volume2, VolumeX } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import VideoCard from '@/components/VideoCard'
import PropertyOverlay from '@/components/PropertyOverlay'
import PropertyDetailSheet from '@/components/PropertyDetailSheet'
import { properties } from '@/lib/mockData'

export default function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const property = properties.find(p => p.id === id)
  const [popupDismissed, setPopupDismissed] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [muted, setMuted] = useState(true)

  if (!property) {
    return (
      <MobileFrame>
        <div className="flex items-center justify-center h-screen text-white">
          Annonce introuvable
        </div>
      </MobileFrame>
    )
  }

  return (
    <MobileFrame>
      <div className="relative w-full" style={{ height: '100dvh' }}>
        {/* Video */}
        <VideoCard property={property} isActive muted={muted} />

        {/* Simplified overlay — no BAIA */}
        <PropertyOverlay property={property} onMore={() => setDetailOpen(true)} agencyTopOffset={52} />

        {/* Mute toggle — top right, aligned with agency avatar */}
        <button
          onClick={() => setMuted(m => !m)}
          className="absolute z-30 right-3 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center active:scale-95 transition-transform"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}
        >
          {muted
            ? <VolumeX size={16} strokeWidth={1.5} className="text-white" />
            : <Volume2 size={16} strokeWidth={1.5} className="text-white" />
          }
        </button>

        {/* Top bar — download CTA */}
        <div
          className="absolute top-0 left-0 right-0 z-30 bg-black/80 backdrop-blur-sm border-b border-white/10"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex items-center justify-between px-4 h-[52px] gap-3">
            <p className="text-white/90 text-[13px] leading-tight">
              Avec SHOMEE, dénichez les pépites en <strong>avant-première</strong> et en <strong>vidéo</strong> !
            </p>
            <a
              href="https://apps.apple.com"
              className="shrink-0 bg-white text-black text-[13px] font-bold px-4 py-2 rounded-full active:opacity-80 transition-opacity"
            >
              Télécharger
            </a>
          </div>
        </div>

        {/* Detail sheet — same as in the app */}
        <PropertyDetailSheet
          property={property}
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          isFavorite={false}
          onToggleFavorite={() => {}}
          hideBottomBar
        />

        {/* Download popup */}
        <AnimatePresence>
          {!popupDismissed && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 z-40 bg-black/50 flex items-center px-5"
                onClick={() => setPopupDismissed(true)}
              >
                {/* Popup card — inside backdrop flex container for true centering */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="w-full bg-neutral-900 rounded-3xl p-6 shadow-2xl"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    onClick={() => setPopupDismissed(true)}
                    className="absolute top-4 right-4 text-white/40 hover:text-white/70 transition-colors"
                  >
                    <X size={20} />
                  </button>

                  {/* Icon */}
                  <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mx-auto mb-4">
                    <span className="text-black font-black text-[22px] tracking-wider">SH</span>
                  </div>

                  <h2 className="text-white font-bold text-[20px] text-center leading-tight mb-2">
                    Voici SHOMEE
                  </h2>
                  <p className="text-white/65 text-[14px] text-center leading-relaxed mb-6">
                    Renseignez vos critères pour dénicher les plus beaux biens du marché en <strong className="text-white">avant-première</strong> et en <strong className="text-white">vidéo</strong> ✨
                  </p>

                  <a
                    href="https://apps.apple.com"
                    className="block w-full bg-white text-black text-[15px] font-bold text-center py-3.5 rounded-2xl active:opacity-80 transition-opacity mb-3"
                  >
                    Télécharger l'application
                  </a>

                  <button
                    onClick={() => setPopupDismissed(true)}
                    className="block w-full text-white/55 text-[14px] text-center py-2 active:opacity-70 transition-opacity"
                  >
                    Plus tard
                  </button>
                </motion.div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </MobileFrame>
  )
}
