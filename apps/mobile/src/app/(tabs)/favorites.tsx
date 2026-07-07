import { useCallback } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Heart } from 'lucide-react-native'
import type { Property } from '@shomee/core/types/domain'
import { useShomeeStore } from '@/lib/stores'
import { PropertyThumbnail } from '@/components/PropertyThumbnail'

const ACCENT = '#A64B27'
const BG = '#FDF5F2'

// Cellule fantôme pour équilibrer une rangée impaire (garde le dernier bien
// aligné à gauche en demi-largeur au lieu de s'étirer sur toute la ligne).
const GHOST = { __ghost: true } as const
type Row = Property | typeof GHOST

function Header({ count }: { count: number }) {
  const plural = count !== 1 ? 's' : ''
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Favoris</Text>
      <Text style={styles.headerSub}>
        {count} bien{plural} sauvegardé{plural}
      </Text>
    </View>
  )
}

function RowGap() {
  return <View style={styles.rowGap} />
}

/**
 * Onglet Favoris (S5) — grille des biens favoris + empty state + ouverture de
 * la fiche au tap. 100 % client : lit `favorites` (fiches complètes) du store
 * partagé, alimenté par le cœur du feed. Portage du layout web `favorites/`.
 *
 * Au tap : navigation vers le lecteur plein écran `/favorites/[id]` (feed vidéo
 * démarré sur le bien tapé), hors `(tabs)` → la tab bar cède la place à la barre
 * custom du lecteur. Cf. `app/favorites/[id].tsx`.
 */
export default function FavoritesScreen() {
  const router = useRouter()
  const favorites = useShomeeStore((s) => s.favorites)

  const openViewer = useCallback(
    (p: Property) =>
      router.push({ pathname: '/favorites/[id]', params: { id: p.id } }),
    [router],
  )

  const renderItem = useCallback(
    ({ item }: { item: Row }) =>
      '__ghost' in item ? (
        <View style={styles.ghost} />
      ) : (
        <PropertyThumbnail property={item} onPress={() => openViewer(item)} />
      ),
    [openViewer],
  )

  if (favorites.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header count={0} />
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Heart size={28} color="#A3A3A3" />
          </View>
          <Text style={styles.emptyText}>
            Sauvegardez des biens depuis le feed pour les retrouver ici.
          </Text>
          <Pressable style={styles.cta} onPress={() => router.navigate('/')}>
            <Text style={styles.ctaText}>Explorer les biens</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const data: Row[] =
    favorites.length % 2 === 1 ? [...favorites, GHOST] : favorites

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header count={favorites.length} />
      <FlatList
        data={data}
        keyExtractor={(item) => ('__ghost' in item ? 'ghost' : item.id)}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        ItemSeparatorComponent={RowGap}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#1c1917', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: '#78716c', marginTop: 2 },

  grid: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
  row: { gap: 12 },
  rowGap: { height: 12 },
  ghost: { flex: 1 },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#78716c',
    textAlign: 'center',
    lineHeight: 21,
  },
  cta: {
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  ctaText: { color: ACCENT, fontSize: 14, fontWeight: '600' },
})
