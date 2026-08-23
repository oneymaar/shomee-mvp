/**
 * Étape 4 — Critères.
 *
 * ORDRE DE LECTURE (refonte du 23/08, retour d'Olivier) :
 *   1) légende colorée ;
 *   2) « VOS CRITÈRES » — la sélection, EN HAUT, sur un socle sable ;
 *   3) catalogue « Le bien » / « L'immeuble » ;
 *   4) champ de critère personnalisé.
 * La sélection était auparavant tout en bas : passé quelques critères, il
 * fallait scroller pour voir ce qu'on avait choisi. Elle est désormais la
 * première chose sous la légende, et chaque ajout vient s'y poser avec une
 * animation — le bloc s'ouvre pour faire la place au lieu de sauter.
 *
 * Une pastille ajoutée part en OBLIGATOIRE (état 2) ; le re-tap cycle
 * obligatoire → souhaité → rédhibitoire. Un coach ANCRÉ au-dessus de la
 * pastille s'affiche la première fois pour expliquer le re-tap.
 *
 * MODE FOCUS : toucher le champ personnalisé ouvre un plein écran où il ne
 * reste que le champ, les pastilles déjà saisies et le clavier. On enchaîne
 * autant de critères qu'on veut (flèche = valider celui-ci), puis « Valider »
 * en haut à droite ferme le mode.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Animated, { Easing, LinearTransition, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowRight, Check, Plus, X } from 'lucide-react-native'
import type { ChipState } from '@shomee/core/stores/searchStore'
import { useSearchStore } from '@/lib/stores'
import { apiFetch } from '@/lib/api'
import { PROPERTY_TAGS, BUILDING_TAGS } from '@/lib/onboardingCatalog'
import { CriteriaChip, CHIP_STATE_STYLES } from './CriteriaChip'
import { PrimaryButton, SectionLabel, StepHeader, ACCENT, INK } from './ui'
import { colors, fonts, radii } from '@/lib/theme'

// Défaut d'ajout = OBLIGATOIRE (2). Re-tap : 2 → 1 → 3 → 2.
const DEFAULT_STATE: ChipState = 2
function nextState(s: ChipState): ChipState {
  return s === 2 ? 1 : s === 1 ? 3 : 2
}

/**
 * Entrée d'une pastille dans « VOS CRITÈRES » : elle MONTE à sa place et se
 * pose. Rien d'autre.
 *
 * ⚠️ AUCUN REBOND, AUCUN DÉPASSEMENT — règle absolue posée par Olivier, deux
 * fois : « le bounce, je n'aime pas du tout, ça ne fait pas du tout premium,
 * c'est même un peu agressif ». La règle ne souffre PAS d'exception « petits
 * éléments » : ni ressort, ni `springify`, nulle part dans l'app.
 * Glissé pur en easeOutQuad : arrive vite, se pose doucement, s'arrête net.
 */
const RISE = 16
const CHIP_IN = () => {
  'worklet'
  return {
    initialValues: { opacity: 0, transform: [{ translateY: RISE }] },
    animations: {
      opacity: withTiming(1, { duration: 220 }),
      transform: [
        { translateY: withTiming(0, { duration: 380, easing: Easing.out(Easing.quad) }) },
      ],
    },
  }
}
/** Le bloc s'ouvre pour faire la place — glissé pur lui aussi. */
const GROW = LinearTransition.duration(300).easing(Easing.out(Easing.quad))

// Légende = la palette RÉELLE des pastilles, importée. Une copie locale
// finissait toujours par diverger de CriteriaChip.
const LEGEND_STYLE: Record<1 | 2 | 3, { bg: string; fg: string; border: string }> = {
  1: CHIP_STATE_STYLES[1],
  2: CHIP_STATE_STYLES[2],
  3: CHIP_STATE_STYLES[3],
}
// ORDRE IMPOSÉ : celui du cycle au toucher (1er tap = obligatoire, puis
// souhaité, puis rédhibitoire). La légende doit se lire dans l'ordre où les
// états se succèdent sous le doigt, sinon elle décrit autre chose que le geste.
const LEGEND: Array<{ state: 1 | 2 | 3; label: string; icon: 'plus' | 'check' | 'x' }> = [
  { state: 2, label: 'Obligatoire', icon: 'check' },
  { state: 1, label: 'Souhaité', icon: 'plus' },
  { state: 3, label: 'Rédhibitoire', icon: 'x' },
]

const EDGE = 12 // marge mini entre la bulle et le bord de l'écran
const SCREEN_W = Dimensions.get('window').width
const BUBBLE_W = Math.min(300, SCREEN_W - EDGE * 2)

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
  const hostRef = useRef<View>(null)
  // { left } = position horizontale de la bulle relative au chip ; { arrow } =
  // position de la flèche dans la bulle (toujours pointée sur la pastille).
  const [pos, setPos] = useState<{ left: number; arrow: number } | null>(null)

  useEffect(() => {
    if (!show) {
      setPos(null)
      return
    }
    // Mesure APRÈS layout : on recale la bulle pour qu'elle reste dans l'écran.
    const id = requestAnimationFrame(() => {
      hostRef.current?.measureInWindow((x, _y, w) => {
        const chipCenter = x + w / 2
        const clampedLeft = Math.max(
          EDGE,
          Math.min(chipCenter - BUBBLE_W / 2, SCREEN_W - EDGE - BUBBLE_W),
        )
        const arrow = Math.max(16, Math.min(chipCenter - clampedLeft, BUBBLE_W - 16))
        setPos({ left: clampedLeft - x, arrow })
      })
    })
    return () => cancelAnimationFrame(id)
  }, [show])

  return (
    <View ref={hostRef} style={styles.coachHost} collapsable={false}>
      {children}
      {show && pos && (
        <View pointerEvents="box-none" style={[styles.coachWrap, { left: pos.left }]}>
          <View style={styles.coachPill}>
            <View style={styles.coachTextCol}>
              <Text style={styles.coachTxt}>Recliquez ici pour changer son statut</Text>
              <Text style={styles.coachSub}>obligatoire → souhaité → rédhibitoire</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.coachClose}>
              <X size={13} strokeWidth={2.6} color="rgba(246,237,230,0.85)" />
            </Pressable>
          </View>
          <View style={[styles.coachArrow, { marginLeft: pos.arrow - 6 }]} />
        </View>
      )}
    </View>
  )
}

export function StepCriteres({ onNext }: { onNext: () => void }) {
  const insets = useSafeAreaInsets()
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
  const [focusOpen, setFocusOpen] = useState(false)

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
  const selectionCount = selectedCatalogue.length + customCriteria.length

  const canAdd = text.trim().length >= 3 && !analyzing

  // Ajout catalogue → OBLIGATOIRE + coach ancré sur la pastille (en haut).
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

  const openFocus = () => {
    setError(null)
    setFocusOpen(true)
  }
  const closeFocus = () => {
    setFocusOpen(false)
    setText('')
    setError(null)
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
        setText('') // le champ se vide : on enchaîne le critère suivant
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

      {/* Légende — DANS l'en-tête FIXE, pas dans le scroll. Elle explique le
          geste (toucher pour alterner) : elle doit rester visible pendant qu'on
          touche les pastilles, sinon elle ne sert plus à rien passé le premier
          défilement. */}
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

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── VOS CRITÈRES — en haut, sur un socle sable qui le détache du
            catalogue : c'est SA sélection, pas une liste de plus. Le bloc
            s'ouvre tout seul (GROW) quand une pastille arrive. ── */}
        {hasSelection && (
          <Animated.View layout={GROW} style={styles.mine}>
            <View style={styles.mineHead}>
              <Text style={styles.mineTitle}>VOS CRITÈRES</Text>
              <Text style={styles.mineCount}>{selectionCount}</Text>
            </View>
            <Animated.View layout={GROW} style={styles.chipWrap}>
              {selectedCatalogue.map((c) => {
                const key = `sel-${c.label}`
                return (
                  <Animated.View key={key} entering={CHIP_IN} layout={GROW}>
                    <CoachAnchor show={coachKey === key} onClose={() => setCoachKey(null)}>
                      <CriteriaChip
                        label={c.label}
                        state={c.state}
                        onPress={() => cycleCatalogue(c.label, c.state)}
                        onRemove={() => setChipState(c.label, 0)}
                      />
                    </CoachAnchor>
                  </Animated.View>
                )
              })}
              {customCriteria.map((c) => {
                const key = `custom-${c.id}`
                return (
                  <Animated.View key={key} entering={CHIP_IN} layout={GROW}>
                    <CoachAnchor show={coachKey === key} onClose={() => setCoachKey(null)}>
                      <CriteriaChip
                        label={c.label}
                        state={(c.state > 0 ? c.state : DEFAULT_STATE) as ChipState}
                        onPress={() => cycleCustom(c.id, c.state)}
                        onRemove={() => removeCustomCriteria(c.id)}
                      />
                    </CoachAnchor>
                  </Animated.View>
                )
              })}
            </Animated.View>
          </Animated.View>
        )}

        {/* Catalogue : Le bien */}
        {cataloguePropertyTags.length > 0 && (
          <Animated.View layout={GROW} style={styles.section}>
            <SectionLabel>Le bien</SectionLabel>
            <View style={styles.chipWrap}>
              {cataloguePropertyTags.map((tag) => (
                <CriteriaChip key={tag} label={tag} state={0} onPress={() => addCatalogue(tag)} />
              ))}
            </View>
          </Animated.View>
        )}

        {/* Catalogue : L'immeuble */}
        {showBuilding && catalogueBuildingTags.length > 0 && (
          <Animated.View layout={GROW} style={styles.section}>
            <SectionLabel>L&apos;immeuble</SectionLabel>
            <View style={styles.chipWrap}>
              {catalogueBuildingTags.map((tag) => (
                <CriteriaChip key={tag} label={tag} state={0} onPress={() => addCatalogue(tag)} />
              ))}
            </View>
          </Animated.View>
        )}

        {/* Champ critère libre — il n'édite PAS sur place : le toucher ouvre le
            mode focus, où l'écran s'efface au profit du champ et du clavier. */}
        <Animated.View layout={GROW} style={styles.section}>
          <Pressable onPress={openFocus} style={styles.inputWrap}>
            <Text style={styles.inputPlaceholder}>Autre critère ? Décrivez-le…</Text>
            <View style={[styles.addBtn, { backgroundColor: ACCENT }]}>
              <ArrowRight size={16} color={colors.creamOnDark} />
            </View>
          </Pressable>
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Valider mes critères" onPress={onNext} />
      </View>

      {/* ═══════════════ MODE FOCUS ═══════════════ */}
      <Modal
        visible={focusOpen}
        animationType="fade"
        onRequestClose={closeFocus}
        presentationStyle="fullScreen"
      >
        <View style={[styles.focusRoot, { paddingTop: insets.top + 6, paddingBottom: insets.bottom }]}>
          <View style={styles.focusBar}>
            <Text style={styles.focusLabel}>VOS CRITÈRES</Text>
            <Pressable onPress={closeFocus} style={styles.focusOk} hitSlop={8}>
              <Check size={15} strokeWidth={2.6} color={colors.creamOnDark} />
              <Text style={styles.focusOkTxt}>Valider</Text>
            </Pressable>
          </View>

          {/* Le vide : c'est lui qui fait le « mode focus ». Rien d'autre à
              regarder que ce qu'on écrit. */}
          <View style={styles.focusVoid} />

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.focusZone}>
              {/* Les pastilles JUSTE au-dessus du champ : l'œil reste où le
                  doigt travaille (choix validé le 23/08). */}
              {customCriteria.length > 0 && (
                <Animated.View layout={GROW} style={styles.focusChips}>
                  {customCriteria.map((c) => (
                    <Animated.View key={c.id} entering={CHIP_IN} layout={GROW}>
                      <CriteriaChip
                        label={c.label}
                        state={(c.state > 0 ? c.state : DEFAULT_STATE) as ChipState}
                        onPress={() => cycleCustom(c.id, c.state)}
                        onRemove={() => removeCustomCriteria(c.id)}
                      />
                    </Animated.View>
                  ))}
                </Animated.View>
              )}

              <View style={styles.focusField}>
                <TextInput
                  value={text}
                  onChangeText={(t) => {
                    setText(t)
                    if (error) setError(null)
                  }}
                  placeholder="Décrivez un critère…"
                  placeholderTextColor="#B7A99D"
                  style={styles.focusInput}
                  autoFocus
                  autoCorrect={false}
                  returnKeyType="send"
                  // Le clavier NE se ferme PAS à la validation : on enchaîne.
                  blurOnSubmit={false}
                  onSubmitEditing={handleAdd}
                />
                <Pressable
                  onPress={handleAdd}
                  disabled={!canAdd}
                  style={[styles.focusGo, { backgroundColor: canAdd ? ACCENT : colors.sand }]}
                  hitSlop={8}
                >
                  {analyzing ? (
                    <ActivityIndicator color={colors.creamOnDark} size="small" />
                  ) : (
                    <ArrowRight size={18} color={canAdd ? colors.creamOnDark : colors.muted} />
                  )}
                </Pressable>
              </View>

              {error ? (
                <Text style={styles.focusError}>{error}</Text>
              ) : (
                <Text style={styles.focusHint}>
                  Ajoutez-en autant que vous voulez — validez chacun avec la flèche.
                </Text>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: 22, paddingBottom: 24 },

  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    paddingHorizontal: 22,
    marginTop: -6,
    marginBottom: 10,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  legendTxt: { fontSize: 10, fontWeight: '600' },

  // Le socle de la sélection — sable très dilué + filet : présent sans peser.
  mine: {
    marginTop: 4,
    backgroundColor: 'rgba(239,226,213,0.55)',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 14,
  },
  mineHead: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginBottom: 10 },
  mineTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.terracotta,
    letterSpacing: 2.2,
  },
  mineCount: { fontFamily: fonts.serif, fontSize: 15, color: colors.terracotta },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.pill,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 5,
  },
  inputPlaceholder: { flex: 1, fontSize: 13.5, color: '#B7A99D', paddingVertical: 6 },
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  section: { marginTop: 22 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // ── Mode focus ──
  focusRoot: { flex: 1, backgroundColor: colors.cream },
  focusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 6,
  },
  focusLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 2.6, color: colors.muted },
  focusOk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.terracotta,
    shadowColor: colors.terracotta,
    shadowOpacity: 0.26,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  focusOkTxt: { color: colors.creamOnDark, fontSize: 13.5, fontWeight: '600' },
  focusVoid: { flex: 1 },
  focusZone: { paddingHorizontal: 22, paddingBottom: 10 },
  focusChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  focusField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.terracotta,
    borderRadius: radii.pill,
    paddingLeft: 18,
    paddingRight: 5,
    paddingVertical: 5,
    shadowColor: colors.terracotta,
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  focusInput: { flex: 1, fontSize: 15.5, color: INK, fontWeight: '500', paddingVertical: 8 },
  focusGo: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  focusHint: { marginTop: 11, fontSize: 11.5, color: '#B7A99D', textAlign: 'center' },
  focusError: { marginTop: 11, fontSize: 12, color: '#B0442C', textAlign: 'center' },

  // Coach ancré au-dessus de la pastille
  coachHost: { position: 'relative' },
  coachWrap: {
    // Largeur fixe ; `left` est calculé dynamiquement (mesure) pour rester
    // toujours dans l'écran. La pastille peut être n'importe où.
    position: 'absolute',
    bottom: '100%',
    width: BUBBLE_W,
    zIndex: 20,
  },
  coachPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(23,18,16,0.94)',
    borderRadius: 12,
    paddingLeft: 13,
    paddingRight: 8,
    paddingVertical: 9,
  },
  coachTextCol: { flex: 1 },
  coachTxt: { color: colors.creamOnDark, fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  coachSub: { color: 'rgba(246,237,230,0.78)', fontSize: 11, lineHeight: 15, marginTop: 2 },
  coachClose: { padding: 2 },
  coachArrow: {
    alignSelf: 'flex-start',
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(23,18,16,0.94)',
    marginTop: -1,
  },

  footer: { paddingHorizontal: 22, paddingTop: 12 },
})
