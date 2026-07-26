/**
 * Loader animé SHOMEE — le monogramme « maison » se dessine en boucle (tracé du
 * haut, puis tracé du bas). Réplique EXACTE de l'asset de marque
 * `shomeeloader.html` : mêmes `d`, même cycle (2,2 s), mêmes keyframes, et
 * l'easing `ease-in-out` de CSS appliqué SEGMENT PAR SEGMENT (c'est ainsi que
 * CSS interpole entre deux keyframes, pas sur la timeline entière).
 *
 * POINT CLÉ — une seule horloge. La version précédente lançait DEUX
 * `Animated.loop` indépendantes (4 sous-animations pour le haut, 5 pour le bas).
 * Chaque itération de boucle paie un coût de relance côté thread JS : le tracé
 * du bas, qui en compte une de plus, dérivait un peu plus à chaque cycle — d'où
 * une animation correcte au démarrage puis qui « tourne différemment » quelques
 * secondes plus tard. Ici les deux tracés lisent la MÊME `Animated.Value`
 * (0 → 1, linéaire, 2,2 s) : ils sont verrouillés en phase par construction,
 * quel que soit l'état du thread JS.
 *
 * Le HTML pilote les offsets via `pathLength="100"`, que react-native-svg ne
 * supporte pas : on remet donc les keyframes à l'échelle réelle des tracés
 * (longueur mesurée = 163,96 → DASH 164).
 * `useNativeDriver:false` obligatoire (props SVG hors driver natif).
 */
import { memo, useEffect, useMemo, useRef } from 'react'
import { Animated, Easing } from 'react-native'
import Svg, { Path } from 'react-native-svg'

const AnimatedPath = Animated.createAnimatedComponent(Path)

const STROKE = '#C17A6F'
const DASH = 164
const VB_W = 120
const VB_H = 150
const CYCLE = 2200

const D_TOP = 'M12,42 V36 A28,28 0 0 1 40,8 H80 A28,28 0 0 1 108,36 V66'
const D_BOT = 'M108,108 V114 A28,28 0 0 1 80,142 H40 A28,28 0 0 1 12,114 V84'

/** `ease-in-out` CSS = cubic-bezier(.42, 0, .58, 1). */
const EASE = Easing.bezier(0.42, 0, 0.58, 1)
/** Sous-échantillonnage de l'easing dans chaque segment animé (interpolate
 *  n'interpole que LINÉAIREMENT entre deux points : on approche la courbe). */
const SAMPLES = 12

/** [progression 0..1 du cycle, stroke-dashoffset en unités pathLength=100]. */
type Stop = readonly [number, number]

const TOP_STOPS: readonly Stop[] = [
  [0, 100],
  [0.18, 0],
  [0.5, 0],
  [0.68, -100],
  [1, -100],
]
const BOT_STOPS: readonly Stop[] = [
  [0, 100],
  [0.18, 100],
  [0.36, 0],
  [0.68, 0],
  [0.86, -100],
  [1, -100],
]

/** Keyframes CSS → paires (inputRange, outputRange) pour `interpolate`, avec
 *  l'easing échantillonné sur les segments animés et deux points suffisants sur
 *  les paliers. `inputRange` doit rester strictement croissant. */
function toRange(stops: readonly Stop[]): { inputRange: number[]; outputRange: number[] } {
  const inputRange: number[] = []
  const outputRange: number[] = []
  const push = (x: number, y: number) => {
    const n = inputRange.length
    if (n > 0 && x <= inputRange[n - 1] + 1e-6) {
      outputRange[n - 1] = y // même abscisse (jonction de deux segments)
      return
    }
    inputRange.push(x)
    outputRange.push(y)
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, v0] = stops[i]
    const [t1, v1] = stops[i + 1]
    const from = (v0 / 100) * DASH
    const to = (v1 / 100) * DASH
    if (from === to) {
      push(t0, from)
      push(t1, to)
      continue
    }
    for (let s = 0; s <= SAMPLES; s++) {
      const f = s / SAMPLES
      push(t0 + (t1 - t0) * f, from + (to - from) * EASE(f))
    }
  }
  return { inputRange, outputRange }
}

export const ShomeeLoader = memo(function ShomeeLoader({ size = 28 }: { size?: number }) {
  const clock = useRef(new Animated.Value(0)).current

  // Interpolations mémoïsées : le parent re-rend à chaque changement d'étape,
  // on ne veut pas ré-attacher de nouveaux nœuds animés aux paths à chaque fois.
  const topOffset = useMemo(
    () => clock.interpolate({ ...toRange(TOP_STOPS), extrapolate: 'clamp' }),
    [clock],
  )
  const botOffset = useMemo(
    () => clock.interpolate({ ...toRange(BOT_STOPS), extrapolate: 'clamp' }),
    [clock],
  )

  useEffect(() => {
    clock.setValue(0)
    const anim = Animated.loop(
      Animated.timing(clock, {
        toValue: 1,
        duration: CYCLE,
        easing: Easing.linear, // l'easing vit dans les keyframes, pas ici
        useNativeDriver: false,
        isInteraction: false,
      }),
    )
    anim.start()
    return () => {
      anim.stop()
    }
  }, [clock])

  const w = (size * VB_W) / VB_H
  return (
    <Svg width={w} height={size} viewBox={`0 0 ${VB_W} ${VB_H}`}>
      <AnimatedPath
        d={D_TOP}
        fill="none"
        stroke={STROKE}
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${DASH} ${DASH}`}
        strokeDashoffset={topOffset}
      />
      <AnimatedPath
        d={D_BOT}
        fill="none"
        stroke={STROKE}
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${DASH} ${DASH}`}
        strokeDashoffset={botOffset}
      />
    </Svg>
  )
})
