import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, View, type ViewToken } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BottomSheetModal } from '@gorhom/bottom-sheet'
import { Volume2, VolumeX } from 'lucide-react-native'
import feedSeed from '@shomee/core/data/feedSeed.json'
import type { Property } from '@shomee/core/types/domain'
import { useFeedStore } from '@/lib/stores'
import { apiFetch } from '@/lib/api'
import { FeedItem } from '@/components/FeedItem'
import { PropertyDetailSheet } from '@/components/PropertyDetailSheet'

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

  // PropertyDetailSheet : un seul modal au niveau du feed, présenté avec le bien
  // sélectionné depuis la carte (« Voir l'annonce » de l'overlay).
  const sheetRef = useRef<BottomSheetModal>(null)
  const [detail, setDetail] = useState<Property | null>(null)
  const openDetail = useCallback((p: Property) => {
    setDetail(p)
    sheetRef.current?.present()
  }, [])

  // Feed : seed instantané (transient) puis refresh live best-effort.
  //
  // (1) feedStore vide → on affiche la seed bundlée immédiatement : aucun loader,
  //     aucun écran vide (couvre aussi le cold-start Postgres ~38s).
  // (2) En arrière-plan, GET /api/properties renvoie un TABLEAU NU de biens
  //     PUBLISHED (newest first). On ne remplace la seed que si le catalogue a
  //     réellement changé ET que l'utilisateur n'a pas encore scrollé — sinon on
  //     ne l'arrache pas. Échec / réponse vide → la seed reste (best-effort).
  useEffect(() => {
    let cancelled = false

    if (!useFeedStore.getState().hasFeed()) {
      useFeedStore.getState().setFeed(SEED, String(Date.now()))
    }

    apiFetch('/api/properties')
      .then((r) => (r.ok ? r.json() : null))
      .then((live: Property[] | null) => {
        if (cancelled || !Array.isArray(live) || live.length === 0) return
        const seedIds = SEED.map((p) => p.id).join(',')
        const liveIds = live.slice(0, SEED.length).map((p) => p.id).join(',')
        // Le seed n'est qu'un aperçu (SEED.length biens, = les plus récents de la
        // base) ; le live porte tout le catalogue publié. On swap sauf si le live
        // est STRICTEMENT identique au seed (même taille ET mêmes ids) — cas rare
        // où la base n'aurait que ces biens. live[0] === seed[0] → aucun flash.
        if (live.length === SEED.length && liveIds === seedIds) return
        if (useFeedStore.getState().currentIndex !== 0) return // ne pas arracher l'utilisateur
        useFeedStore.getState().setFeed(live, String(Date.now()))
      })
      .catch(() => {}) // best-effort : la seed reste affichée

    return () => {
      cancelled = true
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
        onOpenDetail={openDetail}
      />
    ),
    [viewportH, currentIndex, muted, openDetail],
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

      {/* Detail sheet — partagé par toutes les cartes, présenté à la demande */}
      <PropertyDetailSheet ref={sheetRef} property={detail} />
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
