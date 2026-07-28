import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router'
import type { BottomSheetModal } from '@gorhom/bottom-sheet'
import { ArrowLeft, Volume2, VolumeX } from 'lucide-react-native'
import type { Property } from '@shomee/core/types/domain'
import { useFeedStore, useShomeeStore } from '@/lib/stores'
import { FeedItem } from '@/components/FeedItem'
import { PropertyDetailSheet } from '@/components/PropertyDetailSheet'

const ACCENT = '#A64B27'
const BAR_BG = '#FDF5F2'
const BAR_HEIGHT = 60
// Identités stables exigées par FlatList (pas de recréation par render).
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 } as const

/**
 * Lecteur plein écran des favoris (`/favorites/[id]`) — hors du groupe `(tabs)`,
 * donc présenté au-dessus de la tab bar (celle-ci disparaît). Parité avec le web
 * `app/favorites/[id]/page.tsx` : mêmes cartes que le feed (`FeedItem` = vidéo +
 * overlay + rail), démarrées sur le bien tapé, scroll vertical paginé.
 *
 * Seule différence assumée avec le feed : au lieu des 4 onglets, une barre du bas
 * custom — icône retour (à gauche) vers la grille, et « Favoris i/n » au centre
 * (i suit le bien visible pendant le scroll).
 */
export default function FavoritesViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()

  // Snapshot des favoris au montage : retirer un bien via le cœur du rail ne doit
  // pas réordonner le pager sous les doigts (comportement du web). Le compteur i/n
  // reste donc stable pendant la session de lecture.
  const [favProperties] = useState<Property[]>(
    () => useShomeeStore.getState().favorites,
  )

  const muted = useFeedStore((s) => s.muted)
  const toggleMuted = useFeedStore((s) => s.toggleMuted)

  const startIndex = Math.max(
    0,
    favProperties.findIndex((p) => p.id === id),
  )
  const [currentIndex, setCurrentIndex] = useState(startIndex)
  const [viewportH, setViewportH] = useState(0)
  // Pause la vidéo quand un écran est empilé par-dessus (ex. fil de discussion
  // ouvert depuis le rail) — sinon le son continuerait derrière.
  const isFocused = useIsFocused()

  // PropertyDetailSheet — même réplique locale que le feed (`(tabs)/index.tsx`) :
  // ref + `detail` + `openDetail`. Le BottomSheetModalProvider est global (root).
  const sheetRef = useRef<BottomSheetModal>(null)
  const [detail, setDetail] = useState<Property | null>(null)
  const openDetail = useCallback((p: Property) => {
    setDetail(p)
    sheetRef.current?.present()
  }, [])

  // Favoris vidé (ex. dernier bien retiré ailleurs) → retour à la grille.
  useEffect(() => {
    if (favProperties.length === 0) router.replace('/favorites')
  }, [favProperties.length, router])

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]
      if (first?.index != null) setCurrentIndex(first.index)
    },
    [],
  )

  const renderItem = useCallback(
    ({ item, index }: { item: Property; index: number }) => (
      <FeedItem
        property={item}
        isActive={index === currentIndex && isFocused}
        muted={muted}
        height={viewportH}
        onOpenDetail={openDetail}
      />
    ),
    [currentIndex, muted, viewportH, isFocused, openDetail],
  )

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/favorites')
  }, [router])

  return (
    <View style={styles.root}>
      <View
        style={styles.viewport}
        onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
      >
        {viewportH > 0 && (
          <FlatList
            data={favProperties}
            keyExtractor={(p) => p.id}
            renderItem={renderItem}
            extraData={`${currentIndex}|${muted}|${isFocused}`}
            initialScrollIndex={startIndex}
            getItemLayout={(_, index) => ({
              length: viewportH,
              offset: viewportH * index,
              index,
            })}
            onScrollToIndexFailed={() => {}}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={VIEWABILITY_CONFIG}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            removeClippedSubviews
          />
        )}

        {/* Mute global — identique au feed */}
        <Pressable
          onPress={toggleMuted}
          style={[styles.muteBtn, { top: insets.top + 12 }]}
          hitSlop={10}
        >
          {muted ? <VolumeX size={16} color="#fff" /> : <Volume2 size={16} color="#fff" />}
        </Pressable>
      </View>

      {/* Barre du bas custom (remplace les 4 onglets) */}
      <View
        style={[
          styles.bar,
          { height: BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom },
        ]}
      >
        <Pressable style={styles.barSide} onPress={goBack} hitSlop={10}>
          <ArrowLeft size={22} color="#1c1917" />
        </Pressable>
        <View style={styles.barCenter}>
          <Text style={styles.barText}>
            <Text style={styles.barLabel}>Favoris</Text>
            <Text style={styles.barCounter}>
              {'  '}
              {currentIndex + 1}/{favProperties.length}
            </Text>
          </Text>
        </View>
        <View style={styles.barSide} />
      </View>

      <PropertyDetailSheet ref={sheetRef} property={detail} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  viewport: { flex: 1 },
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
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BAR_BG,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  barSide: { width: 56, alignItems: 'center', justifyContent: 'center' },
  barCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  barText: { fontSize: 18 },
  barLabel: { fontWeight: '700', color: '#1c1917' },
  barCounter: { fontWeight: '600', color: ACCENT },
})
