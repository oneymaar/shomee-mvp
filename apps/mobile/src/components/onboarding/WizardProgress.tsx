/**
 * Indicateur de progression du funnel.
 *
 * REFONTE (maquette validée le 21/08, après deux retours d'Olivier) :
 *  - la version précédente affichait 4 libellés côte à côte sous 4 barres — ça
 *    « ressemblait à des onglets, pas à une progression » ;
 *  - désormais : UNE ligne de titre qui NOMME l'étape en cours
 *    (« ÉTAPE 1 SUR 4 — QUARTIERS »), puis 4 segments égaux en dessous.
 *    On lit où on en est en un coup d'œil, sans compter les barres.
 *
 * Segments : passé = terracotta pâle, en cours = terracotta plein, à venir =
 * filet. Quatre parts strictement égales — la progression est régulière.
 */
import { StyleSheet, Text, View } from 'react-native'
import { colors } from '@/lib/theme'

export const STEP_LABELS = ['Quartiers', 'Bien', 'Budget', 'Critères'] as const

const TOTAL = STEP_LABELS.length

export function WizardProgress({ step }: { step: number }) {
  // `step` est 1-indexé. Borné : une étape hors plage ne doit pas casser
  // l'affichage (elle retombe sur la première ou la dernière).
  const current = Math.min(Math.max(step, 1), TOTAL)
  const name = STEP_LABELS[current - 1]

  return (
    <View style={styles.wrap}>
      <Text style={styles.label} numberOfLines={1}>
        {`ÉTAPE ${current} SUR ${TOTAL} — ${name.toUpperCase()}`}
      </Text>
      <View style={styles.bars}>
        {STEP_LABELS.map((l, i) => (
          <View
            key={l}
            style={[
              styles.bar,
              i < current - 1 && styles.barDone,
              i === current - 1 && styles.barOn,
            ]}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 7,
  },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line },
  barDone: { backgroundColor: colors.terracottaDisabled },
  barOn: { backgroundColor: colors.terracotta },
})
