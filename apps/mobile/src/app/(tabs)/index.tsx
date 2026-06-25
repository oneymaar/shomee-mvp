import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, StyleSheet, View, type ViewToken } from 'react-native'
import feedSeed from '@shomee/core/data/feedSeed.json'
import type { Property } from '@shomee/core/types/domain'
import { useFeedStore } from '@/lib/stores'
import { VideoCard } from '@/components/VideoCard'

// Seed bundlé (4 biens, URLs Cloudinary absolues) — source unique partagée avec
// le web (@shomee/core/data). v1 : seed uniquement, pas de feed live (brief/token).
const SEED = feedSeed as unknown as Property[]

/**
 * Onglet Biens — feed vidéo vertical (S4b-v1).
 *
 * FlatList paginé plein écran : une seule vidéo joue à la fois (la carte visible),
 * déterminée par `onViewableItemsChanged`. Remplace l'IntersectionObserver web.
 * Périmètre v1 volontairement nu : ni overlay, ni favori, ni gestes (→ v2).
 */
export default function BiensScreen() {
  // Hauteur réelle du conteneur (au-dessus de la barre d'onglets) mesurée via
  // onLayout — évite de deviner la math safe-area/tab-bar pour le paging.
  const [viewportH, setViewportH] = useState(0)

  const properties = useFeedStore((s) => s.properties)
  const currentIndex = useFeedStore((s) => s.currentIndex)

  // Seed instantané si le feed transient est vide (réutilise le feedStore S1/S3).
  useEffect(() => {
    if (!useFeedStore.getState().hasFeed()) {
      useFeedStore.getState().setFeed(SEED, String(Date.now()))
    }
  }, [])

  // RN exige une ref STABLE pour onViewableItemsChanged / viewabilityConfig
  // (il lève une erreur si la fonction change entre deux renders).
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
      <View style={{ height: viewportH }}>
        <VideoCard property={item} isActive={index === currentIndex} />
      </View>
    ),
    [viewportH, currentIndex],
  )

  return (
    <View style={styles.root} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
      {viewportH > 0 && (
        <FlatList
          data={properties}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          extraData={currentIndex}
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
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
})
