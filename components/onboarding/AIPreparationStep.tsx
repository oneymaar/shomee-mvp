'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { useSearchStore } from '@/lib/searchStore'

const ANALYSIS_STEPS = [
  { label: 'Analyse de votre zone idéale', delay: 0 },
  { label: 'Calibrage du budget', delay: 800 },
  { label: 'Profil de recherche', delay: 1600 },
  { label: 'Sélection personnalisée en cours', delay: 2400 },
]

interface AIPreparationStepProps {
  onReady: () => void
}

export default function AIPreparationStep({ onReady }: AIPreparationStepProps) {
  const { locationLabel, budgetMax, priorities, completeOnboarding } = useSearchStore()
  const [visibleSteps, setVisibleSteps] = useState<number[]>([])
  const [done, setDone] = useState(false)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []

    ANALYSIS_STEPS.forEach((step, i) => {
      timers.push(setTimeout(() => {
        setVisibleSteps((prev) => [...prev, i])
      }, step.delay + 300))
    })

    timers.push(setTimeout(() => {
      setDone(true)
    }, 3400))

    timers.push(setTimeout(() => {
      completeOnboarding()
      onReady()
    }, 4000))

    return () => timers.forEach(clearTimeout)
  }, [completeOnboarding, onReady])

  return (
    <div
      className="flex flex-col items-center justify-center h-full px-8 text-center"
      style={{ background: 'linear-gradient(135deg, #FDF5F2 0%, #f0e8df 100%)' }}
    >
      {/* BAIA avatar */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative mb-8"
      >
        <motion.div
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(166,75,39,0.08)' }}
        >
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
            className="w-14 h-14 rounded-full overflow-hidden"
            style={{ border: '2px solid rgba(166,75,39,0.2)' }}
          >
            <Image src="/Baia couleur 2.png" alt="BAIA" width={56} height={56} className="object-cover" />
          </motion.div>
        </motion.div>

        {/* Orbit dots */}
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full"
            style={{ background: '#A64B27', opacity: 0.3, top: '50%', left: '50%' }}
            animate={{
              x: Math.cos((i / 3) * Math.PI * 2) * 40 - 4,
              y: Math.sin((i / 3) * Math.PI * 2) * 40 - 4,
              opacity: [0.15, 0.5, 0.15],
            }}
            transition={{ duration: 3, delay: i * 0.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </motion.div>

      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="mb-2"
      >
        <h2 className="text-[20px] font-bold text-neutral-900">
          {done ? 'Votre sélection est prête !' : 'SHOMEE analyse votre projet…'}
        </h2>
        {locationLabel && (
          <p className="text-[13px] text-neutral-400 mt-1">{locationLabel}</p>
        )}
      </motion.div>

      {/* Analysis steps */}
      <div className="mt-7 flex flex-col gap-2.5 w-full max-w-[280px]">
        <AnimatePresence>
          {ANALYSIS_STEPS.map((step, i) => (
            visibleSteps.includes(i) && (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-3"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: '#A64B27' }}
                >
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </motion.div>
                <span className="text-[13px] text-neutral-600">{step.label}</span>
              </motion.div>
            )
          ))}
        </AnimatePresence>
      </div>

      {/* Stats summary */}
      {done && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 px-5 py-3.5 bg-white border border-black/8 rounded-2xl flex items-center gap-3"
        >
          <div className="text-left">
            <p className="text-[22px] font-bold" style={{ color: '#A64B27' }}>4</p>
            <p className="text-[11px] text-neutral-400 font-medium uppercase tracking-wide">biens sélectionnés</p>
          </div>
          <div className="w-px h-8 bg-black/8" />
          <div className="text-left">
            <p className="text-[22px] font-bold text-neutral-900">
              {priorities.length > 0 ? `${priorities.length}` : '—'}
            </p>
            <p className="text-[11px] text-neutral-400 font-medium uppercase tracking-wide">
              {priorities.length > 0 ? 'priorités' : 'critères'}
            </p>
          </div>
        </motion.div>
      )}
    </div>
  )
}
