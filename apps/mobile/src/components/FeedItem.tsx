import { View } from 'react-native'
import type { Property } from '@shomee/core/types/domain'
import { useShomeeStore } from '@/lib/stores'
import { VideoCard } from './VideoCard'
import { PropertyOverlay } from './PropertyOverlay'
import { ActionRail } from './ActionRail'

interface Props {
  property: Property
  isActive: boolean
  muted: boolean
  height: number
}

/**
 * Une carte plein écran du feed : vidéo (fond) + overlay (infos) + action rail.
 * S'abonne à son propre statut favori pour n'isoler le re-render qu'à cette carte.
 */
export function FeedItem({ property, isActive, muted, height }: Props) {
  const isFavorite = useShomeeStore((s) => s.favorites.some((f) => f.id === property.id))
  const toggleFavorite = useShomeeStore((s) => s.toggleFavorite)

  return (
    <View style={{ height }}>
      <VideoCard property={property} isActive={isActive} muted={muted} />
      <PropertyOverlay property={property} onMore={() => {}} />
      <ActionRail
        property={property}
        isFavorite={isFavorite}
        onToggleFavorite={() => toggleFavorite(property)}
      />
    </View>
  )
}
