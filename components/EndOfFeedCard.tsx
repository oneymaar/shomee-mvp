'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check } from 'lucide-react'

type CardState = 'idle' | 'loading' | 'found' | 'confirmed'

const SUGGESTIONS = [
  { id: 'paris11', label: 'Élargir à Paris 11e' },
  { id: 'budget',  label: "Budget jusqu'à 850 000 €" },
  { id: 'noasc',   label: 'Biens sans ascenseur' },
]

interface EndOfFeedCardProps {
  hasNewResults?: boolean
  newResultsCount?: number
  onFoundResults?: () => void  // called when 'found' state starts (5 s after submit)
  onScrollToNew?: () => void   // called 2 s after 'found' state starts
}

export default function EndOfFeedCard({
  hasNewResults = false,
  newResultsCount = 1,
  onFoundResults,
  onScrollToNew,
}: EndOfFeedCardProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [text, setText] = useState('')
  const [cardState, setCardState] = useState<CardState>('idle')

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  const canSubmit = selected.length > 0 || text.trim() !== ''
  const textActive = text.trim() !== ''

  const handleSubmit = () => {
    if (!canSubmit) return
    setCardState('loading')

    setTimeout(() => {
      if (hasNewResults) {
        setCardState('found')
        onFoundResults?.()
        setTimeout(() => onScrollToNew?.(), 2000)
      } else {
        setCardState('confirmed')
      }
    }, 5000)
  }

  const resultLabel =
    newResultsCount === 1
      ? '1 nouveau bien trouvé\u00A0!'
      : `${newResultsCount} nouveaux biens trouvés\u00A0!`

  return (
    <div className="relative w-full h-full bg-neutral-900 flex flex-col overflow-hidden">
      <div className="relative z-10 h-full overflow-y-auto scrollbar-hide px-5 flex flex-col justify-center py-10">

        {/* ── Hero — always visible ── */}
        <div className="flex flex-col items-center text-center mb-8">
          <motion.div
            className="w-16 h-16 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 flex items-center justify-center mb-4"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 14, stiffness: 180 }}
          >
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.25, type: 'spring', damping: 18 }}
            >
              <Check size={28} className="text-emerald-400" strokeWidth={2.5} />
            </motion.div>
          </motion.div>
          <h2 className="text-white font-bold text-2xl leading-snug mb-2">
            Vous avez fait le tour…
          </h2>
          <p className="text-white/50 text-sm leading-relaxed max-w-[290px]">
            … pour l'instant&nbsp;! Mais vous serez alerté(e) dès qu'un nouveau bien sort dans vos critères.
          </p>
        </div>

        {/* ── Body ── */}
        <AnimatePresence mode="wait">

          {/* idle: suggestions form */}
          {cardState === 'idle' && (
            <motion.div key="form" exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">
                Élargir ma recherche
              </p>

              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map(({ id, label }) => {
                  const active = selected.includes(id)
                  return (
                    <button
                      key={id}
                      onClick={() => toggle(id)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all ${
                        active ? 'bg-white text-black border-white' : 'bg-white/5 text-white/70 border-white/10'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                        active ? 'bg-black border-black' : 'border-white/30'
                      }`}>
                        {active && <Check size={11} strokeWidth={3} className="text-white" />}
                      </div>
                      <span className="text-sm font-medium">{label}</span>
                    </button>
                  )
                })}

                {/* 4th item: free text */}
                <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${
                  textActive ? 'bg-white border-white' : 'bg-white/5 border-white/10'
                }`}>
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                    textActive ? 'bg-black border-black' : 'border-white/30'
                  }`}>
                    {textActive && <Check size={11} strokeWidth={3} className="text-white" />}
                  </div>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Dites-nous comment avec vos mots"
                    className={`flex-1 bg-transparent text-sm focus:outline-none ${
                      textActive ? 'text-black placeholder-black/30' : 'text-white placeholder-white/25'
                    }`}
                  />
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`w-full py-4 rounded-2xl text-sm font-bold transition-all mt-5 ${
                  canSubmit ? 'bg-white text-black' : 'bg-white/10 text-white/30 cursor-not-allowed'
                }`}
              >
                Modifier mes critères
              </button>
            </motion.div>
          )}

          {/* loading: spinner */}
          {cardState === 'loading' && (
            <motion.div
              key="loading"
              className="flex flex-col items-center gap-5 py-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                className="w-12 h-12 rounded-full border-2 border-white/15 border-t-white/80"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              />
              <div className="text-center">
                <p className="text-white font-semibold text-base">BAIA relance la recherche…</p>
                <p className="text-white/40 text-sm mt-1.5">
                  Analyse des biens correspondant à vos nouveaux critères.
                </p>
              </div>
            </motion.div>
          )}

          {/* found: result count before scroll */}
          {cardState === 'found' && (
            <motion.div
              key="found"
              className="flex flex-col items-center gap-4 py-6"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center"
                animate={{ scale: [1, 1.12, 1] }}
                transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
              >
                <Check size={24} className="text-emerald-400" strokeWidth={2.5} />
              </motion.div>
              <div className="text-center">
                <p className="text-white font-bold text-xl">{resultLabel}</p>
                <p className="text-white/40 text-sm mt-1.5">Chargement en cours…</p>
              </div>
            </motion.div>
          )}

          {/* confirmed: no new results */}
          {cardState === 'confirmed' && (
            <motion.div
              key="confirmed"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">
                Élargir ma recherche
              </p>
              <p className="text-white font-semibold text-base">
                Modifications prises en compte&nbsp;!
              </p>
              <p className="text-white/50 text-sm leading-relaxed mt-2">
                Vos critères sont modifiables à tout moment dans l'onglet{' '}
                <span className="text-white/70 font-medium">Profil</span>.
              </p>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
