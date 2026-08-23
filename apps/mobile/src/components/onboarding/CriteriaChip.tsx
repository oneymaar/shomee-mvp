/**
 * La PASTILLE — l'élément signature de SHOMEE. Quatre états :
 *   0 catalogue (proposée, pas encore choisie) · 1 souhaité · 2 obligatoire ·
 *   3 rédhibitoire.
 * Tap = cycle (géré par l'appelant) ; bouton × optionnel pour retirer (→ 0).
 *
 * REFONTE (maquette validée le 21/08) — la palette des états devient lisible
 * d'un coup d'œil, et cohérente avec le reste de l'app :
 *   0 blanc bordé de filet         → « disponible »
 *   1 blanc bordé terracotta clair → « je le souhaite » (＋)
 *   2 terracotta plein             → « il me le faut » (✓) — le plus fort
 *   3 sable barré                  → « surtout pas » (×)
 * L'intensité du remplissage suit l'exigence : plus c'est impératif, plus la
 * pastille est pleine.
 */
import { Pressable, StyleSheet, Text } from 'react-native'
import { Check, Plus, X } from 'lucide-react-native'
import type { ChipState } from '@shomee/core/stores/searchStore'
import { colors, radii } from '@/lib/theme'

/** Palette des états — exportée : la légende de l'étape Critères la
 *  réutilise telle quelle, au lieu d'en tenir une copie qui dérive. */
export const CHIP_STATE_STYLES: Record<ChipState, { bg: string; fg: string; border: string }> = {
  0: { bg: '#FFFFFF', fg: colors.ink, border: colors.line },
  1: { bg: '#FFFFFF', fg: colors.terracotta, border: colors.terracottaBright },
  2: { bg: colors.terracotta, fg: colors.creamOnDark, border: colors.terracotta },
  3: { bg: colors.sand, fg: colors.muted, border: colors.sand },
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
  const s = CHIP_STATE_STYLES[state]
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: s.bg, borderColor: s.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {state === 1 && <Plus size={13} strokeWidth={2.6} color={s.fg} />}
      {state === 2 && <Check size={13} strokeWidth={2.6} color={s.fg} />}
      <Text
        style={[
          styles.label,
          {
            color: s.fg,
            // Le barré dit « rédhibitoire » mieux qu'une icône : le mot est
            // rayé, donc le bien qui le porte est écarté.
            textDecorationLine: state === 3 ? 'line-through' : 'none',
            fontWeight: state === 0 ? '500' : '600',
          },
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
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  label: { fontSize: 13, flexShrink: 1 },
  remove: { marginLeft: 1, opacity: 0.7, flexShrink: 0 },
})
