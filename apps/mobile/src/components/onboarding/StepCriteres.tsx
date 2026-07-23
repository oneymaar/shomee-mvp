/**
 * Étape 4 — Critères. Alignée sur le design web d'origine :
 *   1) légende COLORÉE (souhaité/obligatoire/rédhibitoire) tout en haut ;
 *   2) catalogue « Le bien » / « L'immeuble » ;
 *   3) champ texte custom SOUS le catalogue, au-dessus de la sélection ;
 *   4) « Vos critères ».
 * Nouveauté produit : une pastille ajoutée part en OBLIGATOIRE (état 2) ; le
 * re-tap cycle obligatoire → souhaité → rédhibitoire. Un coach ANCRÉ au-dessus
 * de la pastille concernée s'affiche les premières fois pour expliquer le re-tap.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { ArrowRight, Check, Plus, X } from 'lucide-react-native'
import type { ChipState } from '@shomee/core/stores/searchStore'
import { useSearchStore } from '@/lib/stores'
import { apiFetch } from '@/lib/api'
import { PROPERTY_TAGS, BUILDING_TAGS } from '@/lib/onboardingCatalog'
import { CriteriaChip } from './CriteriaChip'
import { PrimaryButton, SectionLabel, StepHeader, ACCENT, INK } from './ui'

// Défaut d'ajout = OBLIGATOIRE (2). Re-tap : 2 → 1 → 3 → 2.
const DEFAULT_STATE: ChipState = 2
function nextState(s: ChipState): ChipState {
  return s === 2 ? 1 : s === 1 ? 3 : 2
}

// Palette légende / pastilles sélectionnées (parité CriteriaChip).
const LEGEND_STYLE: Record<1 | 2 | 3, { bg: string; fg: string; border: string }> = {
  1: { bg: '#fdf0ed', fg: '#9b4a2e', border: '#e8907a' },
  2: { bg: '#C1533A', fg: '#ffffff', border: '#C1533A' },
  3: { bg: '#f3f0ee', fg: '#9a9a9a', border: 'rgba(0,0,0,0.10)' },
}
const LEGEND: Array<{ state: 1 | 2 | 3; label: string; icon: 'plus' | 'check' | 'x' }> = [
  { state: 1, label: 'Souhaité', icon: 'plus' },
  { state: 2, label: 'Obligatoire', icon: 'check' },
  { state: 3, label: 'Rédhibitoire', icon: 'x' },
]

const COACH_MAX = 1 // affichée UNE fois, puis reste jusqu'à fermeture manuelle (×)

// Bulle « re-tap » ancrée juste au-dessus de la pastille concernée.
function CoachAnchor({
  show,
  onClose,
  children,
}: {
  show: boolean
  onClose: () => void
  children: ReactNode
}) {
  return (
    <View style={styles.coachHost}>
      {children}
      {show && (
        <View pointerEvents="box-none" style={styles.coachWrap}>
          <View style={styles.coachPill}>
            <View style={styles.coachTextCol}>
              <Text style={styles.coachTxt}>Recliquez ici pour changer son statut</Text>
              <Text style={styles.coachSub}>obligatoire → souhaité → rédhibitoire</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.coachClose}>
              <X size={13} strokeWidth={2.6} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
          <View style={styles.coachArrow} />
        </View>
      )}
    </View>
  )
}

export function StepCriteres({ onNext }: { onNext: () => void }) {
  const propertyTypes = useSearchStore((s) => s.propertyTypes)
  const chipStates = useSearchStore((s) => s.chipStates)
  const setChipState = useSearchStore((s) => s.setChipState)
  const customCriteria = useSearchStore((s) => s.customCriteria)
  const addCustomCriteria = useSearchStore((s) => s.addCustomCriteria)
  const removeCustomCriteria = useSearchStore((s) => s.removeCustomCriteria)
  const setCustomCriteriaState = useSearchStore((s) => s.setCustomCriteriaState)

  const [text, setText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Coach ancré : clé de la pastille coachée + compteur (COACH_MAX fois) ───
  const [coachKey, setCoachKey] = useState<string | null>(null)
  const coachShownRef = useRef(0)
  const coach = (key: string) => {
    if (coachShownRef.current >= COACH_MAX) return
    coachShownRef.current += 1
    setCoachKey(key) // reste affichée jusqu'à la fermeture manuelle (×)
  }

  // « L'immeuble » masqué uniquement si maison SEULE (parité web).
  const showBuilding = useMemo(
    () => !(propertyTypes.length === 1 && propertyTypes[0] === 'maison'),
    [propertyTypes],
  )

  const cataloguePropertyTags = PROPERTY_TAGS.filter((t) => (chipStates[t] ?? 0) === 0)
  const catalogueBuildingTags = BUILDING_TAGS.filter((t) => (chipStates[t] ?? 0) === 0)
  const selectedCatalogue = [...PROPERTY_TAGS, ...BUILDING_TAGS]
    .map((label) => ({ label, state: (chipStates[label] ?? 0) as ChipState }))
    .filter((c) => c.state > 0)
  const hasSelection = selectedCatalogue.length > 0 || customCriteria.length > 0

  const canAdd = text.trim().length >= 3 && !analyzing

  // Ajout catalogue → OBLIGATOIRE + coach ancré sur la pastille (désormais en bas).
  const addCatalogue = (tag: string) => {
    setChipState(tag, DEFAULT_STATE)
    coach(`sel-${tag}`)
  }
  const cycleCatalogue = (label: string, state: ChipState) => {
    setChipState(label, nextState(state))
    coach(`sel-${label}`)
  }
  const cycleCustom = (id: string, state: ChipState) => {
    setCustomCriteriaState(id, nextState(state))
    coach(`custom-${id}`)
  }

  const handleAdd = async () => {
    if (!canAdd) return
    const input = text.trim()
    setAnalyzing(true)
    setError(null)
    try {
      const res = await apiFetch('/api/criteria/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error('analyze failed')
      const items = Array.isArray(data?.criteria)
        ? (data.criteria as { label?: unknown; type?: unknown }[])
            .filter(
              (c): c is { label: string; type: 'positive' | 'negative' } =>
                typeof c.label === 'string' &&
                c.label.trim().length > 0 &&
                (c.type === 'positive' || c.type === 'negative'),
            )
            .map((c) =>
              c.type === 'negative'
                ? { label: c.label, state: 3 as ChipState, polarity: 'negative' as const }
                : { label: c.label, state: DEFAULT_STATE, polarity: 'positive' as const },
            )
        : []
      if (items.length === 0) {
        setError("Je n'ai pas réussi à interpréter. Reformulez en une phrase.")
      } else {
        addCustomCriteria(items)
        setText('')
      }
    } catch {
      setError('Erreur réseau. Réessayez.')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <View style={styles.root}>
      <StepHeader title="Vos préférences" subtitle="Quelques nuances pour affiner votre recherche." />

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Légende COLORÉE — première chose visible, sous le titre */}
        <View style={styles.legend}>
          {LEGEND.map((l) => {
            const st = LEGEND_STYLE[l.state]
            return (
              <View
                key={l.label}
                style={[styles.legendChip, { backgroundColor: st.bg, borderColor: st.border }]}
              >
                {l.icon === 'plus' && <Plus size={10} strokeWidth={2.8} color={st.fg} />}
                {l.icon === 'check' && <Check size={10} strokeWidth={2.8} color={st.fg} />}
                {l.icon === 'x' && <X size={10} strokeWidth={2.8} color={st.fg} />}
                <Text
                  style={[
                    styles.legendTxt,
                    { color: st.fg, textDecorationLine: l.state === 3 ? 'line-through' : 'none' },
                  ]}
                >
                  {l.label}
                </Text>
              </View>
            )
          })}
        </View>

        {/* Catalogue : Le bien */}
        {cataloguePropertyTags.length > 0 && (
          <View style={styles.section}>
            <SectionLabel>Le bien</SectionLabel>
            <View style={styles.chipWrap}>
              {cataloguePropertyTags.map((tag) => (
                <CriteriaChip key={tag} label={tag} state={0} onPress={() => addCatalogue(tag)} />
              ))}
            </View>
          </View>
        )}

        {/* Catalogue : L'immeuble */}
        {showBuilding && catalogueBuildingTags.length > 0 && (
          <View style={styles.section}>
            <SectionLabel>L&apos;immeuble</SectionLabel>
            <View style={styles.chipWrap}>
              {catalogueBuildingTags.map((tag) => (
                <CriteriaChip key={tag} label={tag} state={0} onPress={() => addCatalogue(tag)} />
              ))}
            </View>
          </View>
        )}

        {/* Champ critère libre — sous le catalogue, au-dessus de la sélection */}
        <View style={styles.section}>
          <View style={styles.inputWrap}>
            <TextInput
              value={text}
              onChangeText={(t) => {
                setText(t)
                if (error) setError(null)
              }}
              placeholder="Autre critère ? Décrivez-le…"
              placeholderTextColor="#a3a3a3"
              style={styles.input}
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={handleAdd}
            />
            <Pressable
              onPress={handleAdd}
              disabled={!canAdd}
              style={[styles.addBtn, { backgroundColor: canAdd ? ACCENT : 'rgba(0,0,0,0.07)' }]}
              hitSlop={8}
            >
              {analyzing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ArrowRight size={16} color={canAdd ? '#fff' : 'rgba(0,0,0,0.35)'} />
              )}
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        {/* Sélection — bulle coach ancrée sur la pastille concernée */}
        {hasSelection && (
          <View style={styles.section}>
            <SectionLabel>Vos critères</SectionLabel>
            <View style={styles.chipWrap}>
              {selectedCatalogue.map((c) => {
                const key = `sel-${c.label}`
                return (
                  <CoachAnchor key={key} show={coachKey === key} onClose={() => setCoachKey(null)}>
                    <CriteriaChip
                      label={c.label}
                      state={c.state}
                      onPress={() => cycleCatalogue(c.label, c.state)}
                      onRemove={() => setChipState(c.label, 0)}
                    />
                  </CoachAnchor>
                )
              })}
              {customCriteria.map((c) => {
                const key = `custom-${c.id}`
                return (
                  <CoachAnchor key={key} show={coachKey === key} onClose={() => setCoachKey(null)}>
                    <CriteriaChip
                      label={c.label}
                      state={(c.state > 0 ? c.state : DEFAULT_STATE) as ChipState}
                      onPress={() => cycleCustom(c.id, c.state)}
                      onRemove={() => removeCustomCriteria(c.id)}
                    />
                  </CoachAnchor>
                )
              })}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Valider mes critères" onPress={onNext} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: 24, paddingBottom: 24 },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2, marginBottom: 2 },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  legendTxt: { fontSize: 10, fontWeight: '600' },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.09)',
    borderRadius: 999,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 5,
  },
  input: { flex: 1, fontSize: 16, color: INK, paddingVertical: 6 },
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 12, color: '#B23228', marginTop: 8 },

  section: { marginTop: 22 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // Coach ancré au-dessus de la pastille
  coachHost: { position: 'relative' },
  coachWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    alignItems: 'center',
    zIndex: 20,
  },
  coachPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 288,
    backgroundColor: 'rgba(26,26,26,0.94)',
    borderRadius: 12,
    paddingLeft: 13,
    paddingRight: 8,
    paddingVertical: 8,
  },
  coachTextCol: { flexShrink: 1 },
  coachTxt: { color: '#fff', fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  coachSub: { color: 'rgba(255,255,255,0.78)', fontSize: 11, lineHeight: 15, marginTop: 2 },
  coachClose: { padding: 2 },
  coachArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(26,26,26,0.94)',
    marginTop: -1,
  },

  footer: { paddingHorizontal: 24, paddingTop: 12 },
})
