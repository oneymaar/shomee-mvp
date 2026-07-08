import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

const SIZE = 58
const STROKE = 5
const R = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * R
const DISC = SIZE - STROKE * 2

const TERRACOTTA = '#A64B27'
const TRACK = 'rgba(166,75,39,0.18)'
const CREAM = '#FDF5F2'

interface Props {
  /** Score de match normalisé 0..1 (source : Property.matchScore). */
  score: number
}

/**
 * Jauge de match animée (parité web MatchBadge) — l'anneau se remplit de 0 au
 * score au montage (ease-out), le pourcentage (score ×100) est au centre sur un
 * disque crème. Rendu uniquement quand un score réel existe (jamais sur le seed) :
 * le montage est décidé par PropertyOverlay.
 */
export function MatchBadge({ score }: Props) {
  const clamped = Math.max(0, Math.min(1, score))
  const progress = useSharedValue(0)

  useEffect(() => {
    progress.value = withTiming(clamped, {
      duration: 1400,
      easing: Easing.out(Easing.cubic),
    })
  }, [clamped, progress])

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }))

  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        {/* Piste */}
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={TRACK}
          strokeWidth={STROKE}
          fill="none"
        />
        {/* Jauge — démarre en haut (rotation -90° autour du centre) */}
        <AnimatedCircle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={TERRACOTTA}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          animatedProps={animatedProps}
          originX={SIZE / 2}
          originY={SIZE / 2}
          rotation={-90}
        />
      </Svg>

      <View style={styles.disc}>
        <Text style={styles.pct}>{Math.round(clamped * 100)}%</Text>
        <Text style={styles.lbl}>MATCH</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    backgroundColor: CREAM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pct: { color: TERRACOTTA, fontWeight: '900', fontSize: 15, lineHeight: 16 },
  lbl: { color: TERRACOTTA, fontWeight: '700', fontSize: 7, letterSpacing: 0.5 },
})
