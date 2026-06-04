'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useSearchStore } from '@/lib/searchStore'

// Clé sessionStorage où l'AIPreparationStep dépose le feed pré-généré
// que la page /feed lira en priorité (évite le second loader).
const PREFETCH_KEY = 'shomee:pregen-feed'

// Number of biens shown in the final confirmation (matches the demo feed).
const RESULTS_COUNT = 4
// Each step stays visible 3s before the next replaces it (4 × 3s = 12s),
// laissant le temps au pré-fetch /api/feed/generate de répondre.
const STEP_DURATION = 3000
const ANALYSIS_STEPS = [
  { label: 'Analyse de votre zone idéale', delay: 0 },
  { label: 'Calibrage du budget', delay: STEP_DURATION },
  { label: 'Profil de recherche', delay: STEP_DURATION * 2 },
  { label: 'Nous sélectionnons les biens qui vous correspondent', delay: STEP_DURATION * 3 },
]

// Blinking block caret shown while the line is being "typed".
function Caret() {
  return (
    <motion.span
      aria-hidden
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 0.9, repeat: Infinity, ease: 'linear', times: [0, 0.5, 0.5, 1] }}
      className="inline-block"
      style={{ color: '#A64B27' }}
    >
      ▋
    </motion.span>
  )
}

// Three dots cycling while the engine "thinks" on the current step.
function ThinkingDots() {
  return (
    <span className="inline-flex">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut', delay: i * 0.18 }}
        >
          .
        </motion.span>
      ))}
    </span>
  )
}

interface AIPreparationStepProps {
  onReady: () => void
}

export default function AIPreparationStep({ onReady }: AIPreparationStepProps) {
  const { locationLabel, completeOnboarding } = useSearchStore()
  const [currentStep, setCurrentStep] = useState(0)
  const [done, setDone] = useState(false)
  const [typed, setTyped] = useState('')
  const [extraStatus, setExtraStatus] = useState<string | null>(null)
  // typingDone is derived, not stored: labels are all distinct, so `typed`
  // matches the full current label only once it has been fully typed out.
  const currentLabel = ANALYSIS_STEPS[currentStep].label
  const typingDone = typed === currentLabel

  // Typewriter effect: re-type the current step's label char by char (the
  // first tick clears any leftover text), then the animated dots take over
  // for the rest of the step duration.
  useEffect(() => {
    if (done) return
    const label = ANALYSIS_STEPS[currentStep].label
    let i = 0
    const id = setInterval(() => {
      setTyped(label.slice(0, i))
      if (i >= label.length) {
        clearInterval(id)
        return
      }
      i += 1
    }, 30)
    return () => clearInterval(id)
  }, [currentStep, done])

  useEffect(() => {
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    // ── Pré-fetch /api/feed/generate en parallèle de l'animation ─────
    // L'écran reste affiché jusqu'à ce que les DEUX se terminent, puis
    // navigue. Le résultat est déposé dans sessionStorage pour que
    // /feed le récupère sans refetch (= un seul écran de chargement).
    const s = useSearchStore.getState()
    const hasBrief =
      !!(s.minSurface || s.maxSurface || s.budgetMin || s.budgetMax ||
         s.minRooms || s.maxRooms || s.minBedrooms || s.maxBedrooms ||
         (s.propertyTypes?.length ?? 0) > 0 ||
         Object.values(s.chipStates ?? {}).some((v) => v > 0) ||
         (s.customCriteria?.length ?? 0) > 0 ||
         (s.selectedArrIds?.length ?? 0) > 0 ||
         (s.selectedCommuneIds?.length ?? 0) > 0)

    let fetchDone = !hasBrief
    let timerDone = false

    const tryComplete = () => {
      if (cancelled || !fetchDone || !timerDone) return
      completeOnboarding()
      onReady()
    }

    if (hasBrief) {
      const briefBody = {
        minSurface: s.minSurface,
        maxSurface: s.maxSurface,
        budgetMin: s.budgetMin,
        budgetMax: s.budgetMax,
        minRooms: s.minRooms,
        maxRooms: s.maxRooms,
        minBedrooms: s.minBedrooms,
        maxBedrooms: s.maxBedrooms,
        propertyTypes: s.propertyTypes,
        chipStates: s.chipStates,
        customCriteria: s.customCriteria,
        arrondissementIds: s.selectedArrIds,
        communeIds: s.selectedCommuneIds,
      }
      try { sessionStorage.removeItem(PREFETCH_KEY) } catch {}
      fetch('/api/feed/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(briefBody),
      })
        .then((r) => r.json())
        .then((data: unknown) => {
          if (cancelled) return
          if (Array.isArray(data) && data.length > 0) {
            try {
              sessionStorage.setItem(PREFETCH_KEY, JSON.stringify(data))
            } catch {
              // sessionStorage pleine ou indisponible — /feed retombera
              // sur son fetch habituel.
            }
          }
        })
        .catch(() => { /* /feed fera son propre fetch en fallback */ })
        .finally(() => {
          fetchDone = true
          if (!cancelled && timerDone) {
            setExtraStatus(null)
          }
          tryComplete()
        })
    }

    // ── Animation timers ─────────────────────────────────────────────
    ANALYSIS_STEPS.forEach((step, i) => {
      timers.push(setTimeout(() => {
        setCurrentStep(i)
      }, step.delay + 300))
    })

    const doneAt = ANALYSIS_STEPS[ANALYSIS_STEPS.length - 1].delay + 300 + STEP_DURATION
    timers.push(setTimeout(() => {
      setDone(true)
    }, doneAt))

    timers.push(setTimeout(() => {
      timerDone = true
      // Si le fetch n'a pas encore répondu, on tient l'écran et on
      // affiche un mini-statut pour expliquer la suite de l'attente.
      if (!cancelled && !fetchDone) {
        setExtraStatus('Finalisation de la sélection…')
      }
      tryComplete()
    }, doneAt + 1500))

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [completeOnboarding, onReady])

  return (
    <div
      className="flex flex-col items-center justify-center h-full px-8 text-center"
      style={{ background: 'linear-gradient(135deg, #FDF5F2 0%, #f0e8df 100%)' }}
    >
      {/* Animated orb */}
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
            className="w-14 h-14 rounded-full"
            style={{
              border: '2px solid rgba(166,75,39,0.2)',
              background: 'radial-gradient(circle at 35% 30%, #C9744F 0%, #A64B27 60%, #8A3C1E 100%)',
              boxShadow: '0 4px 14px rgba(166,75,39,0.3)',
            }}
          />
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

      {/* Analysis steps — typed live, one at a time, in a fixed-height slot
          so the orb and headline above never shift. */}
      <div className="mt-7 h-6 flex items-center justify-center w-full max-w-[300px]">
        {!done && (
          <span className="text-[13px] text-neutral-500 whitespace-nowrap">
            {typed}
            {typingDone ? <ThinkingDots /> : <Caret />}
          </span>
        )}
      </div>

      {/* Result confirmation — just the number of biens found, with a check */}
      {done && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 flex items-center gap-2.5"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.4, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#A64B27' }}
          >
            <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
              <path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
          <span className="text-[15px] font-semibold text-neutral-900">
            <span style={{ color: '#A64B27' }}>{RESULTS_COUNT}</span> biens trouvés
          </span>
        </motion.div>
      )}

      {/* Mini-statut affiché si l'animation est finie mais que le fetch
          /api/feed/generate continue (latence LLM > 9.5 s). Évite que
          l'écran ait l'air figé. */}
      {done && extraStatus && (
        <p className="mt-3 text-[12px] text-neutral-500">{extraStatus}</p>
      )}
    </div>
  )
}
