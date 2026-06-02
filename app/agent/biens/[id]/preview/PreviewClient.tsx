'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Volume2, VolumeX } from 'lucide-react'
import { motion } from 'framer-motion'
import MobileFrame from '@/components/MobileFrame'
import VideoCard from '@/components/VideoCard'
import PropertyOverlay from '@/components/PropertyOverlay'
import ActionRail from '@/components/ActionRail'
import BottomNav from '@/components/BottomNav'
import PropertyDetailSheet from '@/components/PropertyDetailSheet'
import type { Property } from '@/lib/types'

export default function PreviewClient({ property }: { property: Property }) {
  const router = useRouter()
  const [detailOpen, setDetailOpen] = useState(false)
  // Browsers refuse auto-play with sound, so we mirror the feed: start muted
  // and let the agent unmute via the speaker button.
  const [muted, setMuted] = useState(true)

  const hasMedia =
    Boolean(property.videoUrl) ||
    (property.gallery && property.gallery.length > 0)

  return (
    <div className="fixed inset-0 z-[100]" style={{ backgroundColor: '#000' }}>
      <MobileFrame>
        <div className="relative h-full w-full overflow-hidden bg-black">

          {/* Preview banner — fixed at the top of the mobile frame */}
          <div
            className="absolute top-0 inset-x-0 z-[300] flex items-center gap-2 bg-amber-400 px-3"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)', paddingBottom: 8 }}
          >
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1 text-black text-[12px] font-semibold active:opacity-70"
              aria-label="Quitter la prévisualisation"
            >
              <X size={14} />
              Quitter
            </button>
            <span className="flex-1 text-center text-black text-[11px] font-bold uppercase tracking-wider">
              Mode prévisualisation
            </span>
            <span className="w-[60px]" aria-hidden />
          </div>

          {hasMedia ? (
            <>
              <VideoCard property={property} isActive muted={muted} />
              {property.videoUrl && (
                <motion.button
                  type="button"
                  className="absolute right-4 z-30 w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20"
                  style={{ top: 'calc(env(safe-area-inset-top, 0px) + 56px)' }}
                  onClick={() => setMuted((m) => !m)}
                  whileTap={{ scale: 0.88 }}
                  aria-label={muted ? 'Activer le son' : 'Couper le son'}
                >
                  {muted ? <VolumeX size={15} className="text-white" /> : <Volume2 size={15} className="text-white" />}
                </motion.button>
              )}
              <PropertyOverlay
                property={property}
                onMore={() => setDetailOpen(true)}
                agencyTopOffset={28}
              />
              <ActionRail
                property={property}
                isFavorite={false}
                onToggleFavorite={() => {}}
                onMessage={() => {}}
                previewMode
              />
              <BottomNav previewMode />
              <PropertyDetailSheet
                property={property}
                open={detailOpen}
                onClose={() => setDetailOpen(false)}
                isFavorite={false}
                onToggleFavorite={() => {}}
                previewMode
              />
            </>
          ) : (
            <PropertyDetailSheet
              property={property}
              open
              onClose={() => router.back()}
              isFavorite={false}
              onToggleFavorite={() => {}}
              previewMode
            />
          )}
        </div>
      </MobileFrame>
    </div>
  )
}
