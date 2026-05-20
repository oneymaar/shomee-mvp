'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useSearchStore } from '@/lib/searchStore'
import IntroStep from '@/components/onboarding/IntroStep'
import LocationStep from '@/components/onboarding/LocationStep'
import LocationMapStep from '@/components/onboarding/LocationMapStep'
import BudgetStep from '@/components/onboarding/BudgetStep'
import PropertyTypeStep from '@/components/onboarding/PropertyTypeStep'
import PrioritiesStep from '@/components/onboarding/PrioritiesStep'
import AIPreparationStep from '@/components/onboarding/AIPreparationStep'

function MapLoadingScreen() {
  return (
    <div className="flex flex-col h-full items-center justify-center gap-5">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
      >
        <Loader2 size={32} style={{ color: '#914E3C', opacity: 0.7 }} />
      </motion.div>
      <p className="text-[15px] text-neutral-400 font-medium">SHOMEE réfléchit…</p>
    </div>
  )
}

// Steps: 0=Intro, 1=Location text, 2=Budget, 3=Type, 4=Priorities, 5=AI
// locationMapOpen is a sub-state of step 1
const TOTAL_STEPS = 5

type Direction = 1 | -1

const variants = {
  enter: (dir: Direction) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: Direction) => ({ x: dir > 0 ? '-55%' : '55%', opacity: 0 }),
}

export default function OnboardingPage() {
  const router = useRouter()
  const { onboardingCompleted } = useSearchStore()
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<Direction>(1)
  const [locationMapOpen, setLocationMapOpen] = useState(false)
  const [mapLoading, setMapLoading] = useState(false)
  // Dynamic viewport height — tracks keyboard open/close on iOS via visualViewport API
  const [viewportH, setViewportH] = useState<number | null>(null)

  useEffect(() => {
    if (onboardingCompleted) router.replace('/feed')
  }, [onboardingCompleted, router])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const handler = () => setViewportH(vv.height)
    handler()
    vv.addEventListener('resize', handler)
    vv.addEventListener('scroll', handler)
    return () => { vv.removeEventListener('resize', handler); vv.removeEventListener('scroll', handler) }
  }, [])

  const goTo = useCallback((next: number, dir: Direction = 1) => {
    setDirection(dir)
    setLocationMapOpen(false)
    setStep(next)
  }, [])

  const handleNext = useCallback(() => goTo(step + 1, 1), [step, goTo])
  const handleBack = useCallback(() => {
    if (locationMapOpen) { setLocationMapOpen(false); setMapLoading(false); return }
    if (step === 0) return
    goTo(step - 1, -1)
  }, [step, locationMapOpen, goTo])
  const handleSkip = useCallback(() => goTo(step + 1, 1), [step, goTo])
  // "Aller directement sur le feed" — skip onboarding entirely
  const handleQuick = useCallback(() => router.replace('/feed'), [router])
  const handleReady = useCallback(() => router.replace('/feed'), [router])

  const handleOpenMap = useCallback(() => { setMapLoading(true); setLocationMapOpen(true) }, [])
  const handleMapReady = useCallback(() => setMapLoading(false), [])
  const handleMapValidate = useCallback(() => goTo(2, 1), [goTo])

  const showBack = step > 0
  const showProgress = step >= 1 && step <= 4

  // Unique key per "screen" so AnimatePresence correctly animates sub-steps
  const screenKey = step === 1
    ? (locationMapOpen ? (mapLoading ? '1-loading' : '1-map') : '1-text')
    : String(step)

  return (
    <div
      className="fixed inset-x-0 top-0 flex flex-col overflow-hidden"
      style={{ background: '#f5f0e8', maxWidth: 430, margin: '0 auto', height: viewportH ? `${viewportH}px` : '100dvh' }}
    >
      {/* Top bar */}
      {(showBack || showProgress) && (
        <div
          className="flex-shrink-0 flex items-center px-4 pt-4 pb-2 gap-3"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}
        >
          {showBack ? (
            <button
              onClick={handleBack}
              className="w-9 h-9 rounded-full bg-white border border-black/8 flex items-center justify-center active:bg-black/5 transition-colors flex-shrink-0"
            >
              <ChevronLeft size={18} className="text-neutral-600" />
            </button>
          ) : (
            <div className="w-9 flex-shrink-0" />
          )}

          {showProgress && (
            <div className="flex-1 flex gap-1.5">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
                const filled = i < step - 1 || (i === step - 1 && !locationMapOpen)
                const active = i === step - 1
                return (
                  <div
                    key={i}
                    className="flex-1 h-1 rounded-full transition-all duration-400"
                    style={{ backgroundColor: filled || active ? '#914E3C' : 'rgba(0,0,0,0.1)' }}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Animated step content */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={screenKey}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0"
          >
            {step === 0 && (
              <IntroStep onStart={handleNext} onQuick={handleQuick} />
            )}

            {step === 1 && !locationMapOpen && (
              <LocationStep onOpenMap={handleOpenMap} onSkip={handleSkip} />
            )}

            {step === 1 && locationMapOpen && mapLoading && (
              <MapLoadingScreen />
            )}

            {step === 1 && locationMapOpen && !mapLoading && (
              <LocationMapStep
                onValidate={handleMapValidate}
                onBack={() => { setLocationMapOpen(false); setMapLoading(false) }}
                onReady={handleMapReady}
              />
            )}

            {step === 2 && (
              <BudgetStep onNext={handleNext} onSkip={handleSkip} />
            )}

            {step === 3 && (
              <PropertyTypeStep onNext={handleNext} onSkip={handleSkip} />
            )}

            {step === 4 && (
              <PrioritiesStep onNext={handleNext} onSkip={handleSkip} />
            )}

            {step === 5 && (
              <AIPreparationStep onReady={handleReady} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
