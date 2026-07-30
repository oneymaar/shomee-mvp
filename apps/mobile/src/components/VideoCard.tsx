import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { VideoView, type VideoPlayer } from 'expo-video'
import { Image } from 'expo-image'
import type { Property } from '@shomee/core/types/domain'
import { DEFAULT_FALLBACK_IMAGE } from '@shomee/core/constants'
import { normalizeChapters } from '@/lib/chapters'
import { readDuration, safePlayer } from '@/lib/player'

interface Props {
  property: Property
  isActive: boolean
  /** Son coupé — global au feed (feedStore.muted). */
  muted: boolean
  /**
   * Lecteur créé par `FeedItem`. Il vit un cran plus haut depuis que la barre
   * de progression le partage : elle doit se poser PAR-DESSUS l'overlay, donc
   * hors de cette carte, mais piloter le même lecteur.
   */
  player: VideoPlayer
}

/**
 * VideoCard RN (S4b-v2b) — lecture pilotée par la visibilité + hold-pause.
 *
 * Le lecteur est créé par `FeedItem` (`useVideoPlayer`), qui gère son cycle
 * de vie : il est libéré quand la ligne se démonte (recyclage FlatList) →
 * pas de lecteur fantôme jouant en fond.
 *
 * Hold-pause : un `LongPress` (seuil 200 ms) met en pause tant que le doigt
 * reste posé, et reprend au relâché. Le seuil temporel + `maxDistance` font
 * que le swipe vertical (qui bouge tout de suite) annule le geste → le scroll
 * du FlatList n'est jamais bloqué.
 */
export function VideoCard({ property, isActive, muted, player }: Props) {
  const hasVideo = Boolean(property.videoUrl)

  // Mute global synchronisé en continu (le flag vit dans le feedStore).
  useEffect(() => {
    safePlayer(() => {
      player.muted = muted
    })
  }, [muted, player])

  // Seule la carte active joue ; les autres sont en pause et rembobinées à 0
  // (donc une vidéo rejouée repart du début quand on y revient).
  useEffect(() => {
    if (!hasVideo) return
    safePlayer(() => {
      if (isActive) {
        player.play()
      } else {
        player.pause()
        player.currentTime = 0
      }
    })
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
        // `safePlayer` : un geste peut se conclure pendant le recyclage de la
        // ligne, donc après la libération du lecteur par FeedItem.
        .onStart(() => safePlayer(() => player.pause()))
        .onFinalize(() => safePlayer(() => player.play())),
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

  // Chapitres → secondes de début, triés. MÊME normalisation que la barre de
  // progression (`lib/chapters`) : les deux doivent lire la même liste, sinon
  // le segment surligné et le chapitre atteint au tap divergent.
  // Tant que la durée est inconnue (métadonnées non lues), les chapitres en
  // forme `fraction` se colleraient tous entre 0 et 1 s : on n'en sert aucun.
  // On écarte aussi ceux qui tombent au-delà de la durée (donnée abîmée).
  const getChapters = useCallback(() => {
    const dur = readDuration(player)
    if (!(dur > 0)) return []
    return normalizeChapters(property.chapters, dur).filter((c) => c.startSec < dur)
  }, [property.chapters, player])

  const goNextChapter = useCallback(() => {
    const chs = getChapters()
    if (chs.length === 0) return // pas de chapitres → no-op
    safePlayer(() => {
      const t = player.currentTime
      const next = chs.find((c) => c.startSec > t + 0.5)
      if (next) {
        player.currentTime = next.startSec // clamp au dernier : find undefined → rien
        showChapterLabel(next.label)
      }
    })
  }, [getChapters, player, showChapterLabel])

  const goPrevChapter = useCallback(() => {
    const chs = getChapters()
    if (chs.length === 0) return // pas de chapitres → no-op
    safePlayer(() => {
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
    })
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
