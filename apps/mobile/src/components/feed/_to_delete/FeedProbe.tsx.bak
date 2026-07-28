/**
 * Intercalaire « streak de rejets » (P6) — s'affiche par-dessus le feed après
 * plusieurs skips rapides d'affilée. Demande ce qui freine (chips dérivés des
 * attributs communs aux biens ignorés) ; un tap ajoute ce critère en
 * RÉDHIBITOIRE puis relance le feed. Toujours ignorable d'un tap.
 *
 * Purement présentationnel : la logique de déclenchement + le re-run vivent dans
 * l'écran feed (aucune modification muette des critères — c'est un tap explicite
 * de l'utilisateur qui fait évoluer la recherche, invariant produit).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronDown, X } from 'lucide-react-native'

const BG = '#FDF5F2'
const ACCENT = '#A64B27'
const INK = '#1c1917'
const MUTED = '#78716c'

export function FeedProbe({
  chips,
  onPick,
  onDismiss,
}: {
  chips: string[]
  onPick: (label: string) => void
  onDismiss: () => void
}) {
  return (
    <View style={styles.root}>
      <Pressable style={styles.close} onPress={onDismiss} hitSlop={10}>
        <ChevronDown size={22} color={MUTED} />
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.title}>Ces biens ne vous parlent pas ?</Text>
        <Text style={styles.sub}>
          Dites-nous ce qui vous freine : on retire ce type de bien et on affine votre recherche.
        </Text>

        <View style={styles.chips}>
          {chips.map((c) => (
            <Pressable key={c} onPress={() => onPick(c)} style={styles.chip} hitSlop={4}>
              <X size={12} strokeWidth={2.8} color={ACCENT} />
              <Text style={styles.chipTxt}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={onDismiss} hitSlop={8} style={styles.ignore}>
          <Text style={styles.ignoreTxt}>Autre / continuer sans changer</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  close: { position: 'absolute', top: 54, alignSelf: 'center', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', alignItems: 'center', gap: 14 },
  title: { fontSize: 21, fontWeight: '800', color: INK, textAlign: 'center' },
  sub: { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'center', marginTop: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(166,75,39,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(166,75,39,0.28)',
  },
  chipTxt: { fontSize: 14, fontWeight: '600', color: ACCENT },
  ignore: { marginTop: 18, paddingVertical: 8 },
  ignoreTxt: { fontSize: 14, fontWeight: '500', color: MUTED, textDecorationLine: 'underline' },
})
