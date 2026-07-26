/**
 * Loader animé SHOMEE — le monogramme « maison » se dessine en boucle (tracé du
 * haut puis du bas), repris de l'asset de marque (shomeeloader.html). Pensé pour
 * s'afficher inline devant une phrase (taille pilotée par `size` = hauteur px).
 *
 * Longueur des deux tracés = 163.96 → DASH 164 : dasharray [164,164] +
 * strokeDashoffset animé de 164 (invisible) → 0 (dessiné) → -164 (effacé).
 * useNativeDriver:false obligatoire (props SVG non gérées par le driver natif).
 */
import { useEffect, useRef } from 'react'
import { Animated, Easing } from 'react-native'
import Svg, { Path } from 'react-native-svg'

const AnimatedPath = Animated.createAnimatedComponent(Path)
const STROKE = '#C17A6F'
const DASH = 164
const VB_W = 120
const VB_H = 150

export function ShomeeLoader({ size = 28 }: { size?: number }) {
  const top = useRef(new Animated.Value(DASH)).current
  const bot = useRef(new Animated.Value(DASH)).current

  useEffect(() => {
    const ease = Easing.inOut(Easing.ease)
    const topAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(top, { toValue: 0, duration: 396, easing: ease, useNativeDriver: false }),
        Animated.delay(704),
        Animated.timing(top, { toValue: -DASH, duration: 396, easing: ease, useNativeDriver: false }),
        Animated.delay(704),
      ]),
      { resetBeforeIteration: true },
    )
    const botAnim = Animated.loop(
      Animated.sequence([
        Animated.delay(396),
        Animated.timing(bot, { toValue: 0, duration: 396, easing: ease, useNativeDriver: false }),
        Animated.delay(704),
        Animated.timing(bot, { toValue: -DASH, duration: 396, easing: ease, useNativeDriver: false }),
        Animated.delay(308),
      ]),
      { resetBeforeIteration: true },
    )
    topAnim.start()
    botAnim.start()
    return () => {
      topAnim.stop()
      botAnim.stop()
    }
  }, [top, bot])

  const w = (size * VB_W) / VB_H
  return (
    <Svg width={w} height={size} viewBox={`0 0 ${VB_W} ${VB_H}`}>
      <AnimatedPath
        d="M12,42 V36 A28,28 0 0 1 40,8 H80 A28,28 0 0 1 108,36 V66"
        fill="none"
        stroke={STROKE}
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${DASH} ${DASH}`}
        strokeDashoffset={top}
      />
      <AnimatedPath
        d="M108,108 V114 A28,28 0 0 1 80,142 H40 A28,28 0 0 1 12,114 V84"
        fill="none"
        stroke={STROKE}
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${DASH} ${DASH}`}
        strokeDashoffset={bot}
      />
    </Svg>
  )
}
