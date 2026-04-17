'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { Check, ChevronDown } from 'lucide-react'
import type { Property } from '@/lib/types'

const REASONS = [
  { id: 'price',    emoji: '💰', label: 'Prix trop élevé' },
  { id: 'surface',  emoji: '📐', label: 'Surface insuffisante' },
  { id: 'location', emoji: '📍', label: 'Quartier peu adapté' },
  { id: 'light',    emoji: '☀️', label: 'Pas assez lumineux' },
  { id: 'work',     emoji: '🔨', label: 'Trop de travaux' },
  { id: 'other',    emoji: '💬', label: 'Autre raison' },
]

export default function SkipFeedbackCard({ property }: { property: Property }) {
  const [selected, setSelected] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  const handleSubmit = () => {
    if (selected.length === 0) return
    setSubmitted(true)
    setTimeout(() => {
      setSubmitted(false)
      setSelected([])
    }, 1600)
  }

  const fmtPrice = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(
    property.price,
  )

  return (
    <div className="relative w-full h-full bg-neutral-950 flex flex-col overflow-hidden">
      {/* Blurred property thumbnail as background */}
      <div className="absolute inset-0 opacity-15 pointer-events-none">
        <Image
          src={property.imageUrlFallback}
          alt=""
          fill
          className="object-cover blur-3xl scale-110"
          sizes="100vw"
          aria-hidden
        />
      </div>

      <div className="relative z-10 flex flex-col h-full px-5 pt-14 pb-6">
        {/* Header */}
        <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-2">
          BAIA · Comprendre vos critères
        </p>
        <h2 className="text-white font-bold text-2xl leading-snug mb-6">
          Pourquoi ce bien n'a pas retenu votre attention&nbsp;?
        </h2>

        {/* Property mini card */}
        <div className="flex gap-3 mb-7 bg-white/5 border border-white/10 rounded-2xl p-3">
          <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0">
            <Image
              src={property.imageUrlFallback}
              alt={property.title}
              fill
              className="object-cover"
              sizes="64px"
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <p className="text-white font-semibold text-sm leading-tight truncate">
              {property.arrondissement} · {property.subtitle}
            </p>
            <p className="text-white/50 text-xs mt-1">
              {property.surface} m² · {fmtPrice} €
            </p>
          </div>
        </div>

        {/* Form / confirmation */}
        <AnimatePresence mode="wait">
          {!submitted ? (
            <motion.div
              key="form"
              className="flex-1 flex flex-col"
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              <div className="grid grid-cols-2 gap-2 mb-6">
                {REASONS.map(({ id, emoji, label }) => {
                  const active = selected.includes(id)
                  return (
                    <button
                      key={id}
                      onClick={() => toggle(id)}
                      className={`flex items-center gap-2 px-3 py-3 rounded-2xl border text-left transition-all ${
                        active
                          ? 'bg-white text-black border-white'
                          : 'bg-white/5 text-white/70 border-white/10 active:border-white/30'
                      }`}
                    >
                      <span className="text-lg shrink-0">{emoji}</span>
                      <span className="text-sm font-medium leading-tight">{label}</span>
                    </button>
                  )
                })}
              </div>

              <button
                onClick={handleSubmit}
                disabled={selected.length === 0}
                className={`w-full py-4 rounded-2xl text-sm font-bold transition-all ${
                  selected.length > 0
                    ? 'bg-white text-black active:bg-white/90'
                    : 'bg-white/10 text-white/30 cursor-not-allowed'
                }`}
              >
                Envoyer mon retour
              </button>

              {/* Scroll hint */}
              <motion.p
                className="flex items-center justify-center gap-1.5 text-white/25 text-xs mt-5"
                animate={{ y: [0, 4, 0] }}
                transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              >
                <ChevronDown size={13} />
                Continuer sans répondre
              </motion.p>
            </motion.div>
          ) : (
            <motion.div
              key="thanks"
              className="flex-1 flex flex-col items-center justify-center gap-4"
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 }}
            >
              <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center">
                <Check size={24} className="text-black" strokeWidth={2.5} />
              </div>
              <p className="text-white font-semibold text-xl">Merci pour votre retour&nbsp;!</p>
              <p className="text-white/40 text-sm text-center max-w-xs">
                BAIA affine votre profil pour mieux vous sélectionner des biens.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
