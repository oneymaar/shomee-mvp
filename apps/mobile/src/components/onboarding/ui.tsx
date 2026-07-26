/**
 * Primitives UI partagées du funnel manuel natif (S7) — parité visuelle avec les
 * étapes web (crème `#FDF5F2`, accent terracotta `#A64B27`, cartes blanches).
 */
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'

export const BG = '#FDF5F2'
export const ACCENT = '#A64B27'
export const ACCENT_DISABLED = '#DB947E'
export const INK = '#1c1917'
export const MUTED = '#78716c'

export function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  icon = true,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  icon?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.cta,
        { backgroundColor: disabled ? ACCENT_DISABLED : ACCENT, opacity: pressed && !disabled ? 0.9 : 1 },
      ]}
    >
      <Text style={styles.ctaText}>{label}</Text>
      {icon ? <ChevronRight size={18} color="#fff" /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: INK, letterSpacing: -0.3, lineHeight: 27 },
  subtitle: { fontSize: 13.5, color: MUTED, marginTop: 6, lineHeight: 19 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  cta: {
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },
})
