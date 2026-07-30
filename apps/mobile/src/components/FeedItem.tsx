import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useVideoPlayer } from 'expo-video'
import { Eye } from 'lucide-react-native'
import type { Property } from '@shomee/core/types/domain'
import { useShomeeStore } from '@/lib/stores'
import { VideoCard } from './VideoCard'
import { PropertyOverlay } from './PropertyOverlay'
import { ActionRail } from './ActionRail'
import { VideoProgressBar } from './VideoProgressBar'

interface Props {
  property: Property
  isActive: boolean
  muted: boolean
  height: number
  /** Ouvre le PropertyDetailSheet pour ce bien (« Voir l'annonce »). */
  onOpenDetail?: (property: Property) => void
  /**
   * Bien déjà vu lors d'une session ANTÉRIEURE (journal persistant, lot 1).
   * Rend la pastille « Déjà vu » — et rien d'autre : la carte reste en tous
   * points identique, c'est un marqueur, pas un déclassement.
   */
  alreadySeen?: boolean
}

/**
 * Une carte plein écran du feed : vidéo (fond) + overlay (infos) + action rail
 * + barre de progression.
 *
 * LE LECTEUR EST POSSÉDÉ ICI. `VideoCard` (lecture, gestes) et
 * `VideoProgressBar` (peinture, scrub) pilotent LE MÊME lecteur : la barre doit
 * se poser par-dessus l'overlay, donc hors de la carte — le lecteur vit au seul
 * niveau qui englobe les deux. `useVideoPlayer` le libère au démontage de la
 * ligne (recyclage FlatList) → pas de lecteur fantôme jouant en fond ; les
 * accès tardifs (gestes conclus pendant le recyclage) sont absorbés par
 * `safePlayer` côté consommateurs.
 *
 * Pendant un scrub, l'habillage (overlay + rail + pastille) s'estompe et ne
 * capte plus les gestes : le doigt est sur la barre, l'écran appartient à la
 * vidéo.
 *
 * S'abonne à son propre statut favori pour n'isoler le re-render qu'à cette
 * carte.
 */
export function FeedItem({ property, isActive, muted, height, onOpenDetail, alreadySeen }: Props) {
  const insets = useSafeAreaInsets()
  const isFavorite = useShomeeStore((s) => s.favorites.some((f) => f.id === property.id))
  const toggleFavorite = useShomeeStore((s) => s.toggleFavorite)
  const [scrubbing, setScrubbing] = useState(false)

  const player = useVideoPlayer(property.videoUrl ?? '', (p) => {
    p.loop = true
    p.muted = muted
  })

  return (
    <View style={{ height }}>
      <VideoCard property={property} isActive={isActive} muted={muted} player={player} />
      {/* L'habillage, groupé pour s'estomper d'un bloc pendant le scrub.
          `box-none` : les gestes passent à la vidéo SAUF sur les éléments
          interactifs ; `none` pendant le scrub — un habillage à 25 % d'opacité
          qui capterait encore les taps serait un piège. */}
      <View
        style={[StyleSheet.absoluteFill, scrubbing && styles.dimmed]}
        pointerEvents={scrubbing ? 'none' : 'box-none'}
      >
        <PropertyOverlay property={property} onMore={() => onOpenDetail?.(property)} />
        <ActionRail
          property={property}
          isFavorite={isFavorite}
          onToggleFavorite={() => toggleFavorite(property)}
        />
        {/* Pastille « Déjà vu » — même famille visuelle que les chips d'overlay
            (verre fumé, texte blanc). SOUS la rangée agence (36px à insets+12),
            à gauche ; le mute est à droite. Sans date : « déjà vu » suffit.
            pointerEvents none — un marqueur ne se touche pas. */}
        {alreadySeen && (
          <View style={[styles.seen, { top: insets.top + 58 }]} pointerEvents="none">
            <Eye size={12} color="rgba(255,255,255,0.92)" strokeWidth={2.1} />
            <Text style={styles.seenTxt}>Déjà vu</Text>
          </View>
        )}
      </View>
      {/* DERNIER enfant, exprès : posée après l'overlay, sinon son dégradé bas
          la recouvrirait et le pan du scrub ne l'atteindrait plus. */}
      <VideoProgressBar
        player={player}
        chapters={property.chapters}
        onScrubbingChange={setScrubbing}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  dimmed: { opacity: 0.25 },
  seen: {
    position: 'absolute',
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  seenTxt: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 0.25,
  },
})
