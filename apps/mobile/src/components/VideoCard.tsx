import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useVideoPlayer, VideoView } from 'expo-video'
import { Image } from 'expo-image'
import type { Property } from '@shomee/core/types/domain'
import { DEFAULT_FALLBACK_IMAGE } from '@shomee/core/constants'

interface Props {
  property: Property
  isActive: boolean
  /** Son coupé — global au feed (feedStore.muted). */
  muted: boolean
}

/**
 * VideoCard RN (S4b-v2b) — lecture pilotée par la visibilité + hold-pause.
 * (Chapitres, progress, detail sheet → suite v2b.)
 *
 * `useVideoPlayer` gère le cycle de vie : le player est libéré quand la carte
 * se démonte (recyclage FlatList) → pas de lecteur fantôme jouant en fond.
 *
 * Hold-pause : un `LongPress` (seuil 200 ms) met en pause tant que le doigt
 * reste posé, et reprend au relâché. Le seuil temporel + `maxDistance` font
 * que le swipe vertical (qui bouge tout de suite) annule le geste → le scroll
 * du FlatList n'est jamais bloqué.
 */
export function VideoCard({ property, isActive, muted }: Props) {
  const hasVideo = Boolean(property.videoUrl)

  const player = useVideoPlayer(property.videoUrl ?? '', (p) => {
    p.loop = true
    p.muted = muted
  })

  // Mute global synchronisé en continu (le flag vit dans le feedStore).
  useEffect(() => {
    player.muted = muted
  }, [muted, player])

  // Seule la carte active joue ; les autres sont en pause et rembobinées à 0
  // (donc une vidéo rejouée repart du début quand on y revient).
  useEffect(() => {
    if (!hasVideo) return
    if (isActive) {
      player.play()
    } else {
      player.pause()
      player.currentTime = 0
    }
  }, [isActive, hasVideo, player])

  // Hold-pause : pause à l'ACTIVATION du long-press (après 200 ms d'immobilité),
  // reprise au relâché. `runOnJS(true)` car player.pause()/play() sont des appels
  // JS (les callbacks du geste tournent sinon sur le thread UI). onFinalize rejoue
  // inconditionnellement : indépendant de la logique isActive, qu'on ne touche pas.
  const holdPause = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(200)
        .maxDistance(10)
        .runOnJS(true)
        .onStart(() => player.pause())
        .onFinalize(() => player.play()),
    [player],
  )

  // ─── Nav chapitres au tap (S6b) ────────────────────────────────────────────
  // Parité web (VideoCard.handleTap) : tap droite → chapitre suivant, tap gauche
  // → précédent (ou redémarrage du chapitre courant si on est à +1,5 s dedans).
  // Le seed / feed générique n'a pas de `chapters` → no-op (aucun seek).
  const { width } = useWindowDimensions()

  // Label transitoire — un nouvel objet à chaque nav (même libellé rejoué → une
  // nouvelle ref déclenche le re-render et relance le minuteur). Auto-effacé
  // après 1,7 s par un effet clavé dessus (pas de ref).
  const [chapterLabel, setChapterLabel] = useState<{ text: string } | null>(null)
  const showChapterLabel = useCallback((label: string) => {
    setChapterLabel({ text: label })
  }, [])
  useEffect(() => {
    if (!chapterLabel) return
    const id = setTimeout(() => setChapterLabel(null), 1700)
    return () => clearTimeout(id)
  }, [chapterLabel])

  // Chapitres → secondes de début, triés. Gère les DEUX formes tolérées :
  // `startSec` (feed live) OU `fraction` 0..1 × durée (legacy).
  const getChapters = useCallback((): { label: string; startSec: number }[] => {
    const raw = property.chapters as
      | { label: string; startSec?: number; fraction?: number }[]
      | undefined
    if (!raw || raw.length === 0) return []
    const dur = player.duration || 0
    return raw
      .map((c) => ({
        label: c.label,
        startSec:
          typeof c.startSec === 'number'
            ? c.startSec
            : typeof c.fraction === 'number'
              ? c.fraction * (dur || 1)
              : 0,
      }))
      .sort((a, b) => a.startSec - b.startSec)
  }, [property.chapters, player])

  const goNextChapter = useCallback(() => {
    const chs = getChapters()
    if (chs.length === 0) return // pas de chapitres → no-op
    const t = player.currentTime
    const next = chs.find((c) => c.startSec > t + 0.5)
    if (next) {
      player.currentTime = next.startSec // clamp au dernier : find undefined → rien
      showChapterLabel(next.label)
    }
  }, [getChapters, player, showChapterLabel])

  const goPrevChapter = useCallback(() => {
    const chs = getChapters()
    if (chs.length === 0) return // pas de chapitres → no-op
    const t = player.currentTime
    let curIdx = 0
    for (let i = 0; i < chs.length; i++) {
      if (chs[i].startSec <= t) curIdx = i
    }
    const inChapterFor = t - chs[curIdx].startSec
    let target: { label: string; startSec: number } | null = null
    if (inChapterFor > 1.5) target = chs[curIdx] // +1,5 s dans le chapitre → restart
    else if (curIdx > 0) target = chs[curIdx - 1] // sinon précédent (clamp au 1er)
    if (target) {
      player.currentTime = target.startSec
      showChapterLabel(target.label)
    }
  }, [getChapters, player, showChapterLabel])

  const tapChapter = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(250)
        .runOnJS(true)
        .onEnd((e) => {
          if (e.x < width / 2) goPrevChapter()
          else goNextChapter()
        }),
    [width, goPrevChapter, goNextChapter],
  )

  // Composition des gestes de la carte. `Gesture.Race` = le premier geste qui
  // s'active gagne. Le tap rapide (≤250 ms) résout la nav chapitres AVANT le
  // seuil 200 ms du hold-pause ; un appui maintenu active le hold (pause,
  // inchangé). Le swipe vertical dépasse le slop du tap → il échoue et le scroll
  // du FlatList passe. `tapChapter` en 1er argument (priorité), hold-pause après.
  const cardGesture = useMemo(
    () => Gesture.Race(tapChapter, holdPause),
    [tapChapter, holdPause],
  )

  return (
    <GestureDetector gesture={cardGesture}>
      <View style={styles.container}>
        {/* Poster de fallback SOUS la vidéo (couche de base) — visible le temps que
            la vidéo charge / pour les cartes sans vidéo. */}
        <Image
          source={{ uri: property.imageUrlFallback || DEFAULT_FALLBACK_IMAGE }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
        />
        {hasVideo && (
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={false}
          />
        )}
        {/* Label de chapitre transitoire (~1,7 s) après une nav au tap. Autonome,
            pointerEvents="none" pour ne pas intercepter les gestes. */}
        {chapterLabel != null && (
          <View style={styles.chapterLabelWrap} pointerEvents="none">
            <Text style={styles.chapterLabel} numberOfLines={2}>
              {chapterLabel.text}
            </Text>
          </View>
        )}
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  chapterLabelWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chapterLabel: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: 24,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
})
