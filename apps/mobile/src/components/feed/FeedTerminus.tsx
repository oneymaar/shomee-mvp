/**
 * TERMINUS — la dernière ligne du feed, quand il n'y a réellement plus rien à
 * montrer : le stock dans les critères est lu, et le rayon de découverte est
 * épuisé (« le terminus arrive quand il n'y a plus de biens pertinents à
 * présenter » — arbitrage du 29/07).
 *
 * JAMAIS « 0 », JAMAIS « plus rien » : l'écran ouvre une porte au lieu de
 * constater un vide. Maquette validée le 29/07.
 *
 * SANS PROMESSE, POUR L'INSTANT. La maquette cible porte un CTA « M'avertir des
 * nouveaux biens » — il n'apparaîtra qu'avec la veille serveur (lot 6) : tant
 * que personne ne surveille réellement le marché, l'afficher serait mentir. La
 * seule action est donc « Ajuster ma recherche », en attendant.
 *
 * C'est une LIGNE du feed, pas un intercalaire : elle ne gèle pas le scroll
 * (remonter = un geste, comme partout), ne demande aucune décision, et ne
 * compte ni dans le budget d'interruption ni dans la non-insistance — elle ne
 * propose aucune modification, elle constate et propose une sortie.
 */
import { StyleSheet, Text, View, Pressable } from 'react-native'
import { BellRing } from 'lucide-react-native'

const BG = '#FDF5F2'
const ACCENT = '#A64B27'
const INK = '#1c1817'
const MUTED = '#78716c'
/** Fond de la pastille d'icône — l'accent à 9 %, comme sur tout l'onboarding. */
const SOFT = 'rgba(166,75,39,0.09)'

export function FeedTerminus({
  height,
  onEditBrief,
}: {
  height: number
  /** « Ajuster ma recherche » → récap de l'onboarding manuel. */
  onEditBrief: () => void
}) {
  return (
    <View style={[styles.root, { height }]}>
      <View style={styles.badge}>
        <BellRing size={21} strokeWidth={1.9} color={ACCENT} />
      </View>
      <Text style={styles.head}>{"Vous avez tout vu — pour l'instant."}</Text>
      <Text style={styles.line}>
        De nouveaux biens arrivent chaque jour. Revenez y jeter un œil, ou
        ajustez votre recherche.
      </Text>
      <Pressable onPress={onEditBrief} hitSlop={10} style={styles.link}>
        <Text style={styles.linkTxt}>Ajuster ma recherche</Text>
      </Pressable>
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
  head: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    color: INK,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  line: { fontSize: 15, lineHeight: 22, color: MUTED, textAlign: 'center', marginTop: 10 },
  link: { marginTop: 22 },
  linkTxt: { fontSize: 14.5, fontWeight: '700', color: ACCENT },
})
