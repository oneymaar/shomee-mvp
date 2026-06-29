import { useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
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
 * VideoCard RN (S4b-v2b) — lecture pilotée par la visibilité + hold-pause.
 * (Chapitres, progress, detail sheet → suite v2b.)
 *
 * `useVideoPlayer` gère le cycle de vie : le player est libéré quand la carte
 * se démonte (recyclage FlatList) → pas de lecteur fantôme jouant en fond.
 *
 * Hold-pause : un `LongPress` (seuil 200 ms) met en pause tant que le doigt
 * reste posé, et reprend au relâché. Le seuil temporel + `maxDistance` font
 * que le swipe vertical (qui bouge tout de suite) annule le geste → le scroll
 * du FlatList n'est jamais bloqué.
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

  // On ne reprend la lecture au relâché que si c'est bien NOUS qui avons mis en
  // pause (évite un play() parasite sur un simple tap ou sur une carte inactive).
  const pausedByHold = useRef(false)
  const holdPause = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(200)
        .maxDistance(12)
        .runOnJS(true)
        .onStart(() => {
          if (!hasVideo) return
          pausedByHold.current = true
          player.pause()
        })
        .onFinalize(() => {
          if (!pausedByHold.current) return
          pausedByHold.current = false
          if (hasVideo && isActive) player.play()
        }),
    [player, hasVideo, isActive],
  )

  return (
    <GestureDetector gesture={holdPause}>
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
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
})
