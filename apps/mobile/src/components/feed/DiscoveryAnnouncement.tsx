/**
 * ANNONCE D'UN BIEN HORS CRITÈRES — l'écran qui précède, dans le feed, chaque
 * bien rapporté par la voie découverte (étape 2 de l'élargissement).
 *
 * CE N'EST PAS UN INTERCALAIRE. L'intercalaire demande une décision et gèle le
 * feed tant qu'elle n'est pas prise. Celui-ci ne demande RIEN : pas de CTA, pas
 * de choix, rien à toucher. Il informe — « voilà ce qu'on a trouvé, et voilà en
 * quoi ça sort de ce que vous aviez dit » — puis s'efface dès que l'acquéreur
 * scrolle.
 *
 * MAIS LE SCROLL RESTE LE SIEN. Pas de défilement automatique, pas de minuterie :
 * sans son geste, l'écran tient indéfiniment. C'est exactement l'intention — on
 * lui POSE une question (« ça vous intéresse quand même ? ») et c'est en
 * scrollant qu'il y répond. Un bien hors critères qu'on ferait défiler sous ses
 * yeux serait imposé ; un bien qu'il va chercher lui-même est accepté d'avance.
 * D'où le seul élément mobile de l'écran : le chevron qui respire en bas, la
 * seule indication de ce qu'il y a à faire.
 *
 * TROIS LIGNES, PAS QUATRE. Un titre invariant, la nature du dépassement, le
 * chiffre. Le chiffre EST l'information — « il dépasse un peu votre budget »
 * sans montant laisse l'acquéreur imaginer le pire, et souvent bien pire que la
 * réalité. Tout le reste (score, agence, arguments) appartient au bien lui-même,
 * qui est juste en dessous.
 *
 * ET APRÈS, PLUS RIEN. Aucune trace, aucun badge ne suit le bien sur sa vidéo :
 * une fois annoncé, il ressemble à n'importe quel autre bien du feed. Le
 * marquer en permanence reviendrait à le déclasser à chaque seconde de visite.
 */
import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronDown, Euro, ListChecks, MapPin, Ruler } from 'lucide-react-native'
import type { DiscoveryNotice, NoticeKind } from '@/lib/wideningPlan'

const BG = '#FDF5F2'
const ACCENT = '#A64B27'
const INK = '#1c1817'
const MUTED = '#78716c'
/** Fond de la pastille d'icône — l'accent à 9 %, comme sur tout l'onboarding. */
const SOFT = 'rgba(166,75,39,0.09)'
/** Gris du chevron : plus clair que le texte, il indique sans réclamer. */
const HINT = '#8c827c'

/** Une icône par axe élargi : l'acquéreur sait de quoi on parle avant de lire.
 *  (Les chambres et les pièces ont quitté le vocabulaire le 29/07 — ces axes ne
 *  se desserrent plus, donc ne s'annoncent plus.) */
const ICONS: Record<NoticeKind, typeof MapPin> = {
  zone: MapPin,
  budget: Euro,
  surface: Ruler,
  criteria: ListChecks,
}

const BREATHE_MS = 950

export function DiscoveryAnnouncement({
  notice,
  height,
}: {
  notice: DiscoveryNotice
  height: number
}) {
  const insets = useSafeAreaInsets()
  const breathe = useRef(new Animated.Value(0)).current
  const Icon = ICONS[notice.kind]

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: BREATHE_MS, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: BREATHE_MS, useNativeDriver: true }),
      ]),
    )
    loop.start()
    // La FlatList monte et démonte les lignes hors fenêtre : sans ce stop, une
    // boucle continuerait à tourner pour un écran que plus personne ne regarde.
    return () => loop.stop()
  }, [breathe])

  const hintY = breathe.interpolate({ inputRange: [0, 1], outputRange: [0, 4] })
  const hintOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] })

  return (
    <View style={[styles.root, { height }]}>
      <View style={styles.badge}>
        <Icon size={21} strokeWidth={1.9} color={ACCENT} />
      </View>
      <Text style={styles.head}>Un bien qui pourrait vous intéresser</Text>
      <Text style={styles.line}>{notice.line}</Text>
      <View style={styles.detail}>
        {/* Un seul bloc de texte : le chiffre et son rappel doivent se couper à
            la même ligne s'ils se coupent, jamais l'un sans l'autre. */}
        <Text style={styles.detailText} numberOfLines={2}>
          <Text style={styles.detailValue}>{notice.value}</Text> · {notice.reference}
        </Text>
      </View>

      {/* Seul mouvement de l'écran, et seule consigne : c'est vous qui ouvrez. */}
      <Animated.View
        style={[
          styles.hint,
          { bottom: insets.bottom + 26, opacity: hintOpacity, transform: [{ translateY: hintY }] },
        ]}
      >
        <ChevronDown size={22} strokeWidth={2} color={HINT} />
        <Text style={styles.hintLabel}>Continuez</Text>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  badge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  head: { fontSize: 18.5, lineHeight: 24, fontWeight: '600', color: INK, textAlign: 'center' },
  line: { fontSize: 15.5, lineHeight: 23, color: MUTED, textAlign: 'center', marginTop: 9 },
  detail: {
    marginTop: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.038)',
    paddingVertical: 7,
    paddingHorizontal: 15,
  },
  detailText: { fontSize: 13, lineHeight: 18, color: MUTED, textAlign: 'center' },
  detailValue: { color: INK, fontWeight: '600' },
  hint: { position: 'absolute', alignItems: 'center', gap: 4 },
  hintLabel: { fontSize: 12, letterSpacing: 0.24, color: HINT },
})
