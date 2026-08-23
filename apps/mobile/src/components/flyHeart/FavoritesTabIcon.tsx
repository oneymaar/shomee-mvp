import { useEffect, useRef } from 'react'
import { StyleSheet, View, type ColorValue } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { Heart } from 'lucide-react-native'
import { useFlyHeartStore } from '@/lib/flyHeartStore'

type Props = { color: ColorValue }

/** Rouge du like — même valeur que le cœur du rail et le cœur volant. */
const LIKE_RED = '#EF4444'

/**
 * Icône Favoris de la tab bar — glyphe IDENTIQUE à l'actuel (lucide Heart,
 * couleur reçue en prop, taille 24). Trois rôles :
 *  - le <View> mesuré (cible du vol, via measureInWindow à l'onLayout) ;
 *  - le <Animated.View> qui REBONDIT à l'arrivée du cœur (pulseToken du store) ;
 *  - le cœur rouge superposé qui S'ALLUME à l'arrivée puis s'éteint en fondu
 *    (ajout validé par Olivier le 23/08 : « la colorisation de l'icône favori
 *    au moment où il est atteint par le petit cœur like »).
 *
 * La colorisation est un CALQUE, pas un changement de la couleur reçue : la
 * tab bar reste seule maîtresse de son actif/inactif, et l'allumage se retire
 * sans laisser de trace.
 */
export function FavoritesTabIcon({ color }: Props) {
  const ref = useRef<View>(null)
  const setTarget = useFlyHeartStore((s) => s.setTarget)
  const pulseToken = useFlyHeartStore((s) => s.pulseToken)
  const scale = useSharedValue(1)
  const lit = useSharedValue(0)

  const measure = () => {
    requestAnimationFrame(() => {
      ref.current?.measureInWindow((x, y, w, h) => {
        if (w && h) setTarget({ x: x + w / 2, y: y + h / 2 })
      })
    })
  }

  useEffect(() => {
    if (pulseToken === 0) return
    // Pulse court et BORNÉ : 2 rebonds max (up → down → petit up → settle),
    // ~430ms. Remplace le spring sous-amorti qui oscillait trop longtemps.
    scale.value = withSequence(
      withTiming(1.35, { duration: 130 }),
      withTiming(0.96, { duration: 100 }),
      withTiming(1.12, { duration: 90 }),
      withTiming(1, { duration: 110 }),
    )
    // Allumage rouge : franc à l'impact (120 ms), tenu ~1 s, puis extinction
    // douce (320 ms) — assez long pour être vu, assez court pour ne pas mentir
    // sur l'état réel de l'onglet.
    lit.value = withSequence(
      withTiming(1, { duration: 120 }),
      withDelay(950, withTiming(0, { duration: 320 })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulseToken])

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const redStyle = useAnimatedStyle(() => ({ opacity: lit.value }))

  return (
    <View ref={ref} onLayout={measure} collapsable={false}>
      <Animated.View style={style}>
        <Heart color={color} size={24} />
        {/* Calque d'allumage — rempli, posé pile sur le glyphe, invisible au repos. */}
        <Animated.View style={[StyleSheet.absoluteFill, redStyle]} pointerEvents="none">
          <Heart color={LIKE_RED} fill={LIKE_RED} size={24} />
        </Animated.View>
      </Animated.View>
    </View>
  )
}
