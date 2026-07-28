import { useEffect, useRef } from 'react'
import { View, type ColorValue } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { Heart } from 'lucide-react-native'
import { useFlyHeartStore } from '@/lib/flyHeartStore'

type Props = { color: ColorValue }

/**
 * Icône Favoris de la tab bar — glyphe IDENTIQUE à l'actuel (lucide Heart,
 * couleur reçue en prop, taille 24). Seuls ajouts : le <View> mesuré (cible du
 * vol, via measureInWindow à l'onLayout) et le <Animated.View> qui rebondit à
 * l'arrivée (pulseToken du store).
 */
export function FavoritesTabIcon({ color }: Props) {
  const ref = useRef<View>(null)
  const setTarget = useFlyHeartStore((s) => s.setTarget)
  const pulseToken = useFlyHeartStore((s) => s.pulseToken)
  const scale = useSharedValue(1)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulseToken])

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  return (
    <View ref={ref} onLayout={measure} collapsable={false}>
      <Animated.View style={style}>
        <Heart color={color} size={24} />
      </Animated.View>
    </View>
  )
}
