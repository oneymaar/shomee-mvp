import { memo, useCallback } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { Heart } from 'lucide-react-native'
import type { Property } from '@shomee/core/types/domain'
import { DEFAULT_FALLBACK_IMAGE } from '@shomee/core/constants'
import { useShomeeStore } from '@/lib/stores'

/**
 * Séparateurs de milliers + « € », sans Intl (support Hermes inégal) — aligné
 * sur PropertyOverlay / PropertyDetailSheet. Ex. 1350000 → "1 350 000 €".
 */
function formatPrice(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}

interface Props {
  property: Property
  onPress: () => void
}

/**
 * Vignette de bien pour la grille Favoris (2 colonnes) — portage de la carte
 * web `favorites/page.tsx` : miniature + titre (1 ligne) + prix + surface.
 *
 * `flex: 1` : la carte remplit sa demi-colonne (la grille gère le gap et une
 * cellule fantôme pour les rangées impaires). Le cœur plein en overlay retire
 * le bien des favoris ; la carte disparaît au re-render du store.
 */
function PropertyThumbnailBase({ property, onPress }: Props) {
  const toggleFavorite = useShomeeStore((s) => s.toggleFavorite)
  const handleUnfavorite = useCallback(
    () => toggleFavorite(property),
    [toggleFavorite, property],
  )

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.imageWrap}>
        <Image
          source={{ uri: property.imageUrlFallback || DEFAULT_FALLBACK_IMAGE }}
          style={styles.image}
          contentFit="cover"
          transition={150}
        />
        {/* Cœur plein — Pressable enfant : capte le tap sans déclencher la carte. */}
        <Pressable style={styles.heart} onPress={handleUnfavorite} hitSlop={10}>
          <Heart size={15} color="#fff" fill="#fff" />
        </Pressable>
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {property.title}
        </Text>
        <Text style={styles.price}>{formatPrice(property.price)}</Text>
        <Text style={styles.surface}>{property.surface} m²</Text>
      </View>
    </Pressable>
  )
}

export const PropertyThumbnail = memo(PropertyThumbnailBase)

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  imageWrap: { height: 130, backgroundColor: '#EFE7E2' },
  image: { width: '100%', height: '100%' },
  heart: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 12 },
  title: { fontSize: 12, fontWeight: '600', color: '#1c1917', lineHeight: 16 },
  price: { fontSize: 14, fontWeight: '700', color: '#1c1917', marginTop: 4 },
  surface: { fontSize: 12, color: '#78716c', marginTop: 2 },
})
