/**
 * Chip à 4 états (0 catalogue · 1 souhaité · 2 obligatoire · 3 rédhibitoire) —
 * parité visuelle avec `CriteriaStep`/`AIBriefRecap` web. Tap = cycle (géré par
 * l'appelant) ; bouton × optionnel pour retirer (état → 0).
 */
import { Pressable, StyleSheet, Text } from 'react-native'
import { Check, Plus, X } from 'lucide-react-native'
import type { ChipState } from '@shomee/core/stores/searchStore'

const STYLES: Record<ChipState, { bg: string; fg: string; border: string }> = {
  0: { bg: '#ffffff', fg: '#1a1a1a', border: 'rgba(0,0,0,0.09)' },
  1: { bg: '#fdf0ed', fg: '#9b4a2e', border: '#e8907a' },
  2: { bg: '#C1533A', fg: '#ffffff', border: '#C1533A' },
  3: { bg: '#f3f0ee', fg: '#9a9a9a', border: 'rgba(0,0,0,0.10)' },
}

export function CriteriaChip({
  label,
  state,
  onPress,
  onRemove,
}: {
  label: string
  state: ChipState
  onPress: () => void
  onRemove?: () => void
}) {
  const s = STYLES[state]
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: s.bg, borderColor: s.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {state === 1 && <Plus size={12} strokeWidth={2.6} color={s.fg} />}
      {state === 2 && <Check size={12} strokeWidth={2.6} color={s.fg} />}
      {state === 3 && <X size={12} strokeWidth={2.6} color={s.fg} />}
      <Text
        style={[
          styles.label,
          { color: s.fg, textDecorationLine: state === 3 ? 'line-through' : 'none' },
        ]}
      >
        {label}
      </Text>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} style={styles.remove}>
          <X size={12} strokeWidth={2.6} color={s.fg} />
        </Pressable>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // maxWidth/flexShrink : un critère personnalisé peut être une phrase entière
  // (« pas de vis-à-vis direct sur la rue »). Sans ça le pill déborde du wrap et
  // sort de l'écran. Ici il se contraint à son conteneur et le libellé passe à la
  // ligne à l'intérieur du pill — le × reste toujours atteignable.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    flexShrink: 1,
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  label: { fontSize: 12.5, fontWeight: '500', flexShrink: 1 },
  remove: { marginLeft: 1, opacity: 0.7, flexShrink: 0 },
})
