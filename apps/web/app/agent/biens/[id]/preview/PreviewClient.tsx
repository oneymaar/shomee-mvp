'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X, Volume2, VolumeX, Pencil } from 'lucide-react'
import { motion } from 'framer-motion'
import MobileFrame from '@/components/MobileFrame'
import VideoCard from '@/components/VideoCard'
import PropertyOverlay from '@/components/PropertyOverlay'
import ActionRail from '@/components/ActionRail'
import BottomNav from '@/components/BottomNav'
import PropertyDetailSheet from '@/components/PropertyDetailSheet'
import { couleurs } from '@/lib/theme'
import type { Property } from '@/lib/types'

/**
 * « Voir mon bien comme un acquéreur ».
 *
 * DEUX CORRECTIFS de cette version :
 *
 * 1. Le bandeau n'est plus posé en ABSOLU par-dessus la scène avec un
 *    `env(safe-area-inset-top)` pour seule marge — c'est ce qui le faisait
 *    passer sous l'îlot dynamique, `env()` valant 0 hors PWA. Il fait
 *    maintenant partie du FLUX : une rangée qui prend sa hauteur, la scène
 *    prend le reste. Plus rien à décaler à la main dessous.
 *
 * 2. Le jaune vif a laissé place au chrome sombre de la charte. La
 *    prévisualisation reste signalée (pastille terracotta + petites
 *    capitales), sans planter une bande fluo au-dessus d'une vidéo.
 */
export default function PreviewClient({ property }: { property: Property }) {
  const router = useRouter()
  const [detailOpen, setDetailOpen] = useState(false)
  // Les navigateurs refusent la lecture automatique avec le son : on démarre
  // muet, comme le feed, et l'agent réactive via le haut-parleur.
  const [muted, setMuted] = useState(true)

  const hasMedia =
    Boolean(property.videoUrl) ||
    (property.gallery && property.gallery.length > 0)

  return (
    <div className="fixed inset-0 z-[100]" style={{ backgroundColor: couleurs.nuit }}>
      <MobileFrame>
        <div className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: couleurs.nuit }}>

          {/* ── Le bandeau, dans le flux ── */}
          <div
            className="flex-none flex items-center gap-2 px-4 pb-2.5 pt-safe-bar"
            style={{ backgroundColor: couleurs.nuit, borderBottom: `1px solid ${couleurs.filetSurSombre}` }}
          >
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1.5 text-[12.5px] font-semibold active:opacity-60"
              style={{ color: couleurs.cremeSurSombre }}
              aria-label="Quitter la prévisualisation"
            >
              <X size={15} strokeWidth={2.2} />
              Quitter
            </button>

            <span className="flex-1 flex items-center justify-center gap-1.5 min-w-0">
              <span
                className="flex-none rounded-full"
                style={{ width: 6, height: 6, backgroundColor: couleurs.terracottaClair }}
              />
              <span
                className="text-[10px] font-bold uppercase truncate"
                style={{ color: 'rgba(246,237,230,0.62)', letterSpacing: '1.6px' }}
              >
                Prévisualisation
              </span>
            </span>

            <Link
              href={`/agent/biens/${property.id}/editer`}
              className="flex items-center gap-1.5 text-[12.5px] font-semibold active:opacity-60"
              style={{ color: couleurs.terracottaClair }}
            >
              <Pencil size={13} strokeWidth={2.2} />
              Modifier
            </Link>
          </div>

          {/* ── La scène — tout ce qui suit se positionne DANS ce cadre ── */}
          <div className="relative flex-1 overflow-hidden" style={{ backgroundColor: couleurs.nuit }}>
            {hasMedia ? (
              <>
                <VideoCard property={property} isActive muted={muted} />
                {property.videoUrl && (
                  <motion.button
                    type="button"
                    className="absolute right-4 z-30 w-9 h-9 rounded-full flex items-center justify-center"
                    style={{
                      top: 62,
                      backgroundColor: couleurs.fumee,
                      border: `1px solid ${couleurs.filetSurSombre}`,
                      backdropFilter: 'blur(6px)',
                    }}
                    onClick={() => setMuted((m) => !m)}
                    whileTap={{ scale: 0.88 }}
                    aria-label={muted ? 'Activer le son' : 'Couper le son'}
                  >
                    {muted ? <VolumeX size={15} className="text-white" /> : <Volume2 size={15} className="text-white" />}
                  </motion.button>
                )}
                {/* `safeTop={false}` : l'encoche est déjà absorbée par le
                    bandeau au-dessus — la reprendre ici doublerait la marge. */}
                <PropertyOverlay
                  property={property}
                  onMore={() => setDetailOpen(true)}
                  safeTop={false}
                />
                <ActionRail
                  property={property}
                  isFavorite={false}
                  onToggleFavorite={() => {}}
                  onMessage={() => {}}
                  previewMode
                />
                <BottomNav previewMode sombre />
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
        </div>
      </MobileFrame>
    </div>
  )
}
