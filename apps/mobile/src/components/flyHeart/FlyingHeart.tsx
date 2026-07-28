import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
  interpolate,
} from 'react-native-reanimated'
import { Heart } from 'lucide-react-native'
import type { XY } from '@/lib/flyHeartStore'

const HEART_SIZE = 34
const DURATION = 700

type Props = {
  from: XY
  to: XY
  onDone: () => void
}

/**
 * Un cœur en vol : bézier quadratique piloté par un unique `t` 0→1 sur le thread
 * UI (worklet). Coordonnées fenêtre (measureInWindow) → indépendant du scroll.
 */
export function FlyingHeart({ from, to, onDone }: Props) {
  const t = useSharedValue(0)

  // Point de contrôle du bézier : arc qui monte et bombe vers l'extérieur.
  const cx = (from.x + to.x) / 2 + (from.x - to.x) * 0.15
  const cy = Math.min(from.y, to.y) - 140

  useEffect(() => {
    t.value = withTiming(
      1,
      { duration: DURATION, easing: Easing.inOut(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(onDone)()
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const style = useAnimatedStyle(() => {
    const p = t.value
    const mt = 1 - p
    // B(p) = (1-p)² P0 + 2(1-p)p C + p² P1
    const x = mt * mt * from.x + 2 * mt * p * cx + p * p * to.x
    const y = mt * mt * from.y + 2 * mt * p * cy + p * p * to.y
    const scale = interpolate(p, [0, 0.15, 0.8, 1], [0.4, 1.15, 0.9, 0.5])
    const opacity = interpolate(p, [0, 0.08, 0.75, 1], [0, 1, 1, 0])
    return {
      transform: [
        { translateX: x - HEART_SIZE / 2 },
        { translateY: y - HEART_SIZE / 2 },
        { scale },
      ],
      opacity,
    }
  })

  return (
    <Animated.View style={[styles.heart, style]} pointerEvents="none">
      <Heart size={HEART_SIZE} color="#ef4444" fill="#ef4444" />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  heart: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: HEART_SIZE,
    height: HEART_SIZE,
  },
})
