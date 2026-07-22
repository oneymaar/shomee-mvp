/**
 * Étape 3 — Budget : un RangeSlider (échelle non-linéaire) + le signal marché
 * `budgetSignal` (core, headless). Les IRIS résolus par l'étape Quartiers
 * (`selectedIrisIds`) alimentent directement le signal — pas d'expansion arr→iris
 * (contrairement au web, la résolution texte peuple toujours les IRIS). PAS de
 * mini-carte (web-couplée → hors scope).
 */
import { useEffect } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { budgetSignal } from '@shomee/core/geo/budgetFeasibility'
import { useSearchStore } from '@/lib/stores'
import {
  BUDGET_SCALE,
  BUDGET_MAX_INDEX,
  BUDGET_DEFAULT_MAX,
  budgetIndex,
  formatBudget,
} from '@/lib/scales'
import { RangeSlider } from './RangeSlider'
import { BudgetMapWebView } from './BudgetMapWebView'
import { PrimaryButton, SectionLabel, StepHeader, ACCENT, INK, MUTED } from './ui'

// Dégradé de légende — 5 arrêts (miroir STOPS de budgetFeasibility).
const LEGEND_STOPS = ['#C17A6F', '#C4956A', '#C4B48A', '#A8C4A0', '#7DA882'] as const
const TONE_DOT: Record<string, string> = {
  comfort: '#A8C4A0',
  average: '#C4B48A',
  tight: '#C4956A',
  very_tight: '#C17A6F',
  none: '#A3A3A3',
}

export function StepBudget({ onNext }: { onNext: () => void }) {
  const setBudgetRange = useSearchStore((s) => s.setBudgetRange)
  const rawBudgetMin = useSearchStore((s) => s.budgetMin)
  const rawBudgetMax = useSearchStore((s) => s.budgetMax)
  const minSurface = useSearchStore((s) => s.minSurface)
  const selectedIrisIds = useSearchStore((s) => s.selectedIrisIds)
  const selectedArrIds = useSearchStore((s) => s.selectedArrIds)
  const selectedQuartierIds = useSearchStore((s) => s.selectedQuartierIds)
  const selectedCommuneIds = useSearchStore((s) => s.selectedCommuneIds)

  const budgetMin = rawBudgetMin ?? BUDGET_SCALE[0]
  const budgetMax = rawBudgetMax ?? BUDGET_DEFAULT_MAX
  const surface = minSurface ?? 50

  useEffect(() => {
    if (rawBudgetMin == null || rawBudgetMax == null) setBudgetRange(budgetMin, budgetMax)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signal = budgetSignal(selectedIrisIds, budgetMax, surface)
  const dotColor = TONE_DOT[signal.tone] ?? TONE_DOT.none
  const hasSelection =
    selectedIrisIds.length > 0 ||
    selectedArrIds.length > 0 ||
    selectedQuartierIds.length > 0 ||
    selectedCommuneIds.length > 0

  return (
    <View style={styles.root}>
      <StepHeader title="Quel est votre budget ?" subtitle="Glissez les bornes pour cadrer votre fourchette." />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.minMax}>
          <View>
            <Text style={styles.minMaxCap}>Minimum</Text>
            <Text style={styles.minMaxVal}>{formatBudget(budgetMin)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.minMaxCap}>Maximum</Text>
            <Text style={styles.minMaxVal}>{formatBudget(budgetMax)}</Text>
          </View>
        </View>

        <RangeSlider
          min={0}
          max={BUDGET_MAX_INDEX}
          step={1}
          low={budgetIndex(budgetMin)}
          high={budgetIndex(budgetMax)}
          onChange={(lo, hi) => setBudgetRange(BUDGET_SCALE[lo], BUDGET_SCALE[hi])}
        />

        {/* Signal marché */}
        <View style={styles.signalRow}>
          {signal.text ? (
            <>
              <View style={[styles.dot, { backgroundColor: dotColor }]} />
              <Text style={styles.signalText}>{signal.text}</Text>
            </>
          ) : hasSelection ? (
            <Text style={styles.signalMuted}>Préparation de la lecture marché…</Text>
          ) : (
            <Text style={styles.signalMuted}>
              Sélectionnez d&apos;abord vos quartiers pour activer la lecture marché.
            </Text>
          )}
        </View>

        {/* Légende dégradé */}
        <View style={styles.legendWrap}>
          <SectionLabel>Lecture marché</SectionLabel>
          <LinearGradient
            colors={[...LEGEND_STOPS] as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.legendBar}
          />
          <View style={styles.legendLabels}>
            <Text style={styles.legendTxt}>Serré</Text>
            <Text style={styles.legendTxt}>Dans la moyenne</Text>
            <Text style={styles.legendTxt}>Confortable</Text>
          </View>
        </View>

        {/* Carte de faisabilité budgétaire — IRIS colorés selon le ratio
            budget/prix, recolorés en live quand on glisse le curseur. */}
        {hasSelection && (
          <View style={styles.mapWrap}>
            <BudgetMapWebView
              arrIds={selectedArrIds}
              quartierIds={selectedQuartierIds}
              irisIds={selectedIrisIds}
              communeIds={selectedCommuneIds}
              budgetMax={budgetMax}
              surface={surface}
            />
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Valider mon budget" onPress={onNext} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: 24, paddingBottom: 24 },
  minMax: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 14 },
  minMaxCap: {
    fontSize: 10,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  minMaxVal: { fontSize: 17, fontWeight: '700', color: ACCENT },

  signalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22, marginTop: 18 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  signalText: { flex: 1, fontSize: 13, fontWeight: '500', color: INK, lineHeight: 18 },
  signalMuted: { flex: 1, fontSize: 13, color: MUTED, lineHeight: 18 },

  legendWrap: { marginTop: 28 },
  legendBar: { height: 6, borderRadius: 3, width: '100%' },
  legendLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  legendTxt: { fontSize: 11, color: MUTED },
  mapWrap: { marginTop: 24 },

  footer: { paddingHorizontal: 24, paddingTop: 12 },
})
