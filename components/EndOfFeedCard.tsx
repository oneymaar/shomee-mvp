'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check } from 'lucide-react'

const SUGGESTIONS = [
  { id: 'paris11', label: 'Élargir à Paris 11e' },
  { id: 'budget',  label: 'Budget jusqu\'à 850 000 €' },
  { id: 'noasc',   label: 'Biens sans ascenseur' },
]

export default function EndOfFeedCard() {
  const [selected, setSelected] = useState<string[]>([])
  const [text, setText] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  const canSubmit = selected.length > 0 || text.trim() !== ''
  const textActive = text.trim() !== ''

  const handleSubmit = () => {
    if (!canSubmit) return
    setConfirmed(true)
  }

  return (
    <div className="relative w-full h-full bg-neutral-900 flex flex-col overflow-hidden">

      <div className="relative z-10 h-full overflow-y-auto scrollbar-hide px-5 flex flex-col justify-center py-10">

        {/* ── Hero (always visible) ── */}
        <div className="flex flex-col items-center text-center mb-8">
          {/* Animated green check */}
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

        {/* ── Section label — always visible ── */}
        <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">
          Élargir ma recherche
        </p>

        {/* ── Form / Confirmation (animated swap) ── */}
        <AnimatePresence mode="wait">
          {!confirmed ? (
            <motion.div
              key="form"
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex flex-col gap-2">
                {/* Toggle suggestions */}
                {SUGGESTIONS.map(({ id, label }) => {
                  const active = selected.includes(id)
                  return (
                    <button
                      key={id}
                      onClick={() => toggle(id)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all ${
                        active
                          ? 'bg-white text-black border-white'
                          : 'bg-white/5 text-white/70 border-white/10'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                        active ? 'bg-black border-black' : 'border-white/30'
                      }`}>
                        {active && <Check size={11} strokeWidth={3} />}
                      </div>
                      <span className="text-sm font-medium">{label}</span>
                    </button>
                  )
                })}

                {/* Free text — 4th item, same visual style */}
                <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${
                  textActive
                    ? 'bg-white border-white'
                    : 'bg-white/5 border-white/10'
                }`}>
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                    textActive ? 'bg-black border-black' : 'border-white/30'
                  }`}>
                    {textActive && <Check size={11} strokeWidth={3} />}
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

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`w-full py-4 rounded-2xl text-sm font-bold transition-all mt-5 ${
                  canSubmit
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white/30 cursor-not-allowed'
                }`}
              >
                Modifier mes critères
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="confirmation"
              className="flex flex-col gap-2 py-1"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <p className="text-white font-semibold text-base">
                Modifications prises en compte&nbsp;!
              </p>
              <p className="text-white/50 text-sm leading-relaxed">
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
