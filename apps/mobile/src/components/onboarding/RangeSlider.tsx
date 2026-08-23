/**
 * RangeSlider — curseur à DEUX poignées (dual-thumb) pour le funnel manuel (S7).
 *
 * React Native n'a pas de slider natif à deux poignées (`@react-native-community/
 * slider` est mono). Implémentation 100 % JS/UI-thread avec `react-native-
 * reanimated` + `react-native-gesture-handler` (déjà au projet, aucun module
 * natif → compatible Expo Go).
 *
 * Contrat générique : opère sur un domaine numérique `[min, max]` avec un `step`.
 * Les échelles NON-LINÉAIRES (surface, budget) passent par un domaine d'INDEX
 * `0..N-1` (voir `lib/scales.ts`) — l'appelant mappe index↔valeur. Les échelles
 * linéaires (pièces, chambres) passent leur valeur directement. Contrôlé :
 * reflète `low`/`high` (via `useAnimatedReaction`, pas de `useEffect` — évite le
 * conflit d'immutabilité du React Compiler avec les shared values), et émet
 * `onChange` en continu pendant le drag.
 */
/* eslint-disable react-hooks/immutability --
 * Les shared values reanimated sont des refs UI-thread, mutées DANS des worklets
 * (gestes + `useAnimatedReaction`) — pas dans un effet/rendu React. La règle
 * d'immutabilité du React Compiler est ici un faux positif : le plugin babel
 * reanimated extrait les worklets AVANT que le compilateur ne les analyse, donc
 * le runtime n'est pas affecté. C'est la seule façon d'animer un dual-thumb à
 * 60 fps sur le thread UI. */
import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'

import { colors } from '@/lib/theme'

const THUMB = 26
const TRACK_H = 5
const ACCENT = colors.terracotta
// Piste SABLE plutôt qu'un noir transparent : sur le crème, un gris translucide
// vire au sale — le sable de la palette reste chaud.
const TRACK_BG = colors.sand
const HIT_SLOP = { top: 14, bottom: 14, left: 10, right: 10 }

export interface RangeSliderProps {
  min: number
  max: number
  step?: number
  low: number
  high: number
  onChange: (low: number, high: number) => void
  accent?: string
  /** Écart minimal (en unités de domaine) imposé entre les deux poignées. */
  minGap?: number
}

export function RangeSlider({
  min,
  max,
  step = 1,
  low,
  high,
  onChange,
  accent = ACCENT,
  minGap = 0,
}: RangeSliderProps) {
  const [width, setWidth] = useState(0)
  const usable = Math.max(0, width - THUMB) // course utile (translation du bord de poignée)
  const span = max - min

  const lowX = useSharedValue(0)
  const highX = useSharedValue(0)
  const lowStart = useSharedValue(0)
  const highStart = useSharedValue(0)
  const dragging = useSharedValue(false)

  // Synchronise les poignées depuis les props QUAND on ne drague pas (layout
  // initial + maj programmatiques, ex. coupling pièces→chambres). Réaction
  // reanimated (worklet UI-thread) plutôt qu'un useEffect : les shared values ne
  // sont jamais mutées dans un effet React (règle d'immutabilité React Compiler).
  useAnimatedReaction(
    () => ({ low, high, usable, span, min }),
    (cur) => {
      if (cur.usable <= 0 || cur.span <= 0 || dragging.value) return
      lowX.value = ((cur.low - cur.min) / cur.span) * cur.usable
      highX.value = ((cur.high - cur.min) / cur.span) * cur.usable
    },
    [low, high, usable, span, min],
  )

  // px → valeur snappée sur le pas, bornée à [min, max]. Émis vers le parent.
  const commit = useCallback(
    (lx: number, hx: number) => {
      if (usable <= 0 || span <= 0) return
      const snap = (px: number) => {
        const raw = min + (px / usable) * span
        return Math.min(max, Math.max(min, Math.round(raw / step) * step))
      }
      onChange(snap(lx), snap(hx))
    },
    [usable, span, min, max, step, onChange],
  )

  const gapPx = usable > 0 && span > 0 ? (minGap / span) * usable : 0

  const lowPan = Gesture.Pan()
    .hitSlop(HIT_SLOP)
    .onBegin(() => {
      dragging.value = true
      lowStart.value = lowX.value
    })
    .onUpdate((e) => {
      let next = lowStart.value + e.translationX
      const upper = highX.value - gapPx
      if (next < 0) next = 0
      if (next > upper) next = upper
      lowX.value = next
      runOnJS(commit)(next, highX.value)
    })
    .onFinalize(() => {
      dragging.value = false
    })

  const highPan = Gesture.Pan()
    .hitSlop(HIT_SLOP)
    .onBegin(() => {
      dragging.value = true
      highStart.value = highX.value
    })
    .onUpdate((e) => {
      let next = highStart.value + e.translationX
      const lower = lowX.value + gapPx
      if (next > usable) next = usable
      if (next < lower) next = lower
      highX.value = next
      runOnJS(commit)(lowX.value, next)
    })
    .onFinalize(() => {
      dragging.value = false
    })

  const lowThumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lowX.value }] }))
  const highThumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: highX.value }] }))
  const fillStyle = useAnimatedStyle(() => ({
    left: lowX.value + THUMB / 2,
    width: Math.max(0, highX.value - lowX.value),
  }))

  return (
    <View style={styles.container} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {/* Rail inactif */}
      <View style={[styles.rail, { backgroundColor: TRACK_BG }]} />
      {/* Remplissage actif entre les deux poignées */}
      <Animated.View style={[styles.fill, { backgroundColor: accent }, fillStyle]} />
      {/* Poignée min */}
      <GestureDetector gesture={lowPan}>
        <Animated.View style={[styles.thumb, { borderColor: accent }, lowThumbStyle]} />
      </GestureDetector>
      {/* Poignée max */}
      <GestureDetector gesture={highPan}>
        <Animated.View style={[styles.thumb, { borderColor: accent }, highThumbStyle]} />
      </GestureDetector>
    </View>
  )
}

const TRACK_TOP = (THUMB - TRACK_H) / 2

const styles = StyleSheet.create({
  container: { height: THUMB, justifyContent: 'center' },
  rail: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    top: TRACK_TOP,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
  },
  fill: {
    position: 'absolute',
    top: TRACK_TOP,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#fff',
    borderWidth: 2.5,
    shadowColor: colors.ink,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
})
