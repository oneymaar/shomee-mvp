'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import { useSearchStore } from '@/lib/searchStore'
import IntroStep from '@/components/onboarding/IntroStep'
import LocationStep from '@/components/onboarding/LocationStep'
import BudgetStep from '@/components/onboarding/BudgetStep'
import PropertyTypeStep from '@/components/onboarding/PropertyTypeStep'
import PrioritiesStep from '@/components/onboarding/PrioritiesStep'
import AIPreparationStep from '@/components/onboarding/AIPreparationStep'

const TOTAL_STEPS = 5 // steps 1–5 (excluding intro=0 and AI prep=6)

type Direction = 1 | -1

const variants = {
  enter: (dir: Direction) => ({
    x: dir > 0 ? '100%' : '-100%',
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (dir: Direction) => ({
    x: dir > 0 ? '-60%' : '60%',
    opacity: 0,
  }),
}

export default function OnboardingPage() {
  const router = useRouter()
  const { onboardingCompleted, resetOnboarding } = useSearchStore()
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<Direction>(1)

  useEffect(() => {
    if (onboardingCompleted) {
      router.replace('/feed')
    }
  }, [onboardingCompleted, router])

  const goTo = useCallback((next: number, dir: Direction = 1) => {
    setDirection(dir)
    setStep(next)
  }, [])

  const handleNext = useCallback(() => goTo(step + 1, 1), [step, goTo])
  const handleBack = useCallback(() => {
    if (step === 0) return
    goTo(step - 1, -1)
  }, [step, goTo])
  const handleSkip = useCallback(() => goTo(step + 1, 1), [step, goTo])

  // Quick test: skip to AI prep
  const handleQuick = useCallback(() => {
    goTo(6, 1)
  }, [goTo])

  const handleReady = useCallback(() => {
    router.replace('/feed')
  }, [router])

  const showBack = step > 0 && step < 6
  const showProgress = step >= 1 && step <= 5

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: '#f5f0e8', maxWidth: 430, margin: '0 auto' }}
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
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 h-1 rounded-full transition-all duration-300"
                  style={{
                    backgroundColor: i < step ? '#914E3C' : i === step - 1 ? '#914E3C' : 'rgba(0,0,0,0.1)',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step content */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={step}
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
            {step === 1 && (
              <LocationStep onNext={handleNext} onSkip={handleSkip} />
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
            {(step === 5 || step === 6) && (
              <AIPreparationStep onReady={handleReady} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
