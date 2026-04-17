'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowRight } from 'lucide-react'

interface BAIAModalProps {
  open: boolean
  onClose: () => void
}

function BAIALogo({ size = 80 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      {/* Circle with BAIA text */}
      <div
        className="rounded-full border-2 border-white flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <span
          className="text-white font-black tracking-wider"
          style={{ fontSize: size * 0.25 }}
        >
          BAIA
        </span>
      </div>
      {/* Speech bubble tail */}
      <div className="self-start ml-4 -mt-px w-0 h-0"
        style={{
          borderLeft: '10px solid transparent',
          borderRight: '4px solid transparent',
          borderTop: '10px solid white',
        }}
      />
    </div>
  )
}

export default function BAIAModal({ open, onClose }: BAIAModalProps) {
  const [query, setQuery] = useState('')
  const [sent, setSent] = useState(false)

  const handleSend = () => {
    if (!query.trim()) return
    setSent(true)
    setTimeout(() => { setSent(false); setQuery('') }, 2000)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="baia-modal"
          className="absolute inset-0 z-50 bg-neutral-900 flex flex-col"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-5 left-5 w-9 h-9 flex items-center justify-center text-white/70 hover:text-white transition-colors"
          >
            <X size={22} />
          </button>

          {/* Content — centered, input inline below questions */}
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-6">
            <BAIALogo size={90} />

            <div className="flex flex-col gap-3">
              <h2 className="text-white font-light text-2xl leading-snug">
                Bonjour Olivier,<br />
                <span className="font-normal">En quoi puis-je vous être utile ?</span>
              </h2>
              <p className="text-white/50 text-sm leading-relaxed">
                Des questions sur un bien en particulier ?<br />
                Des questions techniques, juridiques ?<br />
                Modifier vos critères de recherche ?
              </p>
            </div>

            {/* Input */}
            <div className="w-full mt-2">
              {sent ? (
                <p className="text-white/60 text-sm text-center py-3">Message envoyé ✓</p>
              ) : (
                <div className="flex items-center bg-transparent border border-white/30 rounded-full pl-5 pr-1.5 py-1.5 gap-3">
                  <input
                    className="flex-1 bg-transparent text-white text-sm placeholder:text-white/40 outline-none"
                    placeholder="Demandez-moi ce que vous voulez !"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
                  />
                  <button
                    onClick={handleSend}
                    className="w-9 h-9 rounded-full bg-white flex items-center justify-center shrink-0 hover:bg-white/90 transition-colors active:scale-95 disabled:opacity-40"
                    disabled={!query.trim()}
                  >
                    <ArrowRight size={18} className="text-black" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
