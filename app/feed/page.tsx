'use client'

import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
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
import { useShomeeStore } from '@/lib/store'
import { properties } from '@/lib/mockData'

type FeedItem =
  | { type: 'property';     property: (typeof properties)[0] }
  | { type: 'interstitial'; property: (typeof properties)[0] }
  | { type: 'end-of-feed';  id: string; hasNewResults: boolean }

// Three stages driving the feed structure:
//   blocked    → [b1 b2 inter(2) b3 eof-1]             (b4 not yet accessible)
//   pre-reveal → [b1 b2 inter(2) b3 eof-1 b4 eof-2]    (b4 added below eof-1)
//   revealed   → [b1 b2 inter(2) b3 b4 eof-2]           (eof-1 removed)
type ResultsStage = 'blocked' | 'pre-reveal' | 'revealed'

export default function FeedPage() {
  const [muted, setMuted] = useState(true)
  const [baiaOpen, setBaiaOpen] = useState(false)
  const [detailProperty, setDetailProperty] = useState<typeof properties[0] | null>(null)
  const [isOnSpecialCard, setIsOnSpecialCard] = useState(false)
  const [resultsStage, setResultsStage] = useState<ResultsStage>('blocked')

  interface FlyHeart { id: number; from: { x: number; y: number }; to: { x: number; y: number } }
  const [flyHearts, setFlyHearts] = useState<FlyHeart[]>([])
  const [favBursts, setFavBursts] = useState<{ id: number; x: number; y: number }[]>([])

  const containerRef    = useRef<HTMLDivElement>(null)
  const cardRefs        = useRef<Map<string, HTMLDivElement>>(new Map())
  const specialCardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const { currentIndex, favorites, toggleFavorite } = useShomeeStore()

  const handleToggleFavorite = useCallback((propertyId: string, heartRect: DOMRect, currentlyFavorite: boolean) => {
    if (currentlyFavorite) {
      toggleFavorite(propertyId)
      return
    }

    const frame = containerRef.current?.parentElement
    const frameRect = frame?.getBoundingClientRect()
    if (!frameRect) { toggleFavorite(propertyId); return }

    // Favorites tab is 2nd of 4 tabs with justify-around → center at 37.5% of frame width
    const toX = frameRect.left + frameRect.width * (1.5 / 4)
    const toY = frameRect.top + frameRect.height - 30

    const fromX = heartRect.left + heartRect.width / 2
    const fromY = heartRect.top + heartRect.height / 2

    const id = Date.now()
    setFlyHearts((prev) => [...prev, { id, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } }])

    setTimeout(() => toggleFavorite(propertyId), 400)
    setTimeout(() => {
      setFlyHearts((prev) => prev.filter((h) => h.id !== id))
      setFavBursts((prev) => [...prev, { id, x: toX, y: toY }])
      setTimeout(() => setFavBursts((prev) => prev.filter((b) => b.id !== id)), 500)
    }, 850)
  }, [toggleFavorite])

  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = []

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
  }, [resultsStage])

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
  }, [resultsStage])

  return (
    <MobileFrame>
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-y-scroll scrollbar-hide"
        style={{ scrollSnapType: 'y mandatory', bottom: '60px' }}
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
          const isFavorite = favorites.includes(property.id)

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
              <PropertyOverlay
                property={property}
                onMore={() => setDetailProperty(property)}
                onBaia={() => setBaiaOpen(true)}
              />
              <ActionRail
                property={property}
                isFavorite={isFavorite}
                onToggleFavorite={(rect) => handleToggleFavorite(property.id, rect, isFavorite)}
                onContact={() => setBaiaOpen(true)}
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
        isFavorite={detailProperty ? favorites.includes(detailProperty.id) : false}
        onToggleFavorite={() => detailProperty && toggleFavorite(detailProperty.id)}
      />

      <BAIAModal open={baiaOpen} onClose={() => setBaiaOpen(false)} />
      <BottomNav />

      {/* Burst on favorites tab */}
      <AnimatePresence>
        {favBursts.map((b) => (
          <motion.div
            key={b.id}
            style={{ position: 'fixed', left: b.x, top: b.y, translateX: '-50%', translateY: '-50%', pointerEvents: 'none', zIndex: 9999 }}
            initial={{ scale: 0.4, opacity: 1 }}
            animate={{ scale: 2.2, opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <Heart size={22} className="fill-red-500 text-red-500" />
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
