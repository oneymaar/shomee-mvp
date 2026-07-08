import { useRef } from 'react'
import { Alert, Animated, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { Heart, MessageCircle, Phone, Send } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import type { Property } from '@shomee/core/types/domain'
import { useFlyHeartStore } from '@/lib/flyHeartStore'

// TODO: numéro de test — remplacer par le téléphone de l'agence (feed live).
// Property n'a pas encore de champ agencyPhone ; quand il existera, il sera
// utilisé en priorité (cf. handleCall) et cette constante deviendra inutile.
const TEST_PHONE = '0670744935'

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
 *  - Message : ouvre le fil de discussion du bien (/messages/[id]).
 *  - Partage : feuille système iOS via Share.share (API react-native, pas de natif).
 */
export function ActionRail({ property, isFavorite, onToggleFavorite }: Props) {
  const router = useRouter()
  const scale = useRef(new Animated.Value(1)).current
  // Origine du vol : le centre du glyphe cœur (mesuré à l'instant du tap).
  const heartWrapRef = useRef<View>(null)

  // Ouvre le fil de discussion du bien (parité avec le bouton « Message » de la
  // fiche). La conversation est créée à l'envoi du 1er message côté thread.
  const handleMessage = () => {
    router.push({ pathname: '/messages/[id]', params: { id: property.id } })
  }

  const handleFavorite = () => {
    // Transition non-favori → favori UNIQUEMENT : un-favorite ne lance aucun cœur.
    const willFavorite = !isFavorite
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.35, useNativeDriver: true, bounciness: 14, speed: 50 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 14, speed: 50 }),
    ]).start()
    onToggleFavorite()
    if (willFavorite) {
      heartWrapRef.current?.measureInWindow((x, y, w, h) => {
        if (w && h) useFlyHeartStore.getState().launch({ x: x + w / 2, y: y + h / 2 })
      })
    }
  }

  const handleShare = () => {
    Share.share({
      message: `${property.title}\n${property.arrondissement} · ${property.surface} m² · ${formatPrice(property.price)}`,
    }).catch(() => {})
  }

  const handleCall = () => {
    // Téléphone de l'agence si présent (feed live), sinon numéro de test.
    const phone = (property as { agencyPhone?: string }).agencyPhone ?? TEST_PHONE
    // Le simulateur iOS n'a pas d'app Téléphone → openURL('tel:') échoue.
    // Sur un vrai iPhone le composeur s'ouvre normalement ; sinon (simu, iPad
    // sans téléphonie) on affiche le numéro pour rester utilisable.
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert("Appeler l'agence", phone)
    })
  }

  const likeCount = isFavorite ? (property.likeCount ?? 0) + 1 : (property.likeCount ?? 0)

  return (
    <View style={styles.rail} pointerEvents="box-none">
      {/* Message — ouvre le fil de discussion du bien */}
      <Pressable onPress={handleMessage} style={styles.btn} hitSlop={8}>
        <MessageCircle size={28} color="#fff" strokeWidth={1.5} />
      </Pressable>

      {/* Téléphone — ouvre l'app téléphone native (tel:) */}
      <Pressable onPress={handleCall} style={styles.btn} hitSlop={8}>
        <Phone size={25} color="#fff" strokeWidth={1.5} />
      </Pressable>

      {/* Cœur — favori fonctionnel */}
      <Pressable onPress={handleFavorite} style={styles.btn} hitSlop={8}>
        <View ref={heartWrapRef} collapsable={false}>
          <Animated.View style={{ transform: [{ scale }] }}>
            <Heart
              size={28}
              strokeWidth={1.5}
              color={isFavorite ? '#ef4444' : '#fff'}
              fill={isFavorite ? '#ef4444' : 'transparent'}
            />
          </Animated.View>
        </View>
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
