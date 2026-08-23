/**
 * Étape 2 — Bien : type(s) de bien + surface / pièces / chambres via RangeSlider.
 * Toute la logique (coupling pièces→chambres, invariants) vit dans `@shomee/core`
 * (`setRoomsRange`/`setBedroomsRange`) → elle s'applique seule quand on écrit.
 */
import { useEffect } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  ROOMS_MIN,
  ROOMS_MAX,
  BEDROOMS_MIN,
  BEDROOMS_MAX,
} from '@shomee/core/stores/searchStore'
import { useSearchStore } from '@/lib/stores'
import { PROPERTY_TYPES } from '@/lib/onboardingCatalog'
import {
  SURFACE_SCALE,
  SURFACE_MAX_INDEX,
  SURFACE_UNLIMITED,
  SURFACE_DEFAULT_MIN,
  surfaceIndex,
  formatSurface,
  formatRooms,
  formatBedrooms,
} from '@/lib/scales'
import { RangeSlider } from './RangeSlider'
import { PrimaryButton, SectionLabel, StepHeader, INK, MUTED } from './ui'
import { colors, fonts, radii } from '@/lib/theme'

function coupledMinBedrooms(minRooms: number): number {
  return Math.min(BEDROOMS_MAX, Math.max(BEDROOMS_MIN, minRooms - 1))
}

export function StepBien({ onNext }: { onNext: () => void }) {
  const propertyTypes = useSearchStore((s) => s.propertyTypes)
  const togglePropertyType = useSearchStore((s) => s.togglePropertyType)
  const setSurface = useSearchStore((s) => s.setSurface)
  const setRoomsRange = useSearchStore((s) => s.setRoomsRange)
  const setBedroomsRange = useSearchStore((s) => s.setBedroomsRange)

  const rawMinSurface = useSearchStore((s) => s.minSurface)
  const rawMaxSurface = useSearchStore((s) => s.maxSurface)
  const rawMinRooms = useSearchStore((s) => s.minRooms)
  const rawMaxRooms = useSearchStore((s) => s.maxRooms)
  const rawMinBedrooms = useSearchStore((s) => s.minBedrooms)
  const rawMaxBedrooms = useSearchStore((s) => s.maxBedrooms)

  const minSurface = rawMinSurface ?? SURFACE_DEFAULT_MIN
  const maxSurface = rawMaxSurface ?? SURFACE_UNLIMITED
  const minRooms = rawMinRooms ?? ROOMS_MIN
  const maxRooms = rawMaxRooms ?? ROOMS_MAX
  const minBedrooms = rawMinBedrooms ?? coupledMinBedrooms(minRooms)
  const maxBedrooms = rawMaxBedrooms ?? BEDROOMS_MAX

  // Persiste les valeurs par défaut une fois au montage (parité BienStep web :
  // l'utilisateur peut valider sans toucher aux sliders et garder des bornes).
  useEffect(() => {
    if (rawMinSurface == null || rawMaxSurface == null) setSurface(minSurface, maxSurface)
    if (rawMinRooms == null || rawMaxRooms == null) setRoomsRange(minRooms, maxRooms)
    if (rawMinBedrooms == null || rawMaxBedrooms == null) setBedroomsRange(minBedrooms, maxBedrooms)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View style={styles.root}>
      <StepHeader title="Votre bien" subtitle="Quelques infos pour cadrer votre cible." />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Type de bien */}
        <SectionLabel>Type de bien</SectionLabel>
        <View style={styles.typeRow}>
          {PROPERTY_TYPES.map((pt) => {
            const selected = propertyTypes.includes(pt.value)
            return (
              <Pressable
                key={pt.value}
                onPress={() => togglePropertyType(pt.value)}
                style={({ pressed }) => [
                  styles.typeChip,
                  selected && styles.typeChipOn,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.typeEmoji}>{pt.emoji}</Text>
                <Text style={[styles.typeLabel, selected && styles.typeLabelOn]}>{pt.label}</Text>
              </Pressable>
            )
          })}
        </View>

        {/* Surface — échelle non-linéaire via index */}
        <View style={styles.block}>
          <SectionLabel>Surface</SectionLabel>
          <MinMax min={formatSurface(minSurface)} max={formatSurface(maxSurface)} />
          <RangeSlider
            min={0}
            max={SURFACE_MAX_INDEX}
            step={1}
            low={surfaceIndex(minSurface)}
            high={surfaceIndex(maxSurface)}
            onChange={(lo, hi) => setSurface(SURFACE_SCALE[lo], SURFACE_SCALE[hi])}
          />
        </View>

        {/* Nombre de pièces — linéaire */}
        <View style={styles.block}>
          <SectionLabel>Nombre de pièces</SectionLabel>
          <MinMax min={formatRooms(minRooms)} max={formatRooms(maxRooms)} />
          <RangeSlider
            min={ROOMS_MIN}
            max={ROOMS_MAX}
            step={1}
            low={minRooms}
            high={maxRooms}
            onChange={(lo, hi) => setRoomsRange(lo, hi)}
          />
        </View>

        {/* Nombre de chambres — linéaire (min couplé côté core) */}
        <View style={styles.block}>
          <SectionLabel>Nombre de chambres</SectionLabel>
          <MinMax min={formatBedrooms(minBedrooms)} max={formatBedrooms(maxBedrooms)} />
          <RangeSlider
            min={BEDROOMS_MIN}
            max={BEDROOMS_MAX}
            step={1}
            low={minBedrooms}
            high={maxBedrooms}
            onChange={(lo, hi) => setBedroomsRange(lo, hi)}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Valider" onPress={onNext} />
      </View>
    </View>
  )
}

function MinMax({ min, max }: { min: string; max: string }) {
  return (
    <View style={styles.minMax}>
      <View>
        <Text style={styles.minMaxCap}>Minimum</Text>
        <Text style={styles.minMaxVal}>{min}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.minMaxCap}>Maximum</Text>
        <Text style={styles.minMaxVal}>{max}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: 22, paddingBottom: 24 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: '#fff',
  },
  typeChipOn: { borderColor: colors.terracottaBright },
  typeEmoji: { fontSize: 15 },
  typeLabel: { fontSize: 13.5, fontWeight: '500', color: INK },
  typeLabelOn: { color: colors.terracotta, fontWeight: '600' },

  block: { marginTop: 28 },
  minMax: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 14 },
  minMaxCap: {
    fontSize: 10,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  minMaxVal: { fontFamily: fonts.serif, fontSize: 18, color: colors.ink },

  footer: {
    paddingHorizontal: 22,
    paddingTop: 12,
  },
})
