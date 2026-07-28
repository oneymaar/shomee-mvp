/**
 * Indicateur de progression du wizard — 4 segments + libellés (miroir de la
 * barre web `STEP_LABELS`). Actif = terracotta ; passé = terracotta pâle ;
 * futur = gris.
 */
import { StyleSheet, Text, View } from 'react-native'

const ACTIVE = '#A64B27'
const PAST = '#DB947E'
const FUTURE_BAR = 'rgba(0,0,0,0.10)'
const FUTURE_LABEL = '#525252'

export const STEP_LABELS = ['Quartiers', 'Bien', 'Budget', 'Critères'] as const

export function WizardProgress({ step }: { step: number }) {
  return (
    <View style={styles.row}>
      {STEP_LABELS.map((label, i) => {
        const isActive = i === step - 1
        const isPast = i < step - 1
        const barColor = isActive ? ACTIVE : isPast ? PAST : FUTURE_BAR
        const labelColor = isActive ? ACTIVE : isPast ? PAST : FUTURE_LABEL
        return (
          <View key={label} style={styles.cell}>
            <View style={[styles.bar, { backgroundColor: barColor }]} />
            <Text style={[styles.label, { color: labelColor, fontWeight: isActive || isPast ? '700' : '500' }]}>
              {label}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', gap: 6 },
  cell: { flex: 1, gap: 4 },
  bar: { height: 4, borderRadius: 2 },
  label: { fontSize: 10, textAlign: 'center' },
})
