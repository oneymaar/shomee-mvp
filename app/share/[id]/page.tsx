'use client'

import { useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import VideoCard from '@/components/VideoCard'
import PropertyOverlay from '@/components/PropertyOverlay'
import { properties } from '@/lib/mockData'

export default function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const property = properties.find(p => p.id === id)
  const [popupDismissed, setPopupDismissed] = useState(false)

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
        <VideoCard property={property} isActive muted />

        {/* Simplified overlay — no BAIA, no "Plus" */}
        <PropertyOverlay property={property} />

        {/* Top bar — download CTA */}
        <div className="absolute top-0 left-0 right-0 z-30 bg-black/80 backdrop-blur-sm border-b border-white/10" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="flex items-center justify-between px-4 h-[52px] gap-3">
            <p className="text-white/75 text-[13px] leading-tight">
              Découvrez SHOMEE,{' '}
              <span className="text-white font-semibold">l'immobilier en vidéo</span>
            </p>
            <a
              href="https://apps.apple.com"
              className="shrink-0 bg-white text-black text-[13px] font-bold px-4 py-2 rounded-full active:opacity-80 transition-opacity"
            >
              Télécharger
            </a>
          </div>
        </div>

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
                className="absolute inset-0 z-40 bg-black/50"
                onClick={() => setPopupDismissed(true)}
              />

              {/* Popup card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 20 }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="absolute left-5 right-5 z-50 bg-neutral-900 rounded-3xl p-6 shadow-2xl"
                style={{ top: '50%', transform: 'translateY(-50%)' }}
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
                  Téléchargez SHOMEE
                </h2>
                <p className="text-white/65 text-[14px] text-center leading-relaxed mb-6">
                  L'immobilier en vidéo. Découvrez les biens autrement, directement sur votre smartphone.
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
            </>
          )}
        </AnimatePresence>
      </div>
    </MobileFrame>
  )
}
