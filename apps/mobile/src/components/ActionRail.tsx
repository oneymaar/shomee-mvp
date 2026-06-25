import { useRef } from 'react'
import { Animated, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { Heart, MessageCircle, Send } from 'lucide-react-native'
import type { Property } from '@shomee/core/types/domain'

function formatPrice(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}

interface Props {
  property: Property
  isFavorite: boolean
  onToggleFavorite: () => void
}

/**
 * Colonne d'actions à droite du feed (S4b-v2a).
 * Chaque bouton est une zone tactile isolée (Pressable) → ne déclenche ni le
 * scroll du FlatList ni les gestes vidéo.
 *  - Cœur : favori fonctionnel (store) + pulse au tap. Pas de fly-heart (v2+).
 *  - Message : placeholder (messagerie = S5).
 *  - Partage : feuille système iOS via Share.share (API react-native, pas de natif).
 */
export function ActionRail({ property, isFavorite, onToggleFavorite }: Props) {
  const scale = useRef(new Animated.Value(1)).current

  const handleFavorite = () => {
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.35, useNativeDriver: true, bounciness: 14, speed: 50 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 14, speed: 50 }),
    ]).start()
    onToggleFavorite()
  }

  const handleShare = () => {
    Share.share({
      message: `${property.title}\n${property.arrondissement} · ${property.surface} m² · ${formatPrice(property.price)}`,
    }).catch(() => {})
  }

  const likeCount = isFavorite ? (property.likeCount ?? 0) + 1 : (property.likeCount ?? 0)

  return (
    <View style={styles.rail} pointerEvents="box-none">
      {/* Message — placeholder (S5) */}
      <Pressable onPress={() => {}} style={styles.btn} hitSlop={8}>
        <MessageCircle size={28} color="#fff" strokeWidth={1.5} />
      </Pressable>

      {/* Cœur — favori fonctionnel */}
      <Pressable onPress={handleFavorite} style={styles.btn} hitSlop={8}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Heart
            size={28}
            strokeWidth={1.5}
            color={isFavorite ? '#ef4444' : '#fff'}
            fill={isFavorite ? '#ef4444' : 'transparent'}
          />
        </Animated.View>
        <Text style={styles.count}>{likeCount}</Text>
      </Pressable>

      {/* Partage — natif */}
      <Pressable onPress={handleShare} style={styles.btn} hitSlop={8}>
        <Send size={25} color="#fff" strokeWidth={1.5} />
        <Text style={styles.count}>{property.shareCount ?? 0}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', right: 12, bottom: 150, alignItems: 'center', gap: 22 },
  btn: { alignItems: 'center', gap: 4 },
  count: { color: '#fff', fontSize: 11, fontWeight: '600' },
})
