import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useVideoPlayer, VideoView } from 'expo-video'
import { Image } from 'expo-image'
import type { Property } from '@shomee/core/types/domain'
import { DEFAULT_FALLBACK_IMAGE } from '@shomee/core/constants'

interface Props {
  property: Property
  isActive: boolean
  /** Son coupé — global au feed (feedStore.muted). */
  muted: boolean
}

/**
 * VideoCard RN minimal (S4b-v1) — lecture pilotée par la visibilité, rien d'autre.
 * (Overlay, favori, hold-pause, chapitres, progress, detail sheet → v2.)
 *
 * `useVideoPlayer` gère le cycle de vie : le player est libéré quand la carte
 * se démonte (recyclage FlatList) → pas de lecteur fantôme jouant en fond.
 */
export function VideoCard({ property, isActive, muted }: Props) {
  const hasVideo = Boolean(property.videoUrl)

  const player = useVideoPlayer(property.videoUrl ?? '', (p) => {
    p.loop = true
    p.muted = muted
  })

  // Mute global synchronisé en continu (le flag vit dans le feedStore).
  useEffect(() => {
    player.muted = muted
  }, [muted, player])

  // Seule la carte active joue ; les autres sont en pause et rembobinées à 0
  // (donc une vidéo rejouée repart du début quand on y revient).
  useEffect(() => {
    if (!hasVideo) return
    if (isActive) {
      player.play()
    } else {
      player.pause()
      player.currentTime = 0
    }
  }, [isActive, hasVideo, player])

  return (
    <View style={styles.container}>
      {/* Poster de fallback SOUS la vidéo (couche de base) — visible le temps que
          la vidéo charge / pour les cartes sans vidéo. */}
      <Image
        source={{ uri: property.imageUrlFallback || DEFAULT_FALLBACK_IMAGE }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={150}
      />
      {hasVideo && (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
})
