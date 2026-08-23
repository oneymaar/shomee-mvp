/* eslint-disable react-hooks/immutability --
 * Les shared values reanimated sont des refs UI-thread, mutées DANS des worklets
 * (gestes) ou depuis l'écouteur `timeUpdate` du lecteur. Même faux positif du
 * React Compiler que dans `RangeSlider.tsx` : le plugin babel reanimated extrait
 * les worklets avant l'analyse du compilateur. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import type { VideoPlayer } from 'expo-video'
import { chapterAt, chapterSegments, formatClock, normalizeChapters } from '@/lib/chapters'
import { readDuration, safePlayer } from '@/lib/player'

const TRACK_IDLE = 3.5
const TRACK_ACTIVE = 6
const ZONE_H = 24 // zone tactile, au ras du bas de la carte
const RAIL = 8 // hauteur sous la piste
const GAP = 3 // écart entre segments (parité VideoProgressBar web)
const THUMB = 14
/** Tolérance autour de la position visée après un seek, en secondes. */
const SEEK_SETTLED = 0.35

interface Props {
  /** Lecteur possédé par `FeedItem` — partagé avec la `VideoCard`. */
  player: VideoPlayer
  /** `property.chapters` brut : les deux formes sont tolérées. */
  chapters?: unknown
  /** Remonte l'état de scrub pour estomper l'habillage du feed. */
  onScrubbingChange?: (scrubbing: boolean) => void
}

/**
 * Barre de progression du feed (parité `apps/web/components/VideoProgressBar`).
 *
 * - **Segmentée** quand le bien porte au moins deux chapitres, continue sinon :
 *   un segment = un chapitre, largeur proportionnelle à sa durée.
 * - **Peinte sur le thread UI** : `progress` est une shared value ; la lecture
 *   n'émet que 5 événements/s (`timeUpdateEventInterval = 0.2`) et l'animation
 *   linéaire de 260 ms comble l'intervalle. Aucun re-render pendant la lecture.
 * - **Navigable au doigt** : le pan n'accroche qu'à partir de 4 px horizontaux
 *   et abandonne au-delà de 16 px verticaux, pour que le balayage vertical du
 *   feed parte toujours à la `FlatList` même s'il démarre sur la barre.
 *
 * Posée en absolu par-dessus l'overlay : c'est le dernier enfant de `FeedItem`,
 * sinon le dégradé bas du `PropertyOverlay` la recouvrirait.
 */
export function VideoProgressBar({ player, chapters, onScrubbingChange }: Props) {
  const [width, setWidth] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hint, setHint] = useState<{ label: string | null; time: string } | null>(null)

  const progress = useSharedValue(0)
  const active = useSharedValue(0)
  // Largeur mesurée de la pastille — sert à la centrer sur le curseur puis à
  // la borner aux deux bords de l'écran.
  const hintW = useSharedValue(0)

  const scrubbingRef = useRef(false)
  const lastHintSecRef = useRef(-1)
  // Position visée par le dernier seek. `player.currentTime` est asynchrone :
  // sans ce garde-fou, le `timeUpdate` qui suit rapporte encore l'ANCIENNE
  // position et la barre balaie l'écran avant de resauter au bon endroit.
  const seekTargetRef = useRef<number | null>(null)

  const chapterList = useMemo(() => normalizeChapters(chapters, duration), [chapters, duration])

  const segments = useMemo(() => {
    const segs = chapterSegments(chapterList, duration)
    // Un seul chapitre ne dit rien de plus qu'une barre continue.
    return segs.length >= 2 ? segs : [{ label: '', start: 0, end: 1 }]
  }, [chapterList, duration])

  /* ── Durée ──────────────────────────────────────────────────────────────── */
  // `sourceLoad` la donne dès les métadonnées lues — donc AVANT la lecture, et
  // même sur les cartes montées en avance (windowSize 3) qui ne jouent pas
  // encore : la barre naît déjà segmentée au lieu de se découper en cours de
  // route. `statusChange` sert de repli si l'événement est manqué.
  useEffect(() => {
    const apply = (d: number) => {
      if (d > 0) setDuration((prev) => (prev === d ? prev : d))
    }
    apply(readDuration(player))
    const onLoad = player.addListener('sourceLoad', (e) => apply(e.duration))
    const onStatus = player.addListener('statusChange', () => apply(readDuration(player)))
    return () => {
      safePlayer(() => {
        onLoad.remove()
        onStatus.remove()
      })
    }
  }, [player])

  /* ── Lecture → peinture ─────────────────────────────────────────────────── */
  useEffect(() => {
    safePlayer(() => {
      player.timeUpdateEventInterval = 0.2
    })
    const sub = player.addListener('timeUpdate', (e) => {
      const dur = readDuration(player)
      if (dur > 0) setDuration((prev) => (prev === dur ? prev : dur))
      if (dur <= 0) return
      // Un seek vient d'être demandé : on ignore les positions périmées.
      const target = seekTargetRef.current
      if (target != null) {
        if (Math.abs(e.currentTime - target) > SEEK_SETTLED) return
        seekTargetRef.current = null
      }
      if (scrubbingRef.current) return
      const f = Math.min(1, Math.max(0, e.currentTime / dur))
      // Retour en arrière (boucle, seek chapitre) : on saute, on n'anime pas —
      // sinon la barre balaie l'écran à l'envers à chaque bouclage.
      if (f < progress.value - 0.02) progress.value = f
      else progress.value = withTiming(f, { duration: 260, easing: Easing.linear })
    })
    return () => {
      safePlayer(() => {
        sub.remove()
        player.timeUpdateEventInterval = 0
      })
    }
  }, [player, progress])

  /* ── Scrub ──────────────────────────────────────────────────────────────── */
  const setScrubbing = useCallback(
    (on: boolean) => {
      scrubbingRef.current = on
      onScrubbingChange?.(on)
      if (!on) {
        setHint(null)
        lastHintSecRef.current = -1
      }
    },
    [onScrubbingChange],
  )

  // Rafraîchi seulement quand la seconde affichée change : le pan émet à 60 Hz,
  // le re-render React reste à quelques images par glissement.
  const updateHint = useCallback(
    (f: number) => {
      const dur = readDuration(player)
      if (dur <= 0) return
      const t = f * dur
      const sec = Math.floor(t)
      if (sec === lastHintSecRef.current) return
      lastHintSecRef.current = sec
      setHint({ label: chapterAt(chapterList, t), time: formatClock(t) })
    },
    [chapterList, player],
  )

  const seekTo = useCallback(
    (f: number) => {
      const dur = readDuration(player)
      if (dur <= 0) return
      const t = Math.min(dur - 0.05, Math.max(0, f * dur))
      seekTargetRef.current = t
      safePlayer(() => {
        player.currentTime = t
      })
    },
    [player],
  )

  /* ── Géométrie ──────────────────────────────────────────────────────────── */
  // Les gouttières sont prélevées DANS chaque segment (marge à gauche) et non
  // par un `gap` sur la piste : sinon la largeur utile diminuerait de 3 px par
  // gouttière et le pouce (posé à `progress × width`) dériverait de la frontière
  // de remplissage — jusqu'à 12 px sur cinq chapitres.
  const segBoxes = useMemo(
    () =>
      segments.map((s, i) => ({
        ...s,
        // Repli sur `flex` tant que la largeur n'est pas mesurée (1re frame).
        px: width > 0 ? Math.max(1, (s.end - s.start) * width - (i > 0 ? GAP : 0)) : null,
        gap: i > 0 ? GAP : 0,
      })),
    [segments, width],
  )

  const gesture = useMemo(() => {
    // Le calcul est inliné dans chaque callback : un worklet ne peut pas appeler
    // une fonction JS ordinaire capturée par fermeture (elle tournerait sur le
    // thread UI sans avoir été « workletisée » → exception au premier geste).
    const pan = Gesture.Pan()
      // Le pan n'accroche qu'à partir de 4 px horizontaux et abandonne au-delà
      // de 16 px verticaux : un balayage du feed qui démarre sur la barre part
      // toujours à la FlatList.
      .activeOffsetX([-4, 4])
      .failOffsetY([-16, 16])
      .onStart((e) => {
        const f = width > 0 ? Math.min(1, Math.max(0, e.x / width)) : 0
        active.value = 1
        progress.value = f
        runOnJS(setScrubbing)(true)
        runOnJS(updateHint)(f)
      })
      .onUpdate((e) => {
        const f = width > 0 ? Math.min(1, Math.max(0, e.x / width)) : 0
        progress.value = f
        runOnJS(updateHint)(f)
      })
      .onEnd((e) => {
        const f = width > 0 ? Math.min(1, Math.max(0, e.x / width)) : 0
        progress.value = f
        runOnJS(seekTo)(f)
      })
      .onFinalize(() => {
        active.value = 0
        runOnJS(setScrubbing)(false)
      })
    const tap = Gesture.Tap()
      .maxDuration(260)
      .onEnd((e) => {
        const f = width > 0 ? Math.min(1, Math.max(0, e.x / width)) : 0
        progress.value = f
        runOnJS(seekTo)(f)
      })
    return Gesture.Race(pan, tap)
  }, [width, active, progress, setScrubbing, updateHint, seekTo])

  /* ── Styles animés ──────────────────────────────────────────────────────── */
  const trackStyle = useAnimatedStyle(() => ({
    height: withTiming(active.value ? TRACK_ACTIVE : TRACK_IDLE, { duration: 140 }),
  }))
  // La pastille suit le curseur : posée au milieu de l'écran, elle ne dirait
  // pas de quel point de la barre elle parle. Bornée à 8 px des bords.
  const hintStyle = useAnimatedStyle(() => {
    const w = hintW.value
    const max = Math.max(8, width - w - 8)
    return {
      opacity: w > 0 ? 1 : 0,
      transform: [{ translateX: Math.min(max, Math.max(8, progress.value * width - w / 2)) }],
    }
  })
  const thumbStyle = useAnimatedStyle(() => ({
    opacity: withTiming(active.value ? 1 : 0, { duration: 120 }),
    transform: [
      { translateX: progress.value * width },
      { scale: withTiming(active.value ? 1 : 0.3, { duration: 120 }) },
    ],
  }))

  return (
    <>
      {/* Pastille du chapitre survolé — SŒUR de la zone tactile : posée dans
          celle-ci, elle en déborderait vers le haut et Android la rognerait. */}
      {hint != null && (
        <Animated.View
          style={[styles.hint, hintStyle]}
          pointerEvents="none"
          onLayout={(e) => {
            hintW.value = e.nativeEvent.layout.width
          }}
        >
          <Text style={styles.hintTxt} numberOfLines={1}>
            {hint.label ? `${hint.label} · ` : ''}
            <Text style={styles.hintTime}>{hint.time}</Text>
          </Text>
        </Animated.View>
      )}
      <GestureDetector gesture={gesture}>
        <View
          style={styles.zone}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          collapsable={false}
        >
          <Animated.View style={[styles.track, trackStyle]}>
            {segBoxes.map((s, i) => (
              <Segment
                key={`${i}-${s.start}`}
                start={s.start}
                end={s.end}
                width={s.px}
                gap={s.gap}
                progress={progress}
              />
            ))}
          </Animated.View>

          <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
        </View>
      </GestureDetector>
    </>
  )
}

/** Un segment = un chapitre. `scaleX` (thread UI) plutôt qu'une largeur animée :
 *  aucun calcul de layout à 60 fps. Le coin gauche est arrondi par le parent
 *  (`overflow: hidden`), exactement comme la version web. */
function Segment({
  start,
  end,
  width,
  gap,
  progress,
}: {
  start: number
  end: number
  width: number | null
  gap: number
  progress: SharedValue<number>
}) {
  const fill = useAnimatedStyle(() => {
    const span = end - start
    const w = span <= 0 ? 0 : Math.min(1, Math.max(0, (progress.value - start) / span))
    return { transform: [{ scaleX: w }] }
  })
  return (
    <View
      style={[
        styles.seg,
        { marginLeft: gap },
        width != null ? { width } : { flex: end - start },
      ]}
    >
      <Animated.View style={[styles.fill, fill]} />
    </View>
  )
}

const styles = StyleSheet.create({
  zone: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: ZONE_H,
    justifyContent: 'flex-end',
    paddingBottom: RAIL,
  },
  track: { flexDirection: 'row' },
  seg: {
    height: '100%',
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#fff',
    transformOrigin: '0% 50%',
  },
  thumb: {
    position: 'absolute',
    left: -THUMB / 2,
    bottom: RAIL + TRACK_ACTIVE / 2 - THUMB / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  hint: {
    position: 'absolute',
    // Au ras du curseur (dont le sommet est à 18 px) plutôt qu'en l'air.
    bottom: 22,
    left: 0,
    maxWidth: '80%',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  hintTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  hintTime: { color: '#E8D9CB', fontWeight: '500' },
})
