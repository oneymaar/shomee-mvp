'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { X, Check } from 'lucide-react'
import type { Property } from '@/lib/types'

// Force rebuild - v2024-04-19-008

const REASONS = [
  { id: 'price', emoji: '💰', label: 'Prix trop élevé' },
  { id: 'surface', emoji: '📐', label: 'Surface insuffisante' },
  { id: 'location', emoji: '📍', label: 'Quartier peu adapté' },
  { id: 'light', emoji: '☀️', label: 'Pas assez lumineux' },
  { id: 'work', emoji: '🔨', label: 'Trop de travaux' },
  { id: 'other', emoji: '💬', label: 'Autre raison' },
]

interface SkipFeedbackModalProps {
  property: Property | null
  open: boolean
  onClose: () => void
}

export default function SkipFeedbackModal({ property, open, onClose }: SkipFeedbackModalProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const handleSubmit = () => {
    if (selected.length === 0) return
    setSubmitted(true)
    setTimeout(() => {
      setSubmitted(false)
      setSelected([])
      onClose()
    }, 1400)
  }

  const handleClose = () => {
    setSelected([])
    setSubmitted(false)
    onClose()
  }

  if (!property) return null

  const fmtPrice = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="skip-backdrop"
            className="absolute inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          <motion.div
            key="skip-sheet"
            className="absolute bottom-[60px] left-0 right-0 z-50 bg-neutral-950 rounded-t-3xl border-t border-white/10"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-2.5 pb-0">
              <div className="w-10 h-1 bg-white/20 rounded-full" />
            </div>

            <div className="px-5 pt-4 pb-6">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-1">
                    BAIA · Comprendre vos critères
                  </p>
                  <h3 className="text-white font-bold text-lg leading-snug">
                    Pourquoi ce bien n'a pas retenu votre attention ?
                  </h3>
                </div>
                <button onClick={handleClose} className="text-white/30 hover:text-white/60 transition-colors ml-3 mt-0.5">
                  <X size={18} />
                </button>
              </div>

              {/* Property mini preview */}
              <div className="flex gap-3 mb-5 bg-white/5 border border-white/10 rounded-2xl p-2.5">
                <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0">
                  <Image
                    src={property.imageUrlFallback}
                    alt={property.title}
                    fill
                    className="object-cover"
                    sizes="56px"
                  />
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <p className="text-white font-semibold text-sm leading-tight truncate">
                    {property.arrondissement} · {property.subtitle}
                  </p>
                  <p className="text-white/50 text-xs mt-0.5">{property.surface} m² · {fmtPrice} €</p>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {!submitted ? (
                  <motion.div
                    key="form"
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                  >
                    {/* Reason grid */}
                    <div className="grid grid-cols-2 gap-3 mb-5">
                      {REASONS.map(({ id, emoji, label }) => {
                        const active = selected.includes(id)
                        return (
                          <button
                            key={id}
                            onClick={() => toggle(id)}
                            className={`flex flex-col items-center justify-center gap-3 px-2 py-8 rounded-2xl border text-center transition-all ${
                              active
                                ? 'bg-white text-black border-white'
                                : 'bg-white/5 text-white/70 border-white/12 hover:border-white/30'
                            }`}
                          >
                            <span className="text-6xl">{emoji}</span>
                            <span className="text-sm font-medium leading-tight">{label}</span>
                          </button>
                        )
                      })}
                    </div>

                    {/* Submit */}
                    <button
                      onClick={handleSubmit}
                      disabled={selected.length === 0}
                      className={`w-full py-3.5 rounded-2xl text-sm font-bold transition-all ${
                        selected.length > 0
                          ? 'bg-white text-black hover:bg-white/90'
                          : 'bg-white/10 text-white/30 cursor-not-allowed'
                      }`}
                    >
                      Envoyer mon retour
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="thanks"
                    className="flex flex-col items-center gap-3 py-6"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center">
                      <Check size={22} className="text-black" strokeWidth={2.5} />
                    </div>
                    <p className="text-white font-semibold text-base">Merci pour votre retour !</p>
                    <p className="text-white/40 text-sm text-center">
                      BAIA affine votre profil pour mieux vous sélectionner des biens.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
