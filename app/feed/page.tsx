'use client'

import { useRef, useEffect, useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Volume2, VolumeX } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'
import VideoCard from '@/components/VideoCard'
import PropertyOverlay from '@/components/PropertyOverlay'
import ActionRail from '@/components/ActionRail'
import SkipFeedbackCard from '@/components/SkipFeedbackCard'
import PropertyDetailSheet from '@/components/PropertyDetailSheet'
import BAIAModal from '@/components/BAIAModal'
import { useShomeeStore } from '@/lib/store'
import { properties } from '@/lib/mockData'

type FeedItem =
  | { type: 'property'; property: (typeof properties)[0] }
  | { type: 'interstitial'; property: (typeof properties)[0] }

export default function FeedPage() {
  const [muted, setMuted] = useState(true)
  const [baiaOpen, setBaiaOpen] = useState(false)
  const [detailProperty, setDetailProperty] = useState<typeof properties[0] | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const { currentIndex, favorites, setCurrentIndex, toggleFavorite } = useShomeeStore()

  // Build flat feed: promising properties get an interstitial card right after them.
  const feedItems = useMemo<FeedItem[]>(
    () =>
      properties.flatMap((p) =>
        p.promising
          ? [
              { type: 'property', property: p },
              { type: 'interstitial', property: p },
            ]
          : [{ type: 'property', property: p }],
      ),
    [],
  )

  // IntersectionObserver — update active property when a property card is ≥ 60% visible.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const id = (entry.target as HTMLDivElement).dataset.propertyId
            const idx = properties.findIndex((p) => p.id === id)
            if (idx !== -1) useShomeeStore.getState().setCurrentIndex(idx)
          }
        })
      },
      { threshold: 0.6, root: container },
    )

    cardRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <MobileFrame>
      {/* Vertical scroll feed with CSS snap */}
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-y-scroll scrollbar-hide"
        style={{ scrollSnapType: 'y mandatory', bottom: '60px' }}
      >
        {feedItems.map((item) => {
          if (item.type === 'interstitial') {
            return (
              <div
                key={`skip-${item.property.id}`}
                className="relative"
                style={{ height: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
              >
                <SkipFeedbackCard property={item.property} />
              </div>
            )
          }

          const { property } = item
          const propIndex = properties.findIndex((p) => p.id === property.id)
          const isActive = propIndex === currentIndex
          const isFavorite = favorites.includes(property.id)

          return (
            <div
              key={property.id}
              data-property-id={property.id}
              ref={(el) => {
                if (el) cardRefs.current.set(property.id, el)
                else cardRefs.current.delete(property.id)
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
                onToggleFavorite={() => toggleFavorite(property.id)}
                onContact={() => setBaiaOpen(true)}
              />
            </div>
          )
        })}
      </div>

      {/* Sound toggle — top right */}
      <motion.button
        className="absolute right-4 z-30 w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20"
        style={{ top: 'calc(env(safe-area-inset-top, 16px) + 12px)' }}
        onClick={() => setMuted((m) => !m)}
        whileTap={{ scale: 0.88 }}
      >
        {muted
          ? <VolumeX size={15} className="text-white" />
          : <Volume2 size={15} className="text-white" />}
      </motion.button>

      {/* Property detail sheet */}
      <PropertyDetailSheet
        property={detailProperty}
        open={Boolean(detailProperty)}
        onClose={() => setDetailProperty(null)}
        isFavorite={detailProperty ? favorites.includes(detailProperty.id) : false}
        onToggleFavorite={() => detailProperty && toggleFavorite(detailProperty.id)}
      />

      {/* BAIA modal */}
      <BAIAModal open={baiaOpen} onClose={() => setBaiaOpen(false)} />

      <BottomNav />
    </MobileFrame>
  )
}
