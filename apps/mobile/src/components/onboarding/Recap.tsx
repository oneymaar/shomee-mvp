/**
 * Récap natif (miroir `AIBriefRecap` web) — 4 cartes lues DEPUIS le store. Tap
 * sur une carte → édition de l'étape correspondante (le wizard rebondit ici).
 * « Voir ma sélection » → `generateFeedFromStore` (chaîne S6a). Agnostique de la
 * source : réutilisable tel quel derrière le handoff ChatGPT (hors scope S7).
 */
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Home, MapPin, Pencil, RotateCcw, Sparkles, Wallet } from 'lucide-react-native'
import type { ChipState } from '@shomee/core/stores/searchStore'
import { useSearchStore } from '@/lib/stores'
import {
  formatSurface,
  formatBudget,
  formatRooms,
  formatBedrooms,
} from '@/lib/scales'
import { PROPERTY_TYPES } from '@/lib/onboardingCatalog'
import { CriteriaChip } from './CriteriaChip'
import { PrimaryButton, ACCENT, BG, INK, MUTED } from './ui'
import { colors, fonts, radii, serifSizes } from '@/lib/theme'

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  PROPERTY_TYPES.map((t) => [t.value, t.label]),
)

function rangeText(min: number | null, max: number | null, fmt: (v: number) => string): string | null {
  if (min == null && max == null) return null
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`
  if (min != null) return `À partir de ${fmt(min)}`
  return `Jusqu'à ${fmt(max as number)}`
}

export function Recap({
  onEditBlock,
  onEditManual,
  onLaunch,
}: {
  onEditBlock: (step: 1 | 2 | 3 | 4) => void
  onEditManual: () => void
  onLaunch: () => void
}) {
  const locationLabel = useSearchStore((s) => s.locationLabel)
  const locationQuery = useSearchStore((s) => s.locationQuery)
  const propertyTypes = useSearchStore((s) => s.propertyTypes)
  const minRooms = useSearchStore((s) => s.minRooms)
  const maxRooms = useSearchStore((s) => s.maxRooms)
  const minBedrooms = useSearchStore((s) => s.minBedrooms)
  const maxBedrooms = useSearchStore((s) => s.maxBedrooms)
  const minSurface = useSearchStore((s) => s.minSurface)
  const maxSurface = useSearchStore((s) => s.maxSurface)
  const budgetMin = useSearchStore((s) => s.budgetMin)
  const budgetMax = useSearchStore((s) => s.budgetMax)
  const chipStates = useSearchStore((s) => s.chipStates)
  const customCriteria = useSearchStore((s) => s.customCriteria)

  const locationText = locationLabel || locationQuery || 'Localisation non renseignée'

  const bienParts: string[] = [
    propertyTypes.length > 0 ? propertyTypes.map((t) => TYPE_LABEL[t] ?? t).join(', ') : 'Tous types',
  ]
  const roomsR = rangeText(minRooms, maxRooms, formatRooms)
  if (roomsR) bienParts.push(roomsR)
  const bedroomsR = rangeText(minBedrooms, maxBedrooms, formatBedrooms)
  if (bedroomsR) bienParts.push(bedroomsR)
  const surfaceR =
    minSurface == null && maxSurface == null
      ? 'Surface non renseignée'
      : rangeText(minSurface, maxSurface, formatSurface)
  if (surfaceR) bienParts.push(surfaceR)
  const bienText = bienParts.join(' · ')

  const budgetText =
    budgetMin == null && budgetMax == null
      ? 'Budget non renseigné'
      : (rangeText(budgetMin, budgetMax, formatBudget) as string)

  const chipEntries = (Object.entries(chipStates) as [string, ChipState][]).filter(([, s]) => s > 0)
  const customEntries = customCriteria.filter((c) => c.state > 0)
  const hasCriteria = chipEntries.length > 0 || customEntries.length > 0

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Récapitulatif</Text>
        <Text style={styles.title}>Voici votre recherche.</Text>
        <Text style={styles.sub}>Vérifiez et ajustez avant de lancer.</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Jauge de rareté — MASQUÉE pour l'instant (29/07) : calculée sur
            NOTRE catalogue, pas sur le marché réel, elle pouvait déclarer
            « rare » une recherche banale (« il y en a plein, des appartements
            avec ces caractéristiques ») — indication infidèle, et un encart de
            trop sur cet écran. À réactiver quand le catalogue reflétera le
            marché : remettre `<RarityGauge />` et son import. */}
        <BlockCard icon={<MapPin size={16} color={ACCENT} />} title="Quartiers" onEdit={() => onEditBlock(1)}>
          <Text style={styles.value}>{locationText}</Text>
        </BlockCard>

        <BlockCard icon={<Home size={16} color={ACCENT} />} title="Bien" onEdit={() => onEditBlock(2)}>
          <Text style={styles.value}>{bienText}</Text>
        </BlockCard>

        <BlockCard icon={<Wallet size={16} color={ACCENT} />} title="Budget" onEdit={() => onEditBlock(3)}>
          <Text style={styles.value}>{budgetText}</Text>
        </BlockCard>

        <BlockCard icon={<Sparkles size={16} color={ACCENT} />} title="Critères" onEdit={() => onEditBlock(4)}>
          {hasCriteria ? (
            <View style={styles.chipWrap}>
              {chipEntries.map(([label, state]) => (
                <CriteriaChip key={`c-${label}`} label={label} state={state} onPress={() => onEditBlock(4)} />
              ))}
              {customEntries.map((c) => (
                <CriteriaChip key={`cc-${c.id}`} label={c.label} state={c.state} onPress={() => onEditBlock(4)} />
              ))}
            </View>
          ) : (
            <Text style={styles.valueMuted}>Aucun critère sélectionné</Text>
          )}
        </BlockCard>
        <Pressable onPress={onEditManual} style={styles.restart} hitSlop={6}>
          <RotateCcw size={15} color={ACCENT} strokeWidth={2.2} />
          <Text style={styles.restartTxt}>Reprendre du début</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Lancer la recherche" onPress={onLaunch} />
      </View>
    </View>
  )
}

function BlockCard({
  icon,
  title,
  children,
  onEdit,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  onEdit: () => void
}) {
  return (
    <Pressable onPress={onEdit} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.9 : 1 }]}>
      <View style={styles.cardIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        {children}
      </View>
      <Pencil size={14} color="#B7A99D" />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 12 },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    color: ACCENT,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: { fontFamily: fonts.serif, fontSize: serifSizes.stepTitle, color: INK, letterSpacing: -0.2, lineHeight: 34 },
  sub: { fontSize: 14, color: MUTED, marginTop: 6, lineHeight: 21 },

  body: { paddingHorizontal: 22, paddingBottom: 20, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  value: { fontSize: 14.5, fontWeight: '600', color: INK, lineHeight: 20 },
  valueMuted: { fontSize: 14, color: '#B7A99D', fontStyle: 'italic' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },

  footer: { paddingHorizontal: 22, paddingTop: 8 },
  // « Reprendre du début » : sous les cartes, pas collé au CTA — c'est un
  // geste de repli, il ne doit pas rivaliser avec le geste d'avancée.
  restart: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 14,
    marginTop: 2,
  },
  restartTxt: { fontSize: 13.5, fontWeight: '600', color: ACCENT },
})
