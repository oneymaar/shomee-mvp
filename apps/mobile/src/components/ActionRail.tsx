import { useEffect, useRef, useState } from 'react'
import { Alert, Animated, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Heart, MessageCircle, Phone, Send } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import type { Property } from '@shomee/core/types/domain'
import { useFlyHeartStore } from '@/lib/flyHeartStore'
import { colors, radii } from '@/lib/theme'

// TODO: numéro de test — remplacer par le téléphone de l'agence (feed live).
// Property n'a pas encore de champ agencyPhone ; quand il existera, il sera
// utilisé en priorité (cf. handleCall) et cette constante deviendra inutile.
const TEST_PHONE = '0670744935'

/** easeOutQuint du référentiel mouvement. Reanimated n'expose pas `quint` :
 *  `poly(5)` EST la quintique (t⁵), `out` la retourne. */
const EASE_OUT_QUINT = Easing.out(Easing.poly(5))

/** Rouge du like — exception assumée à la palette terracotta : c'est la
 *  convention universelle du « j'aime ». Décision d'Olivier (22/08). */
const LIKE_RED = '#EF4444'

function formatPrice(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}

/**
 * Compteur en ROULEMENT vertical : l'ancienne valeur monte et s'efface pendant
 * que la nouvelle arrive du bas. 280 ms, easeOutQuint (référentiel mouvement).
 * Rendu inchangé tant que la valeur ne bouge pas.
 */
function RollingCount({ value }: { value: number }) {
  const [shown, setShown] = useState(value)
  const [incoming, setIncoming] = useState<number | null>(null)
  const p = useSharedValue(0)

  useEffect(() => {
    if (value === shown) return
    setIncoming(value)
    p.value = 0
    p.value = withTiming(1, { duration: 280, easing: EASE_OUT_QUINT }, (finished) => {
      if (finished) runOnJS(setShown)(value)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // `shown` rattrapé → on retire la couche entrante et on remet la piste à zéro.
  useEffect(() => {
    if (incoming != null && shown === incoming) {
      setIncoming(null)
      p.value = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, incoming])

  const outStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -12 * p.value }],
    opacity: 1 - p.value,
  }))
  const inStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: 12 * (1 - p.value) }],
    opacity: p.value,
  }))

  return (
    <View style={styles.countBox} pointerEvents="none">
      <Reanimated.Text style={[styles.count, outStyle]}>{shown}</Reanimated.Text>
      {incoming != null && (
        <Reanimated.Text style={[styles.count, inStyle]}>{incoming}</Reanimated.Text>
      )}
    </View>
  )
}

interface Props {
  property: Property
  isFavorite: boolean
  onToggleFavorite: () => void
}

/**
 * Colonne d'actions à droite du feed.
 * Chaque bouton est une zone tactile isolée (Pressable) → ne déclenche ni le
 * scroll du FlatList ni les gestes vidéo.
 *
 * REFONTE GRAPHIQUE (direction A) : chaque icône est posée dans un cercle de
 * verre fumé de 46 px — les glyphes nus se perdaient sur les vidéos claires.
 * L'animation du like (pression, remplissage rouge, cœur qui s'envole) est
 * CELLE DE L'APP, inchangée ; seul le compteur passe en roulement.
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
      <Pressable onPress={handleMessage} style={styles.item} hitSlop={8}>
        <View style={styles.circle}>
          <MessageCircle size={22} color={colors.creamOnDark} strokeWidth={1.9} />
        </View>
      </Pressable>

      {/* Téléphone — ouvre l'app téléphone native (tel:) */}
      <Pressable onPress={handleCall} style={styles.item} hitSlop={8}>
        <View style={styles.circle}>
          <Phone size={21} color={colors.creamOnDark} strokeWidth={1.9} />
        </View>
      </Pressable>

      {/* Cœur — favori fonctionnel, ROUGE une fois liké */}
      <Pressable onPress={handleFavorite} style={styles.item} hitSlop={8}>
        <View ref={heartWrapRef} collapsable={false}>
          <Animated.View style={[styles.circle, { transform: [{ scale }] }]}>
            <Heart
              size={22}
              strokeWidth={1.9}
              color={isFavorite ? LIKE_RED : colors.creamOnDark}
              fill={isFavorite ? LIKE_RED : 'transparent'}
            />
          </Animated.View>
        </View>
        <RollingCount value={likeCount} />
      </Pressable>

      {/* Partage — natif */}
      <Pressable onPress={handleShare} style={styles.item} hitSlop={8}>
        <View style={styles.circle}>
          <Send size={21} color={colors.creamOnDark} strokeWidth={1.9} />
        </View>
        <RollingCount value={property.shareCount ?? 0} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  // 216 : le bloc d'infos monte désormais jusqu'à ~188 (il a été décollé de la
  // barre de lecture). La colonne reste entièrement au-dessus de lui.
  rail: { position: 'absolute', right: 12, bottom: 216, alignItems: 'center', gap: 18 },
  item: { alignItems: 'center' },
  circle: {
    width: 46,
    height: 46,
    borderRadius: radii.pill,
    backgroundColor: colors.smoke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Piste du compteur : hauteur fixe, les deux chiffres empilés en absolu pour
  // qu'ils se croisent sans pousser la mise en page.
  countBox: { height: 14, width: 34, marginTop: 3, overflow: 'hidden' },
  count: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
})
