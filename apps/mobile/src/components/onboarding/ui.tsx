/**
 * Primitives UI partagées du funnel d'onboarding.
 *
 * REFONTE (direction A, maquettes `da-ob*.html` validées le 21/08) : ces trois
 * primitives sont posées sur TOUTES les étapes — les retoucher ici suffit à
 * refaire le funnel entier. Plus aucune couleur en dur : tout vient de
 * `@/lib/theme`.
 *
 * Les constantes BG / ACCENT / … restent exportées (plusieurs étapes les
 * importent) mais pointent désormais vers le nuancier.
 */
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ArrowRight } from 'lucide-react-native'
import { colors, fonts, radii, serifSizes } from '@/lib/theme'

export const BG = colors.cream
export const ACCENT = colors.terracotta
export const ACCENT_DISABLED = colors.terracottaDisabled
export const INK = colors.ink
export const MUTED = colors.muted

/**
 * L'en-tête d'une étape : la question en serif de marque, la précision en
 * dessous. C'est ce couple qui donne le ton « éditorial » du funnel.
 */
export function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  )
}

/** Intertitre d'une section (« LE BIEN », « VOS CRITÈRES ») — terracotta. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>
}

/**
 * Le CTA plein d'une étape — pilule terracotta, pleine largeur, avec son ombre
 * portée chaude. Désactivé : sable + texte gris, et l'ombre disparaît (un
 * bouton éteint ne doit pas continuer à flotter au-dessus de la page).
 */
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
        disabled ? styles.ctaOff : styles.ctaOn,
        pressed && !disabled ? styles.ctaPressed : null,
      ]}
    >
      <Text style={[styles.ctaText, disabled && styles.ctaTextOff]}>{label}</Text>
      {icon ? (
        <ArrowRight size={17} color={disabled ? colors.muted : colors.creamOnDark} strokeWidth={2.2} />
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 16 },
  title: {
    fontFamily: fonts.serif,
    fontSize: serifSizes.stepTitle,
    color: colors.ink,
    letterSpacing: -0.2,
    lineHeight: Math.round(serifSizes.stepTitle * 1.25),
  },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 6, lineHeight: 21 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.terracotta,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  cta: {
    height: 52,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaOn: {
    backgroundColor: colors.terracotta,
    // Ombre chaude : le CTA flotte au-dessus du crème, il ne s'y pose pas.
    shadowColor: colors.terracotta,
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  ctaOff: { backgroundColor: colors.sand },
  ctaPressed: { opacity: 0.9 },
  ctaText: { color: colors.creamOnDark, fontSize: 15.5, fontWeight: '600' },
  ctaTextOff: { color: colors.muted },
})
