'use client'

import { use, useRef, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Volume2, VolumeX, Heart } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'
import VideoCard from '@/components/VideoCard'
import PropertyOverlay from '@/components/PropertyOverlay'
import ActionRail from '@/components/ActionRail'
import PropertyDetailSheet from '@/components/PropertyDetailSheet'
import BAIAModal from '@/components/BAIAModal'
import { useShomeeStore } from '@/lib/store'
import { properties as allProperties } from '@/lib/mockData'

interface Props {
  params: Promise<{ id: string }>
}

export default function FavoritesFeedPage({ params }: Props) {
  const { id } = use(params)
  const router = useRouter()
  const { favorites, toggleFavorite } = useShomeeStore()

  const favProperties = favorites
    .map((fid) => allProperties.find((p) => p.id === fid))
    .filter(Boolean) as typeof allProperties

  const startIndex = Math.max(0, favProperties.findIndex((p) => p.id === id))

  const [currentIndex, setCurrentIndex] = useState(startIndex)
  const [muted, setMuted] = useState(true)
  const [baiaOpen, setBaiaOpen] = useState(false)
  const [detailProperty, setDetailProperty] = useState<typeof allProperties[0] | null>(null)

  interface FlyHeart { id: number; from: { x: number; y: number }; to: { x: number; y: number } }
  const [flyHearts, setFlyHearts] = useState<FlyHeart[]>([])
  const [favBursts, setFavBursts] = useState<{ id: number; x: number; y: number }[]>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const didScrollRef = useRef(false)

  // Scroll to the starting property on mount
  useEffect(() => {
    if (didScrollRef.current) return
    const el = cardRefs.current.get(id)
    const container = containerRef.current
    if (el && container) {
      container.scrollTop = el.offsetTop
      didScrollRef.current = true
    }
  })

  // Intersection observer to track active card
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const propId = (entry.target as HTMLDivElement).dataset.propertyId
            const idx = favProperties.findIndex((p) => p.id === propId)
            if (idx !== -1) setCurrentIndex(idx)
          }
        })
      },
      { threshold: 0.6, root: container },
    )

    cardRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [favProperties.map((p) => p.id).join(',')])

  const handleToggleFavorite = useCallback((propertyId: string, heartRect: DOMRect, currentlyFavorite: boolean) => {
    if (currentlyFavorite) {
      toggleFavorite(propertyId)
      return
    }

    const frame = containerRef.current?.parentElement
    const frameRect = frame?.getBoundingClientRect()
    if (!frameRect) { toggleFavorite(propertyId); return }

    const favEl = document.querySelector('[data-tab="favoris"] svg')
    const favRect = favEl?.getBoundingClientRect()
    const toX = favRect ? favRect.left + favRect.width / 2 : frameRect.left + frameRect.width * (1.5 / 4)
    const toY = favRect ? favRect.top + favRect.height / 2 : frameRect.top + frameRect.height - 30

    const fromX = heartRect.left + heartRect.width / 2
    const fromY = heartRect.top + heartRect.height / 2

    const animId = Date.now()
    setFlyHearts((prev) => [...prev, { id: animId, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } }])

    setTimeout(() => toggleFavorite(propertyId), 400)
    setTimeout(() => {
      setFlyHearts((prev) => prev.filter((h) => h.id !== animId))
      setFavBursts((prev) => [...prev, { id: animId, x: toX, y: toY }])
      setTimeout(() => setFavBursts((prev) => prev.filter((b) => b.id !== animId)), 500)
    }, 850)
  }, [toggleFavorite])

  if (favProperties.length === 0) {
    router.replace('/favorites')
    return null
  }

  return (
    <MobileFrame>
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-y-scroll scrollbar-hide"
        style={{ scrollSnapType: 'y mandatory', bottom: '60px' }}
      >
        {favProperties.map((property, index) => {
          const isActive = index === currentIndex
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
                onToggleFavorite={(rect) => handleToggleFavorite(property.id, rect, isFavorite)}
                onMessage={() => router.push(`/messages?bien=${property.id}`)}
              />
            </div>
          )
        })}
      </div>

      {/* Back button */}
      <motion.button
        onClick={() => router.push('/favorites')}
        className="absolute left-4 z-30 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20"
        style={{ top: 'calc(env(safe-area-inset-top, 16px) + 12px)' }}
        whileTap={{ scale: 0.88 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <ArrowLeft size={18} className="text-white" />
      </motion.button>

      {/* Mute toggle */}
      <motion.button
        className="absolute right-4 z-30 w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20"
        style={{ top: 'calc(env(safe-area-inset-top, 16px) + 12px)' }}
        onClick={() => setMuted((m) => !m)}
        whileTap={{ scale: 0.88 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {muted ? <VolumeX size={15} className="text-white" /> : <Volume2 size={15} className="text-white" />}
      </motion.button>

      <PropertyDetailSheet
        property={detailProperty}
        open={Boolean(detailProperty)}
        onClose={() => setDetailProperty(null)}
        isFavorite={detailProperty ? favorites.includes(detailProperty.id) : false}
        onToggleFavorite={() => detailProperty && toggleFavorite(detailProperty.id)}
      />

      <BAIAModal open={baiaOpen} onClose={() => setBaiaOpen(false)} />
      {!detailProperty && <BottomNav />}

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

      {/* Flying heart animation */}
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
