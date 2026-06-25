import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, View, type ViewToken } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Volume2, VolumeX } from 'lucide-react-native'
import feedSeed from '@shomee/core/data/feedSeed.json'
import type { Property } from '@shomee/core/types/domain'
import { useFeedStore } from '@/lib/stores'
import { FeedItem } from '@/components/FeedItem'

// Seed bundlé (4 biens, URLs Cloudinary absolues) — source unique partagée avec
// le web (@shomee/core/data). v1 : seed uniquement, pas de feed live (brief/token).
const SEED = feedSeed as unknown as Property[]

/**
 * Onglet Biens — feed vidéo vertical (S4b).
 *
 * FlatList paginé plein écran : une seule vidéo joue à la fois (la carte visible),
 * déterminée par `onViewableItemsChanged`. Surcouches (overlay + action rail) dans
 * FeedItem. Mute global (feedStore) via un bouton unique au niveau du feed.
 */
export default function BiensScreen() {
  const insets = useSafeAreaInsets()
  // Hauteur réelle du conteneur (au-dessus de la barre d'onglets) mesurée via
  // onLayout — évite de deviner la math safe-area/tab-bar pour le paging.
  const [viewportH, setViewportH] = useState(0)

  const properties = useFeedStore((s) => s.properties)
  const currentIndex = useFeedStore((s) => s.currentIndex)
  const muted = useFeedStore((s) => s.muted)
  const toggleMuted = useFeedStore((s) => s.toggleMuted)

  // Seed instantané si le feed transient est vide (réutilise le feedStore S1/S3).
  useEffect(() => {
    if (!useFeedStore.getState().hasFeed()) {
      useFeedStore.getState().setFeed(SEED, String(Date.now()))
    }
  }, [])

  // RN exige une ref STABLE pour onViewableItemsChanged / viewabilityConfig.
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]
      if (first?.index != null) {
        useFeedStore.getState().setCurrentIndex(first.index)
      }
    },
  ).current
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current

  const renderItem = useCallback(
    ({ item, index }: { item: Property; index: number }) => (
      <FeedItem
        property={item}
        isActive={index === currentIndex}
        muted={muted}
        height={viewportH}
      />
    ),
    [viewportH, currentIndex, muted],
  )

  return (
    <View style={styles.root} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
      {viewportH > 0 && (
        <FlatList
          data={properties}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          extraData={`${currentIndex}|${muted}`}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(_, index) => ({
            length: viewportH,
            offset: viewportH * index,
            index,
          })}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          removeClippedSubviews
        />
      )}

      {/* Mute global — un seul bouton au niveau du feed (pas par carte) */}
      <Pressable
        onPress={toggleMuted}
        style={[styles.muteBtn, { top: insets.top + 12 }]}
        hitSlop={10}
      >
        {muted ? <VolumeX size={16} color="#fff" /> : <Volume2 size={16} color="#fff" />}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  muteBtn: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
