'use client'

import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Volume2, VolumeX, Heart } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'
import VideoCard from '@/components/VideoCard'
import PropertyOverlay from '@/components/PropertyOverlay'
import ActionRail from '@/components/ActionRail'
import SkipFeedbackCard from '@/components/SkipFeedbackCard'
import EndOfFeedCard from '@/components/EndOfFeedCard'
import PropertyDetailSheet from '@/components/PropertyDetailSheet'
import BAIAModal from '@/components/BAIAModal'
import AIPreparationStep from '@/components/onboarding/AIPreparationStep'
import { useShomeeStore } from '@/lib/store'
import { useSearchStore } from '@/lib/searchStore'
import { properties as mockProperties } from '@/lib/mockData'
import type { Property } from '@/lib/types'

type FeedItem =
  | { type: 'property';     property: Property }
  | { type: 'interstitial'; property: Property }
  | { type: 'end-of-feed';  id: string; hasNewResults: boolean }

// Three stages driving the feed structure:
//   blocked    → [b1 b2 inter(2) b3 eof-1]             (b4 not yet accessible)
//   pre-reveal → [b1 b2 inter(2) b3 eof-1 b4 eof-2]    (b4 added below eof-1)
//   revealed   → [b1 b2 inter(2) b3 b4 eof-2]           (eof-1 removed)
type ResultsStage = 'blocked' | 'pre-reveal' | 'revealed'

export default function FeedPage() {
  // Son actif par défaut à l'arrivée sur le feed, quel que soit le chemin
  // (onboarding natif, lien magique LLM, ou accès direct). L'utilisateur peut
  // couper via le bouton mute.
  const [muted, setMuted] = useState(false)
  const [baiaOpen, setBaiaOpen] = useState(false)
  const [detailProperty, setDetailProperty] = useState<Property | null>(null)
  const [isOnSpecialCard, setIsOnSpecialCard] = useState(false)
  const [resultsStage, setResultsStage] = useState<ResultsStage>('blocked')
  // Start empty so no VideoCard renders (and no .mp4 starts playing) before
  // the real feed arrives. Falling back to mockProperties as the initial
  // value caused a visible flash: the first mock video would auto-play for
  // a beat before the API response swapped it for the top-ranked bien.
  const [properties, setProperties] = useState<Property[]>([])
  const [feedReady, setFeedReady] = useState(false)
  // Le loader plein écran (AIPreparationStep) s'affiche dès qu'on doit faire un
  // fetch LLM live (≈10 s) faute de feed pré-généré en cache. Depuis l'onboarding
  // natif, l'AIPreparationStep a déjà tourné et déposé le feed en sessionStorage
  // → /feed le lit direct, liveFetch reste false, pas de loader rejoué. Mais via
  // une recherche LLM sans cache (ou si le pré-fetch onboarding a échoué), on
  // affiche bien le loader au lieu d'un écran vide. Mis à jour en effet pour
  // éviter tout mismatch d'hydratation.
  const [liveFetch, setLiveFetch] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Pre-generated feed déposé par l'AIPreparationStep — la fetch
    // /api/feed/generate a déjà tourné pendant l'animation onboarding.
    // Si présent, on l'utilise direct et on saute le fetch local.
    let cachedFeed: Property[] | null = null
    try {
      const cached = sessionStorage.getItem('shomee:pregen-feed')
      if (cached) {
        sessionStorage.removeItem('shomee:pregen-feed')
        const data = JSON.parse(cached) as Property[]
        if (Array.isArray(data) && data.length > 0) cachedFeed = data
      }
    } catch {
      // sessionStorage indispo / JSON cassé → fallback fetch normal.
    }

    if (cachedFeed) {
      // Defer to a microtask so we don't setState synchronously in the
      // effect body (évite les cascades de rendus signalées par le linter).
      const feed = cachedFeed
      queueMicrotask(() => {
        if (cancelled) return
        setProperties(feed)
        setFeedReady(true)
      })
      return () => { cancelled = true }
    }

    // Pas de cache → on va faire un fetch live (LLM generate ou /api/properties).
    // On bascule le loader plein écran pour ne pas laisser un écran vide pendant
    // la latence. queueMicrotask : on évite un setState synchrone dans le corps
    // de l'effet (cascades de rendus signalées par le linter).
    queueMicrotask(() => { if (!cancelled) setLiveFetch(true) })

    // Read a fresh snapshot at the moment of fetch — Zustand's getState()
    // bypasses the subscription model so we don't re-render the feed when
    // unrelated store fields change. The body shape is the same subset
    // accepted by `buildBriefFromSnapshot` on the server.
    const s = useSearchStore.getState()
    const hasBrief =
      !!(s.minSurface || s.maxSurface || s.budgetMin || s.budgetMax ||
         s.minRooms || s.maxRooms || s.minBedrooms || s.maxBedrooms ||
         (s.propertyTypes?.length ?? 0) > 0 ||
         Object.values(s.chipStates ?? {}).some((v) => v > 0) ||
         (s.customCriteria?.length ?? 0) > 0 ||
         (s.selectedArrIds?.length ?? 0) > 0 ||
         (s.selectedCommuneIds?.length ?? 0) > 0)

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
      // Geo selection — the server maps these to video tags / arrondissement
      // strings depending on the endpoint, before scoring. On envoie tous
      // les niveaux (arr / quartier / IRIS / commune) : /api/feed/generate
      // résout l'arrondissement à partir de n'importe laquelle de ces sources.
      arrondissementIds: s.selectedArrIds,
      communeIds: s.selectedCommuneIds,
      quartierIds: s.selectedQuartierIds,
      irisIds: s.selectedIrisIds,
    }
    // eslint-disable-next-line no-console
    console.log('[Feed] hasBrief=' + hasBrief, '| brief=', briefBody)

    // With a brief → LLM-generated feed, matched to real video tags.
    // Without a brief → chronological feed (legacy /api/properties GET).
    const fetchPromise = hasBrief
      ? fetch('/api/feed/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(briefBody),
        })
      : fetch('/api/properties')

    fetchPromise
      .then(async (r) => {
        // eslint-disable-next-line no-console
        console.log('[Feed] response status=' + r.status + ' ok=' + r.ok)
        if (!r.ok) {
          const text = await r.text().catch(() => '')
          // eslint-disable-next-line no-console
          console.warn('[Feed] response body (error):', text.slice(0, 300))
          throw new Error(`HTTP ${r.status}`)
        }
        return r.json()
      })
      .then(async (data: Property[]) => {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.log(
          '[Feed] data type=' + (Array.isArray(data) ? 'array' : typeof data) +
          ' length=' + (Array.isArray(data) ? data.length : '-'),
        )
        if (Array.isArray(data)) {
          for (let i = 0; i < Math.min(3, data.length); i++) {
            const p = data[i]
            // eslint-disable-next-line no-console
            console.log(
              '[Feed] top ' + (i + 1) + ': "' + p.title + '" — ' +
              p.surface + 'm² ' + p.rooms + 'p ' + p.price + '€ — score=' + p.matchScore,
            )
          }
        }
        if (Array.isArray(data) && data.length > 0) {
          setProperties(data)
          setFeedReady(true)
          return
        }
        // Empty / malformed. With a brief, /api/feed/generate returns []
        // when video-tags.json is empty or the LLM produced 0 fiches —
        // fall back to the chronological feed before resorting to mocks.
        // eslint-disable-next-line no-console
        console.warn('[Feed] empty response — falling back to /api/properties')
        try {
          const r2 = await fetch('/api/properties')
          const fallbackData = (await r2.json()) as Property[]
          if (cancelled) return
          if (Array.isArray(fallbackData) && fallbackData.length > 0) {
            setProperties(fallbackData)
          } else {
            setProperties(mockProperties)
          }
        } catch {
          if (cancelled) return
          setProperties(mockProperties)
        }
        setFeedReady(true)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[feed] /api/properties unavailable, using mock fallback', err)
        setProperties(mockProperties)
        setFeedReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  interface FlyHeart { id: number; from: { x: number; y: number }; to: { x: number; y: number } }
  const [flyHearts, setFlyHearts] = useState<FlyHeart[]>([])
  const [favBursts, setFavBursts] = useState<{ id: number; x: number; y: number }[]>([])

  const containerRef    = useRef<HTMLDivElement>(null)
  const cardRefs        = useRef<Map<string, HTMLDivElement>>(new Map())
  const specialCardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const router = useRouter()
  const { currentIndex, favorites, toggleFavorite } = useShomeeStore()

  const handleToggleFavorite = useCallback((property: Property, heartRect: DOMRect, currentlyFavorite: boolean) => {
    if (currentlyFavorite) {
      toggleFavorite(property)
      return
    }

    const frame = containerRef.current?.parentElement
    const frameRect = frame?.getBoundingClientRect()
    if (!frameRect) { toggleFavorite(property); return }

    // Use actual DOM position of the favorites tab icon
    const favEl = document.querySelector('[data-tab="favoris"] svg')
    const favRect = favEl?.getBoundingClientRect()
    const toX = favRect ? favRect.left + favRect.width / 2 : frameRect.left + frameRect.width * (1.5 / 4)
    const toY = favRect ? favRect.top + favRect.height / 2 : frameRect.top + frameRect.height - 30

    const fromX = heartRect.left + heartRect.width / 2
    const fromY = heartRect.top + heartRect.height / 2

    const id = Date.now()
    setFlyHearts((prev) => [...prev, { id, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } }])

    setTimeout(() => toggleFavorite(property), 400)
    setTimeout(() => {
      setFlyHearts((prev) => prev.filter((h) => h.id !== id))
      setFavBursts((prev) => [...prev, { id, x: toX, y: toY }])
      setTimeout(() => setFavBursts((prev) => prev.filter((b) => b.id !== id)), 500)
    }, 850)
  }, [toggleFavorite])

  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = []

    // Don't build any cards (and therefore don't auto-start a VideoCard)
    // before the API has answered. Keeps the entry pristine instead of
    // flashing a mock video for the duration of the fetch.
    if (!feedReady || properties.length === 0) return items

    for (const p of properties.slice(0, 3)) {
      items.push({ type: 'property', property: p })
      if (p.promising) items.push({ type: 'interstitial', property: p })
    }

    if (resultsStage === 'blocked') {
      items.push({ type: 'end-of-feed', id: 'eof-1', hasNewResults: true })
    } else if (resultsStage === 'pre-reveal') {
      items.push({ type: 'end-of-feed', id: 'eof-1', hasNewResults: true })
      if (properties[3]) items.push({ type: 'property', property: properties[3] })
      items.push({ type: 'end-of-feed', id: 'eof-2', hasNewResults: false })
    } else {
      // revealed: eof-1 gone, b4 takes its scroll position
      if (properties[3]) items.push({ type: 'property', property: properties[3] })
      items.push({ type: 'end-of-feed', id: 'eof-2', hasNewResults: false })
    }

    return items
  }, [resultsStage, properties, feedReady])

  // Step 1: BAIA found results → add b4 to DOM below eof-1 so the scroll has a destination
  const handleFoundResults = useCallback(() => {
    setResultsStage('pre-reveal')
  }, [])

  // Step 2: scroll to b4, then remove eof-1 with an instant position correction
  const handleScrollToNew = useCallback(() => {
    const b4el = cardRefs.current.get(properties[3]?.id)
    if (!b4el) return

    b4el.scrollIntoView({ behavior: 'smooth' })

    // After smooth scroll completes: switch to revealed and correct scroll position
    setTimeout(() => {
      setResultsStage('revealed')
      requestAnimationFrame(() => {
        const el = cardRefs.current.get(properties[3]?.id)
        const container = containerRef.current
        if (el && container) container.scrollTop = el.offsetTop
      })
    }, 1200)
  }, [properties])

  // Force scroll to 0 on mount — iOS PWA sets a non-zero contentOffset on full-screen scroll containers
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    requestAnimationFrame(() => { el.scrollTop = 0 })
  }, [])

  // Re-setup observers whenever the feed structure changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const propObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const id = (entry.target as HTMLDivElement).dataset.propertyId
            const idx = properties.findIndex((p) => p.id === id)
            if (idx !== -1) {
              useShomeeStore.getState().setCurrentIndex(idx)
              setIsOnSpecialCard(false)
            }
          }
        })
      },
      { threshold: 0.6, root: container },
    )

    const specialObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            setIsOnSpecialCard(true)
          }
        })
      },
      { threshold: 0.6, root: container },
    )

    cardRefs.current.forEach((el)        => propObserver.observe(el))
    specialCardRefs.current.forEach((el) => specialObserver.observe(el))

    return () => {
      propObserver.disconnect()
      specialObserver.disconnect()
    }
  }, [resultsStage, properties])

  return (
    <MobileFrame>
      {/* Écran d'attente pendant le fetch LLM live (≈10 s) : on réutilise tel
          quel l'AIPreparationStep de l'onboarding. Disparaît dès que feedReady
          passe à true. Non affiché quand le feed vient du cache pré-généré
          (onboarding natif) : liveFetch reste false → pas de loader rejoué. */}
      {liveFetch && !feedReady && (
        <div className="absolute inset-0 z-50">
          <AIPreparationStep onReady={() => {}} />
        </div>
      )}
      <div
        ref={containerRef}
        className="absolute inset-x-0 top-0 overflow-y-scroll scrollbar-hide"
        style={{ scrollSnapType: 'y mandatory', height: '100dvh' }}
      >
        {feedItems.map((item, feedIndex) => {

          /* ── End of feed ── */
          if (item.type === 'end-of-feed') {
            return (
              <div
                key={item.id}
                ref={(el) => {
                  if (el) specialCardRefs.current.set(item.id, el)
                  else    specialCardRefs.current.delete(item.id)
                }}
                className="relative"
                style={{ height: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
              >
                <EndOfFeedCard
                  hasNewResults={item.hasNewResults}
                  newResultsCount={1}
                  onFoundResults={item.id === 'eof-1' ? handleFoundResults : undefined}
                  onScrollToNew={item.id === 'eof-1' ? handleScrollToNew : undefined}
                />
              </div>
            )
          }

          /* ── Interstitial ── */
          if (item.type === 'interstitial') {
            const nextItem = feedItems[feedIndex + 1]
            const handleAfterSubmit =
              nextItem?.type === 'property'
                ? () => cardRefs.current.get(nextItem.property.id)?.scrollIntoView({ behavior: 'smooth' })
                : undefined

            return (
              <div
                key={`skip-${item.property.id}`}
                ref={(el) => {
                  if (el) specialCardRefs.current.set(`skip-${item.property.id}`, el)
                  else    specialCardRefs.current.delete(`skip-${item.property.id}`)
                }}
                className="relative"
                style={{ height: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
              >
                <SkipFeedbackCard property={item.property} onAfterSubmit={handleAfterSubmit} />
              </div>
            )
          }

          /* ── Property card ── */
          const { property } = item
          const propIndex  = properties.findIndex((p) => p.id === property.id)
          const isActive   = propIndex === currentIndex
          const isFavorite = favorites.some((f) => f.id === property.id)

          return (
            <div
              key={property.id}
              data-property-id={property.id}
              ref={(el) => {
                if (el) cardRefs.current.set(property.id, el)
                else    cardRefs.current.delete(property.id)
              }}
              className="relative"
              style={{ height: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
            >
              <VideoCard property={property} isActive={isActive} muted={muted} />
              {/* Real match score (0..1) when the API ran the engine;
                  otherwise fall back to the previous synthetic value so
                  the existing UI keeps animating. */}
              {(() => {
                const score01 =
                  typeof property.matchScore === 'number'
                    ? property.matchScore
                    : Math.max(0.8, 0.95 - propIndex * 0.04)
                return (
                  <>
                    <PropertyOverlay
                      property={property}
                      onMore={() => setDetailProperty(property)}
                      matchScore={Math.round(score01 * 100)}
                      isActive={isActive}
                    />
                  </>
                )
              })()}
              <ActionRail
                property={property}
                isFavorite={isFavorite}
                onToggleFavorite={(rect) => handleToggleFavorite(property, rect, isFavorite)}
                onMessage={() => router.push(`/messages?bien=${property.id}`)}
              />
            </div>
          )
        })}
      </div>

      {!isOnSpecialCard && (
        <motion.button
          className="absolute right-4 z-30 w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20"
          style={{ top: 'calc(env(safe-area-inset-top, 16px) + 12px)' }}
          onClick={() => setMuted((m) => !m)}
          whileTap={{ scale: 0.88 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {muted ? <VolumeX size={15} className="text-white" /> : <Volume2 size={15} className="text-white" />}
        </motion.button>
      )}

      <PropertyDetailSheet
        property={detailProperty}
        open={Boolean(detailProperty)}
        onClose={() => setDetailProperty(null)}
        isFavorite={detailProperty ? favorites.some((f) => f.id === detailProperty.id) : false}
        onToggleFavorite={() => detailProperty && toggleFavorite(detailProperty)}
        onMessage={() => { setDetailProperty(null); router.push(`/messages?bien=${detailProperty?.id}`) }}
      />

      <BAIAModal open={baiaOpen} onClose={() => setBaiaOpen(false)} />
      {!detailProperty && !baiaOpen && <BottomNav />}

      {/* Burst heart on favorites tab */}
      <AnimatePresence>
        {favBursts.map((b) => (
          <motion.div
            key={b.id}
            style={{ position: 'fixed', left: b.x, top: b.y, translateX: '-50%', translateY: '-50%', pointerEvents: 'none', zIndex: 9999 }}
            initial={{ scale: 1, opacity: 0.9 }}
            animate={{ scale: 2.6, opacity: 0 }}
            transition={{ duration: 0.42, ease: 'easeOut' }}
          >
            <Heart size={23} strokeWidth={1.8} className="fill-red-500 text-red-500" />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Flying heart animation overlay */}
      <AnimatePresence>
        {flyHearts.map((fh) => (
          <motion.div
            key={fh.id}
            style={{
              position: 'fixed',
              left: fh.from.x,
              top: fh.from.y,
              translateX: '-50%',
              translateY: '-50%',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
            initial={{ x: 0, y: 0, scale: 1.6, opacity: 1 }}
            animate={{
              x: [0, (fh.to.x - fh.from.x) * 0.15, fh.to.x - fh.from.x],
              y: [0, -110, fh.to.y - fh.from.y],
              scale: [1.6, 1.8, 0.7],
              opacity: [1, 1, 0],
            }}
            transition={{
              duration: 0.85,
              ease: 'easeInOut',
              times: [0, 0.38, 1],
              opacity: { duration: 0.85, ease: 'easeInOut', times: [0, 0.92, 1] },
            }}
          >
            <Heart size={26} className="fill-red-500 text-red-500 drop-shadow-lg" />
          </motion.div>
        ))}
      </AnimatePresence>
    </MobileFrame>
  )
}
