'use client'

import { Suspense, useState, useCallback, useEffect } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useSearchStore } from '@/lib/searchStore'
import QuartiersProtoFrame from '@/components/onboarding/QuartiersProtoFrame'
import BienStep from '@/components/onboarding/BienStep'
import BudgetStep from '@/components/onboarding/BudgetStep'
import CriteriaStep from '@/components/onboarding/CriteriaStep'
import AIPreparationStep from '@/components/onboarding/AIPreparationStep'
import AIBriefRecap from '@/components/onboarding/AIBriefRecap'
import HandoffInstallPanel from '@/components/onboarding/HandoffInstallPanel'
import { SURFACE_UNLIMITED } from '@/components/onboarding/BienStep'
import { injectBrief, type AIOnboardingBrief } from '@/lib/services/aiBriefInjector'

// Brief-import landing screen: logo + discrete spinner. Shown while the
// magic-link token is fetched and the geo resolver runs.
function BriefLoadingScreen() {
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6"
      style={{ background: '#FDF5F2' }}
    >
      <Image
        src="/logo terracotta.png"
        alt="SHOMEE"
        width={72}
        height={80}
        priority
        className="object-contain"
      />
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
      >
        <Loader2 size={20} style={{ color: '#A64B27', opacity: 0.7 }} />
      </motion.div>
      <p className="text-[13px] text-neutral-500 font-medium">
        Préparation de votre recherche…
      </p>
    </div>
  )
}

// Token expired / consumed / unknown — graceful fallback to manual start.
function BriefErrorScreen({ message, onStart }: { message: string; onStart: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 px-8"
      style={{ background: '#FDF5F2' }}
    >
      <Image
        src="/logo terracotta.png"
        alt="SHOMEE"
        width={72}
        height={80}
        priority
        className="object-contain"
      />
      <p className="text-[15px] text-neutral-700 font-medium text-center max-w-[280px]">
        {message}
      </p>
      <button
        type="button"
        onClick={onStart}
        className="mt-2 w-full max-w-[280px] py-3.5 rounded-2xl font-semibold text-[15px] text-white active:opacity-90 transition-opacity"
        style={{ backgroundColor: '#A64B27' }}
      >
        Commencer manuellement
      </button>
    </div>
  )
}

// S9 (handoff) — snapshot AIOnboardingBrief depuis le store, pour persister
// les ajustements du récap sur le Handoff avant le panneau d'installation.
// Sentinelles UI → contrat serveur : maxSurface ≥ SURFACE_UNLIMITED → null ;
// chips remises à 0 (dé-sélectionnées) filtrées ; customCriteria sans id.
function buildBriefFromStore(): AIOnboardingBrief {
  const s = useSearchStore.getState()
  const chipStates = Object.fromEntries(
    Object.entries(s.chipStates).filter(([, st]) => st === 1 || st === 2 || st === 3),
  ) as Record<string, 1 | 2 | 3>
  return {
    locationQuery: s.locationQuery,
    propertyTypes: s.propertyTypes,
    minRooms: s.minRooms,
    maxRooms: s.maxRooms,
    minBedrooms: s.minBedrooms,
    maxBedrooms: s.maxBedrooms,
    minSurface: s.minSurface ?? 20,
    maxSurface: s.maxSurface != null && s.maxSurface >= SURFACE_UNLIMITED ? null : s.maxSurface,
    budgetMin: s.budgetMin,
    budgetMax: s.budgetMax ?? 1,
    chipStates,
    customCriteria: s.customCriteria
      .filter((c) => c.state > 0)
      .map((c) => ({ label: c.label, state: c.state as 1 | 2 | 3 })),
  }
}

// Steps: 1=Location (text + map), 2=Bien, 3=Budget, 4=Priorities, 5=AI
// (Intro removed — the splash screen is the entry point.)
// locationMapOpen / clarificationData are sub-states of step 1 — still the
// same Localisation step.
const STEP_LABELS = ['Quartiers', 'Bien', 'Budget', 'Critères'] as const
const TOTAL_STEPS = STEP_LABELS.length

type Direction = 1 | -1

const variants = {
  enter: (dir: Direction) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: Direction) => ({ x: dir > 0 ? '-55%' : '55%', opacity: 0 }),
}

// Default export wraps the inner page in Suspense so `useSearchParams()`
// stays within a Suspense boundary, as required by Next.js 16 App Router.
export default function OnboardingPage() {
  return (
    <Suspense fallback={<BriefLoadingScreen />}>
      <OnboardingPageInner />
    </Suspense>
  )
}

function OnboardingPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const briefToken = searchParams.get('brief')
  // S9 — mode handoff : /h/<token> redirige vers /onboarding?h=<token>.
  // Même expérience que le brief legacy (récap + édition), mais la validation
  // persiste les ajustements sur le Handoff puis affiche le panneau
  // d'installation (au lieu de lancer le feed PWA).
  const handoffToken = searchParams.get('h')
  const { onboardingCompleted, completeOnboarding, locationQuery } = useSearchStore()
  // Step 0 (IntroStep) was removed — the splash screen now serves as the
  // intro, so onboarding opens directly on step 1 (Localisation).
  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState<Direction>(1)
  // ── AI brief magic-link flow ───────────────────────────────────────────
  // briefLoading: covers the screen with the BriefLoadingScreen while we
  //   fetch + inject. Defaults to true when ?brief=… is in the URL so the
  //   IntroStep never flashes before we know what to render.
  // briefError: when the token is 404/410/etc., we surface a friendly
  //   message + a "start manually" button.
  // aiRecapOpen: the recap overlays the linear onboarding when true.
  // editingFromRecap: rewires next/back so the user bounces back to the
  //   recap instead of advancing through the linear flow.
  // aiGeoResolved: false when the geo resolver couldn't narrow to any
  //   IRIS; surfaced as a warning in the recap.
  const [briefLoading, setBriefLoading] = useState<boolean>(!!briefToken || !!handoffToken)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [aiRecapOpen, setAiRecapOpen] = useState(false)
  const [editingFromRecap, setEditingFromRecap] = useState(false)
  const [aiGeoResolved, setAiGeoResolved] = useState(true)
  // ── Handoff S9 — sous-états du mode ?h= ─────────────────────────────────
  // handoffMeta: code court + expiration (affichés au panneau d'installation).
  // handoffDone: brief validé (et persisté) → panneau d'installation.
  // handoffClaimed: le brief est déjà dans l'app → panneau variante « déjà là ».
  const [handoffMeta, setHandoffMeta] = useState<{ shortCode: string; expiresAt: string } | null>(null)
  const [handoffDone, setHandoffDone] = useState(false)
  const [handoffClaimed, setHandoffClaimed] = useState(false)
  const [handoffSaving, setHandoffSaving] = useState(false)
  const [handoffSaveError, setHandoffSaveError] = useState<string | null>(null)
  // Dynamic viewport height — shrinks when keyboard opens on iOS.
  // Initialize from visualViewport on mount to avoid the null-then-100dvh flash.
  const [viewportH, setViewportH] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    return window.visualViewport?.height ?? window.innerHeight ?? null
  })

  useEffect(() => {
    // En mode handoff, un onboarding PWA déjà complété sur cet appareil ne
    // doit PAS téléporter l'utilisateur vers le feed web : il vient pour SON
    // récap et le panneau d'installation de l'app.
    if (onboardingCompleted && !handoffToken) router.replace('/feed')
  }, [onboardingCompleted, handoffToken, router])

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
    setStep(next)
  }, [])

  const handleNext = useCallback(() => {
    // When editing a single block from the AI recap, advancing must return
    // to the recap rather than walking the linear onboarding.
    if (editingFromRecap) {
      setEditingFromRecap(false)
      setAiRecapOpen(true)
      return
    }
    // S9 : en mode handoff, la fin du flow linéaire (« Recommencer à zéro »)
    // revient au récap — jamais vers l'AIPreparationStep/feed PWA.
    if (handoffToken && step === 4) {
      setAiRecapOpen(true)
      return
    }
    goTo(step + 1, 1)
  }, [step, goTo, editingFromRecap, handoffToken])
  const handleBack = useCallback(() => {
    if (editingFromRecap) {
      setEditingFromRecap(false)
      setAiRecapOpen(true)
      return
    }
    // Step 1 is now the first step — back returns to the splash screen.
    if (step === 1) {
      router.replace('/')
      return
    }
    goTo(step - 1, -1)
  }, [step, editingFromRecap, goTo, router])
  const handleReady = useCallback(() => router.replace('/feed'), [router])

  // ── AI brief magic-link handlers ────────────────────────────────────────
  // Triggered once on mount when ?brief=<uuid> is present. Fetches the
  // brief from /api/buyer/onboarding-prefill (which consumes the token),
  // injects it into the store, then surfaces the recap.
  useEffect(() => {
    if (!briefToken) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/buyer/onboarding-prefill?token=${encodeURIComponent(briefToken)}`,
        )
        if (cancelled) return
        if (!res.ok) {
          // 410 = expired, 404 = unknown token, anything else = transient.
          // Tokens are no longer single-use, so "déjà utilisé" is gone from
          // the messaging — only expiry is surfaced explicitly.
          const message =
            res.status === 410
              ? "Ce lien a expiré. Relancez une conversation avec l'assistant SHOMEE pour en générer un nouveau."
              : res.status === 404
                ? "Ce lien est introuvable. Demandez un nouveau lien à l'assistant SHOMEE."
                : 'Impossible de charger votre brief. Réessayez plus tard.'
          setBriefError(message)
          setBriefLoading(false)
          return
        }
        const json = (await res.json()) as { success: boolean; brief?: AIOnboardingBrief }
        if (!json.success || !json.brief) {
          setBriefError(
            "Ce lien a expiré. Relancez une conversation avec l'assistant SHOMEE pour en générer un nouveau.",
          )
          setBriefLoading(false)
          return
        }
        await injectBrief(json.brief)
        if (cancelled) return
        // geoResolved = at least one IRIS was selected by the resolver
        const { selectedIrisIds } = useSearchStore.getState()
        setAiGeoResolved(selectedIrisIds.length > 0)
        setAiRecapOpen(true)
        setBriefLoading(false)
      } catch (e) {
        console.error('[onboarding] brief import failed:', e)
        if (cancelled) return
        setBriefError('Impossible de charger votre brief. Réessayez plus tard.')
        setBriefLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [briefToken])

  // ── Handoff S9 : chargement via /api/handoff/peek ───────────────────────
  // Même chorégraphie que le brief legacy : loader plein écran → injectBrief
  // → récap. Un handoff déjà réclamé saute directement au panneau « déjà
  // dans l'app » (l'édition web serait désynchronisée du profil serveur).
  useEffect(() => {
    if (!handoffToken) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/handoff/peek?token=${encodeURIComponent(handoffToken)}`)
        if (cancelled) return
        if (!res.ok) {
          const message =
            res.status === 410
              ? 'Ce lien a expiré. Relancez une conversation avec votre assistant pour en générer un nouveau.'
              : res.status === 404
                ? 'Ce lien est introuvable. Demandez un nouveau lien à votre assistant.'
                : 'Impossible de charger votre recherche. Réessayez plus tard.'
          setBriefError(message)
          setBriefLoading(false)
          return
        }
        const json = (await res.json()) as {
          success: boolean
          status?: 'pending' | 'claimed'
          shortCode?: string
          expiresAt?: string
          brief?: AIOnboardingBrief
        }
        if (!json.success || !json.brief) {
          setBriefError('Impossible de charger votre recherche. Réessayez plus tard.')
          setBriefLoading(false)
          return
        }
        setHandoffMeta({ shortCode: json.shortCode ?? '', expiresAt: json.expiresAt ?? '' })
        if (json.status === 'claimed') {
          setHandoffClaimed(true)
          setBriefLoading(false)
          return
        }
        await injectBrief(json.brief)
        if (cancelled) return
        const { selectedIrisIds } = useSearchStore.getState()
        setAiGeoResolved(selectedIrisIds.length > 0)
        setAiRecapOpen(true)
        setBriefLoading(false)
      } catch (e) {
        console.error('[onboarding] handoff import failed:', e)
        if (cancelled) return
        setBriefError('Impossible de charger votre recherche. Réessayez plus tard.')
        setBriefLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [handoffToken])

  // Fallback CTA on the brief-error screen — drop the user into the normal
  // onboarding without the ?brief= param so a refresh doesn't refetch.
  const handleBriefErrorStart = useCallback(() => {
    setBriefError(null)
    setBriefLoading(false)
    router.replace('/onboarding')
  }, [router])

  const handleRecapEditBlock = useCallback(
    (target: 1 | 2 | 3 | 4) => {
      setAiRecapOpen(false)
      setEditingFromRecap(true)
      // Quartiers : l'ecran embarque s'ouvre DIRECTEMENT sur la carte avec la
      // zone du brief deja resolue (props initialQuery + startOnMap de
      // QuartiersProtoFrame), et son propre ecran d'attente couvre le calcul.
      goTo(target, 1)
    },
    [goTo],
  )
  const handleRecapEditManual = useCallback(() => {
    setAiRecapOpen(false)
    setEditingFromRecap(false)
    goTo(1, 1)
  }, [goTo])
  const handleRecapLaunch = useCallback(async () => {
    // S9 : valider = persister les ajustements sur le Handoff (le claim de
    // l'app récupérera la version éditée), puis panneau d'installation.
    if (handoffToken) {
      setHandoffSaving(true)
      setHandoffSaveError(null)
      try {
        const res = await fetch('/api/handoff/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: handoffToken, brief: buildBriefFromStore() }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setAiRecapOpen(false)
        setHandoffDone(true)
      } catch {
        setHandoffSaveError(
          'Vos ajustements n’ont pas pu être enregistrés — vérifiez votre connexion et réessayez.',
        )
      } finally {
        setHandoffSaving(false)
      }
      return
    }
    completeOnboarding()
    router.replace('/feed')
  }, [handoffToken, completeOnboarding, router])

  // Rebond recap (parite natif) : une zone validee depuis l'edition du bloc
  // Quartiers revient au recap au lieu de derouler le funnel vers Bien.
  const handleMapValidate = useCallback(() => {
    if (editingFromRecap) {
      setEditingFromRecap(false)
      setAiRecapOpen(true)
      return
    }
    goTo(2, 1)
  }, [editingFromRecap, goTo])

  // CriteriaStep collapses the chrome (back + progress) when its textarea
  // enters focus mode. Tracked here so the top bar can react.
  const [criteriaFocused, setCriteriaFocused] = useState(false)

  const chromeHidden = (step === 4 && criteriaFocused) || step === 1
  // L'ecran Quartiers ne se monte QUE s'il est reellement visible : sinon
  // l'iframe se chargerait (clavier compris) derriere le recap / les ecrans
  // de chargement du mode handoff.
  const quartiersVisible =
    step === 1 &&
    !aiRecapOpen &&
    !briefLoading &&
    !briefError &&
    !handoffDone &&
    !handoffClaimed
  const showBack = step > 0 && !chromeHidden
  const showProgress = step >= 1 && step <= 4 && !chromeHidden

  // Une cle par etape : l'etape 1 n'a plus de sous-ecrans (saisie/carte sont
  // internes a l'ecran embarque).
  const screenKey = String(step)

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
      <div className="flex-1 relative overflow-hidden" style={{ isolation: 'isolate' }}>
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
            {quartiersVisible && (
              <QuartiersProtoFrame
                initialQuery={locationQuery}
                startOnMap={editingFromRecap && locationQuery.trim().length > 0}
                onValidate={handleMapValidate}
                onBack={handleBack}
              />
            )}

            {step === 2 && (
              <BienStep onNext={handleNext} />
            )}

            {step === 3 && (
              <BudgetStep onNext={handleNext} />
            )}

            {step === 4 && (
              <CriteriaStep
                onNext={handleNext}
                onFocusChange={setCriteriaFocused}
              />
            )}

            {step === 5 && (
              <AIPreparationStep onReady={handleReady} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* AI brief recap — full-viewport overlay rendered above the step UI.
          Stays under the map loader (z-9999) so any in-flight resolution still
          covers it correctly. Mounted only when open so each fresh import
          plays its entrance animation. */}
      <AnimatePresence>
        {aiRecapOpen && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0 z-[100]"
            style={{ background: '#FDF5F2' }}
          >
            <AIBriefRecap
              geoResolved={aiGeoResolved}
              onEditBlock={handleRecapEditBlock}
              onEditManual={handleRecapEditManual}
              onLaunch={handleRecapLaunch}
              ctaLabel={handoffToken ? 'Valider ma recherche' : undefined}
              busy={handoffSaving}
              errorText={handoffSaveError}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* S9 — panneau d'installation du handoff (au-dessus du récap). */}
      <AnimatePresence>
        {(handoffDone || handoffClaimed) && handoffToken && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0 z-[150]"
            style={{ background: '#FDF5F2' }}
          >
            <HandoffInstallPanel
              token={handoffToken}
              shortCode={handoffMeta?.shortCode ?? ''}
              expiresAt={handoffMeta?.expiresAt ?? ''}
              claimed={handoffClaimed}
              onBackToRecap={
                handoffClaimed
                  ? undefined
                  : () => {
                      setHandoffDone(false)
                      setAiRecapOpen(true)
                    }
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Brief magic-link landing screens — render OVER everything else so
          the IntroStep never flashes when the URL carries a ?brief= token. */}
      {briefLoading && <BriefLoadingScreen />}
      {briefError && (
        <BriefErrorScreen message={briefError} onStart={handleBriefErrorStart} />
      )}

    </div>
  )
}
