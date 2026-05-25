'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useSearchStore } from '@/lib/searchStore'
import IntroStep from '@/components/onboarding/IntroStep'
import LocationStep from '@/components/onboarding/LocationStep'
import LocationMapStep from '@/components/onboarding/LocationMapStep'
import ClarificationStep from '@/components/onboarding/ClarificationStep'
import BienStep from '@/components/onboarding/BienStep'
import BudgetStep from '@/components/onboarding/BudgetStep'
import CriteriaStep from '@/components/onboarding/CriteriaStep'
import AIPreparationStep from '@/components/onboarding/AIPreparationStep'
import { parseLocationIntent } from '@/lib/services/locationIntentParser'
import type { ClarificationOption, LocationIntentAnalysis } from '@/lib/services/locationIntentAnalyzerService'

function MapLoadingScreen() {
  return (
    <div className="flex flex-col h-full items-center justify-center gap-5">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
      >
        <Loader2 size={32} style={{ color: '#A64B27', opacity: 0.7 }} />
      </motion.div>
      <p className="text-[15px] text-neutral-600 font-medium">SHOMEE réfléchit…</p>
    </div>
  )
}

// Steps: 0=Intro, 1=Location (text + map), 2=Bien, 3=Budget, 4=Priorities, 5=AI
// locationMapOpen / clarificationData are sub-states of step 1 — still the
// same Localisation step.
const STEP_LABELS = ['Quartiers', 'Bien', 'Budget', 'Autres critères'] as const
const TOTAL_STEPS = STEP_LABELS.length

type Direction = 1 | -1

const variants = {
  enter: (dir: Direction) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: Direction) => ({ x: dir > 0 ? '-55%' : '55%', opacity: 0 }),
}

export default function OnboardingPage() {
  const router = useRouter()
  const { onboardingCompleted, setLocation } = useSearchStore()
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<Direction>(1)
  const [locationMapOpen, setLocationMapOpen] = useState(false)
  // Sub-state of step 1 — when set, the dedicated ClarificationStep screen
  // renders instead of LocationStep (textarea). The originalQuery is kept so
  // the clarification screen can echo "votre recherche : …" and the
  // "Ouvrir la carte quand même" CTA can fall back to that vague query.
  const [clarificationData, setClarificationData] = useState<{
    analysis: LocationIntentAnalysis
    originalQuery: string
  } | null>(null)
  // Atomic-reveal architecture:
  //   - mapWillOpen   : true the moment the user clicks "Afficher sur la carte"
  //                     (before any analysis runs). Drives the loader overlay
  //                     directly so the underlying button never has time to
  //                     render an "Analyse en cours" state.
  //   - locationMapOpen: true once LocationStep has finished analyzing and
  //                     called setLocation + onOpenMap → LocationMapStep mounts.
  //   - mapUiReady    : true when LocationMapStep has signaled onReady AND the
  //                     3s minimum has elapsed → opacity flips to 1.
  // The loader overlay is shown while (mapWillOpen && !mapUiReady).
  const [mapWillOpen, setMapWillOpen] = useState(false)
  const [mapUiReady, setMapUiReady] = useState(false)
  const mapLoadingStartedAtRef = useRef<number>(0)
  // Dynamic viewport height — shrinks when keyboard opens on iOS.
  // Initialize from visualViewport on mount to avoid the null-then-100dvh flash.
  const [viewportH, setViewportH] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    return window.visualViewport?.height ?? window.innerHeight ?? null
  })

  useEffect(() => {
    if (onboardingCompleted) router.replace('/feed')
  }, [onboardingCompleted, router])

  // Prevent iOS rubber-band / elastic scroll on the whole onboarding flow.
  // Multiple layers because no single approach works reliably on iOS Safari:
  // 1. position:fixed body — blocks document scroll
  // 2. Force-reset scroll on any scroll event — catches iOS auto-scroll-to-input
  // 3. Block touchmove except inside scrollable children (map, textarea)
  useEffect(() => {
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      width: document.body.style.width,
      top: document.body.style.top,
      htmlOverflow: document.documentElement.style.overflow,
    }
    const scrollY = window.scrollY
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    document.body.style.top = `-${scrollY}px`

    const resetScroll = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0)
      if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0
    }
    window.addEventListener('scroll', resetScroll, { passive: true })
    document.addEventListener('scroll', resetScroll, { passive: true })

    // Block touchmove on document EXCEPT inside elements that legitimately scroll
    const blockTouchmove = (e: TouchEvent) => {
      let el = e.target as HTMLElement | null
      while (el && el !== document.body) {
        const ov = getComputedStyle(el).overflowY
        if (ov === 'auto' || ov === 'scroll') return
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return
        // Leaflet map container has class "leaflet-container"
        if (el.classList && el.classList.contains('leaflet-container')) return
        el = el.parentElement
      }
      e.preventDefault()
    }
    document.addEventListener('touchmove', blockTouchmove, { passive: false })

    return () => {
      document.documentElement.style.overflow = prev.htmlOverflow
      document.body.style.overflow = prev.overflow
      document.body.style.position = prev.position
      document.body.style.width = prev.width
      document.body.style.top = prev.top
      window.removeEventListener('scroll', resetScroll)
      document.removeEventListener('scroll', resetScroll)
      document.removeEventListener('touchmove', blockTouchmove)
      window.scrollTo(0, scrollY)
    }
  }, [])

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
    setMapUiReady(false)
    setMapWillOpen(false)
    setClarificationData(null)
    mapLoadingStartedAtRef.current = 0
    setStep(next)
  }, [])

  const handleNext = useCallback(() => goTo(step + 1, 1), [step, goTo])
  const handleBack = useCallback(() => {
    if (locationMapOpen) {
      setLocationMapOpen(false)
      setMapUiReady(false)
      setMapWillOpen(false)
      mapLoadingStartedAtRef.current = 0
      return
    }
    if (clarificationData) {
      // Back from clarification → typing form (still step 1).
      setDirection(-1)
      setClarificationData(null)
      return
    }
    if (step === 0) return
    goTo(step - 1, -1)
  }, [step, locationMapOpen, clarificationData, goTo])
  const handleSkip = useCallback(() => goTo(step + 1, 1), [step, goTo])
  const handleQuick = useCallback(() => router.replace('/feed'), [router])
  const handleReady = useCallback(() => router.replace('/feed'), [router])

  // Called by LocationStep synchronously on button click — BEFORE the async
  // analysis starts. The overlay appears in the same paint so the user never
  // sees the button transition to a loading state.
  const handleStartMapLoading = useCallback(() => {
    mapLoadingStartedAtRef.current = Date.now()
    setMapUiReady(false)
    setMapWillOpen(true)
  }, [])
  // Called by LocationStep when the analysis ends up needing clarification or
  // disambiguation from the user — we cancel the pending overlay and let the
  // typing form become visible again.
  const handleCancelMapLoading = useCallback(() => {
    setMapWillOpen(false)
    mapLoadingStartedAtRef.current = 0
  }, [])
  const handleOpenMap = useCallback(() => {
    // For sync paths (e.g. disambiguation pick) handleStartMapLoading wasn't
    // called first — initialise the timestamp now. For async paths it's
    // already set; don't reset it (we want the 3s floor to count from click).
    if (mapLoadingStartedAtRef.current === 0) {
      mapLoadingStartedAtRef.current = Date.now()
    }
    setMapWillOpen(true)
    setMapUiReady(false)
    setLocationMapOpen(true)
  }, [])
  // 3s minimum visible duration for the loader (UX feel). The map keeps
  // preparing in the background — this only delays the visual reveal so quick
  // resolutions don't flash by. If the engine took longer than 3s, reveal
  // happens immediately. Double rAF: let React commit latest state and Leaflet
  // paint the styled zones in the same frame before we flip opacity.
  const MIN_LOADING_DURATION = 3000
  const handleMapReady = useCallback(() => {
    const elapsed = Date.now() - mapLoadingStartedAtRef.current
    const remaining = Math.max(0, MIN_LOADING_DURATION - elapsed)
    window.setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setMapUiReady(true)
          setMapWillOpen(false)
          mapLoadingStartedAtRef.current = 0
        })
      })
    }, remaining)
  }, [])
  const handleMapValidate = useCallback(() => goTo(2, 1), [goTo])

  // ── Clarification handlers ──────────────────────────────────────────────
  // LocationStep signals it needs clarification; we slide to ClarificationStep.
  const handleNeedsClarification = useCallback(
    (analysis: LocationIntentAnalysis, originalQuery: string) => {
      setDirection(1)
      setClarificationData({ analysis, originalQuery })
    },
    [],
  )
  // Build a SearchIntent from the chosen option's structured constraints and
  // open the map directly. No second LLM call — the option already carries
  // everything we need (see ClarificationOption.geoConstraints contract).
  const handleClarificationSelectOption = useCallback(
    (opt: ClarificationOption) => {
      const effectiveQuery = opt.query?.trim() || clarificationData?.originalQuery || ''
      const centerQuery = opt.centerQuery || effectiveQuery
      const parsed = parseLocationIntent(centerQuery)
      const intent = {
        ...(opt.preselectZones?.length ? { ...parsed, location_terms: opt.preselectZones } : parsed),
        ...(opt.geoConstraints?.length ? { geoConstraints: opt.geoConstraints } : {}),
        ...(opt.resolutionStrategy ? { resolutionStrategy: opt.resolutionStrategy } : {}),
        parserSource: 'llm_fallback' as const,
      }
      setLocation({ query: effectiveQuery, label: centerQuery, lat: 0, lng: 0, intent })
      setClarificationData(null)
      // Re-arm the loader timestamp here — handleCancelMapLoading reset it
      // when the clarification UI took over.
      mapLoadingStartedAtRef.current = Date.now()
      setMapWillOpen(true)
      setMapUiReady(false)
      setLocationMapOpen(true)
    },
    [clarificationData?.originalQuery, setLocation],
  )
  // "Ouvrir la carte quand même" → open the map with the user's original
  // vague query and no special constraints.
  const handleClarificationOpenAnyway = useCallback(() => {
    const q = clarificationData?.originalQuery?.trim() ?? ''
    if (!q) return
    const intent = parseLocationIntent(q)
    setLocation({ query: q, label: q, lat: 0, lng: 0, intent })
    setClarificationData(null)
    mapLoadingStartedAtRef.current = Date.now()
    setMapWillOpen(true)
    setMapUiReady(false)
    setLocationMapOpen(true)
  }, [clarificationData?.originalQuery, setLocation])
  const handleClarificationBack = useCallback(() => {
    setDirection(-1)
    setClarificationData(null)
  }, [])

  // CriteriaStep collapses the chrome (back + progress) when its textarea
  // enters focus mode. Tracked here so the top bar can react.
  const [criteriaFocused, setCriteriaFocused] = useState(false)

  const chromeHidden = step === 4 && criteriaFocused
  const showBack = step > 0 && !chromeHidden
  const showProgress = step >= 1 && step <= 4 && !chromeHidden

  // Key does NOT depend on mapLoading — changing it would re-mount LocationMapStep
  // and restart initMap, causing the partial-map flash bug.
  // Step 1 has three sub-states: typing / clarification / map.
  const screenKey =
    step === 1
      ? locationMapOpen
        ? '1-map'
        : clarificationData
        ? '1-clarify'
        : '1-text'
      : String(step)

  return (
    <div
      className="fixed inset-x-0 top-0 flex flex-col overflow-hidden"
      style={{
        background: '#FDF5F2',
        maxWidth: 430,
        margin: '0 auto',
        height: viewportH ? `${viewportH}px` : '100svh',
        overscrollBehavior: 'none',
      }}
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
              {STEP_LABELS.map((label, i) => {
                const isActive = i === step - 1
                const isPast = i < step - 1
                const isFuture = !isActive && !isPast
                // Active: full terracotta bold | Past: pale terracotta bold
                // (same hue as the disabled CTA `#DB947E`) | Future: gray normal
                const barColor =
                  isActive ? '#A64B27' :
                  isPast   ? '#DB947E' :
                             'rgba(0,0,0,0.1)'
                const labelColor =
                  isActive ? '#A64B27' :
                  isPast   ? '#DB947E' :
                             '#525252'  // neutral-600 — readable on cream
                const labelWeight = (isActive || isPast) ? 700 : 500
                return (
                  <div key={label} className="flex-1 flex flex-col items-stretch gap-1">
                    <div
                      className="h-1 rounded-full transition-all duration-400"
                      style={{ backgroundColor: barColor }}
                    />
                    <span
                      className="text-[10px] leading-none text-center transition-colors duration-400"
                      style={{ color: labelColor, fontWeight: labelWeight }}
                    >
                      {label}
                    </span>
                  </div>
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

            {step === 1 && !locationMapOpen && !clarificationData && (
              <LocationStep
                onOpenMap={handleOpenMap}
                onSkip={handleSkip}
                onStartMapLoading={handleStartMapLoading}
                onCancelMapLoading={handleCancelMapLoading}
                onNeedsClarification={handleNeedsClarification}
              />
            )}

            {step === 1 && !locationMapOpen && clarificationData && (
              <ClarificationStep
                originalQuery={clarificationData.originalQuery}
                analysis={clarificationData.analysis}
                onSelectOption={handleClarificationSelectOption}
                onBackToTyping={handleClarificationBack}
                onOpenAnyway={handleClarificationOpenAnyway}
              />
            )}

            {step === 1 && locationMapOpen && (
              // Atomic-reveal wrapper: LocationMapStep stays mounted but invisible
              // until it has signaled (onReady) that its full UI is painted.
              // opacity:0 instead of display:none so Leaflet computes the right size.
              <div
                className={`h-full ${mapUiReady ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                style={{ transition: 'opacity 180ms ease' }}
              >
                <LocationMapStep
                  onValidate={handleMapValidate}
                  onBack={() => { setLocationMapOpen(false); setMapUiReady(false) }}
                  onReady={handleMapReady}
                />
              </div>
            )}

            {step === 2 && (
              <BienStep onNext={handleNext} onSkip={handleSkip} />
            )}

            {step === 3 && (
              <BudgetStep onNext={handleNext} onSkip={handleSkip} />
            )}

            {step === 4 && (
              <CriteriaStep
                onNext={handleNext}
                onSkip={handleSkip}
                onFocusChange={setCriteriaFocused}
              />
            )}

            {step === 5 && (
              <AIPreparationStep onReady={handleReady} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Atomic-reveal overlay — covers the whole viewport from the very click
          (mapWillOpen is set BEFORE LocationStep starts its async analysis) and
          stays up until LocationMapStep signals onReady AND the 3s floor has
          elapsed. Sits above everything (incl. AnimatePresence + topbar) so
          the user never sees the button transition through a loading state. */}
      {mapWillOpen && !mapUiReady && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: '#FDF5F2' }}
        >
          <MapLoadingScreen />
        </div>
      )}
    </div>
  )
}
