/**
 * Intercalaire « faire évoluer ma recherche » (P6).
 *
 * Règle de composition, posée après le retour « c'est trop compliqué, il y a
 * beaucoup trop d'informations, c'est illisible » : UN écran = UN constat, UN
 * geste, UN bouton. Quatre blocs, pas un de plus :
 *
 *   1. TITRE    — le constat, en gros, tout en haut. C'est l'information n°1.
 *   2. LEAD     — une seule phrase grise : ce qui bloque + le geste proposé.
 *   3. CONTRÔLE — l'élément d'onboarding correspondant, pré-positionné.
 *   4. ACTIONS  — « Appliquer et relancer », puis « Revoir mon brief ».
 *
 * Ce qui a été retiré, et pourquoi :
 *   · la légende des quatre états — elle vient d'être vue à l'onboarding, et
 *     l'état est désormais ÉCRIT sur la pastille elle-même ;
 *   · les phrases d'aide sous chaque contrôle — le geste est évident dès lors
 *     qu'un seul contrôle occupe l'écran ;
 *   · le bloc « disponibilité estimée » — deux appels API et six lignes de
 *     texte pour une information que personne ne lit à cet instant ;
 *   · les « autres pistes » — si le diagnostic tombe à côté, la sortie n'est
 *     pas une seconde liste de pistes, c'est le brief complet ;
 *   · le récapitulatif « modifications en attente » — l'état d'après est déjà
 *     lisible SUR le contrôle (mot écrit sur la pastille, valeur en terracotta).
 *
 * Invariant produit intact : rien n'est écrit dans le searchStore tant que
 * « Appliquer et relancer » n'a pas été pressé — l'implicite ne modifie jamais
 * silencieusement le déclaratif.
 *
 * Garde-fou conservé — ZONES : on ne propose QUE d'ajouter des arrondissements
 * limitrophes, jamais d'en retirer. `setSelectedArrs` n'écrit que
 * `selectedArrIds`, alors que /api/feed/generate résout la zone cible en UNION
 * des arrondissements, IRIS et quartiers du snapshot : un retrait ici
 * reviendrait par les IRIS, soit un geste sans effet visible.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, Plus, X } from 'lucide-react-native'
import type { ChipState } from '@shomee/core/stores/searchStore'
import { useSearchStore } from '@/lib/stores'
import {
  BUDGET_SCALE,
  BUDGET_MAX_INDEX,
  budgetIndex,
  formatBudget,
  SURFACE_SCALE,
  SURFACE_MAX_INDEX,
  surfaceIndex,
  formatSurface,
} from '@/lib/scales'
import { RangeSlider } from '@/components/onboarding/RangeSlider'
import { ACCENT, ACCENT_DISABLED, BG, INK, MUTED } from '@/components/onboarding/ui'
import {
  allCriteria,
  arrLabel,
  suggestBudgetMax,
  suggestMinSurface,
  suggestNeighbourArrs,
  type CriteriaEntry,
  type Diagnosis,
  type DiagnosisTrigger,
  type LeverKind,
} from '@/lib/searchDiagnosis'

// Vocabulaire des états — strictement celui de l'onboarding.
const STATE_LABEL: Record<ChipState, string> = {
  0: 'retiré',
  1: 'souhaité',
  2: 'obligatoire',
  3: 'rédhibitoire',
}

/**
 * Palette des pastilles. Reprise de l'onboarding, à une correction près : le
 * gris du rédhibitoire y est très clair (#9a9a9a sur #f3f0ee, ~2,4:1) parce
 * qu'il n'y signale qu'un état parmi d'autres. Ici le rédhibitoire EST le sujet
 * de l'écran — il est assombri à ~4,5:1 pour rester lisible.
 */
const CHIP_STYLE: Record<ChipState, { bg: string; fg: string; border: string }> = {
  0: { bg: '#ffffff', fg: '#1a1a1a', border: 'rgba(0,0,0,0.09)' },
  1: { bg: '#fdf0ed', fg: '#9b4a2e', border: '#e8907a' },
  2: { bg: '#C1533A', fg: '#ffffff', border: '#C1533A' },
  3: { bg: '#f1ecea', fg: '#6b6461', border: 'rgba(0,0,0,0.16)' },
}

// Le titre est la première chose lue : il dit ce qui s'est passé, rien d'autre.
const HEADLINE: Record<DiagnosisTrigger, string> = {
  empty: 'Aucun bien ne correspond à votre recherche',
  starving: 'Vous avez vu tous les biens qui correspondent',
  streak: 'Faisons évoluer votre recherche',
}

interface Staged {
  budgetMin: number | null
  budgetMax: number | null
  minSurface: number | null
  maxSurface: number | null
  arrIds: string[]
  /** État par critère — clé = `CriteriaEntry.key`. */
  criteria: Record<string, ChipState>
}

export interface AppliedChange {
  lever: LeverKind
  /** Résumé lisible — envoyé au tracker, précieux en debug. */
  summary: string
}

/**
 * Pastille auto-descriptive : l'état est écrit dessus, donc aucune légende
 * n'est nécessaire. Le libellé peut être long (critère personnalisé saisi par
 * l'acquéreur) : il se rétracte et passe à la ligne plutôt que de déborder.
 */
function Pastille({
  label,
  state,
  onPress,
  accessibilityLabel,
}: {
  label: string
  state: ChipState
  onPress: () => void
  accessibilityLabel: string
}) {
  const st = CHIP_STYLE[state]
  const Icon = state === 3 ? X : state === 2 ? Check : Plus
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: st.bg, borderColor: st.border },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Icon size={12} strokeWidth={3} color={st.fg} />
      <Text style={[styles.pillLabel, { color: st.fg }]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[styles.pillState, { color: st.fg }]} numberOfLines={1}>
        {STATE_LABEL[state]}
      </Text>
    </Pressable>
  )
}

export function FeedSuggestion({
  diagnosis,
  onApply,
  onDismiss,
  onEditBrief,
}: {
  diagnosis: Diagnosis
  onApply: (change: AppliedChange) => void
  /** Croix en haut à droite — sortir sans rien changer. */
  onDismiss: () => void
  /**
   * « Revoir mon brief » : la sortie quand notre proposition n'est pas la
   * bonne. Optionnelle — sans elle, le bouton n'est simplement pas rendu.
   */
  onEditBrief?: () => void
}) {
  const insets = useSafeAreaInsets()

  // Photo du store au montage : la référence « avant » ne doit pas bouger sous
  // les pieds de l'écran pendant qu'on manipule les contrôles.
  const base = useRef(useSearchStore.getState()).current
  const baseCriteria = useMemo<CriteriaEntry[]>(() => allCriteria(base), [base])

  // Seuls les critères DURS peuvent bloquer une recherche : ce sont les seuls
  // montrés. Rédhibitoires d'abord — ils excluent à eux seuls, obligatoires
  // ensuite. Les « souhaités » ne coûtent aucun bien : les afficher n'ajouterait
  // que du bruit, et le brief complet reste à un bouton d'ici.
  const blocking = useMemo(
    () =>
      baseCriteria
        .filter((c) => c.state === 2 || c.state === 3)
        .sort((a, b) => b.state - a.state),
    [baseCriteria],
  )

  const lever = diagnosis.primary.kind

  const [staged, setStaged] = useState<Staged>(() => ({
    budgetMin: base.budgetMin,
    budgetMax: base.budgetMax,
    minSurface: base.minSurface,
    maxSurface: base.maxSurface,
    arrIds: [...base.selectedArrIds],
    criteria: Object.fromEntries(baseCriteria.map((c) => [c.key, c.state])),
  }))

  // Pré-positionnement de la suggestion, une seule fois au montage : l'écran
  // arrive déjà porteur d'une proposition, sinon « Appliquer » resterait grisé
  // et l'écran serait un cul-de-sac.
  const primed = useRef(false)
  useEffect(() => {
    if (primed.current) return
    primed.current = true
    setStaged((prev) => {
      if (lever === 'budget') return { ...prev, budgetMax: suggestBudgetMax(prev.budgetMax) }
      if (lever === 'surface') return { ...prev, minSurface: suggestMinSurface(prev.minSurface) }
      if (lever === 'zone') {
        const next = suggestNeighbourArrs(prev.arrIds, 1)[0]
        return next && !prev.arrIds.includes(next)
          ? { ...prev, arrIds: [...prev.arrIds, next] }
          : prev
      }
      // Critères : on vise le frein le plus fort (rédhibitoire) et on propose
      // le geste le plus réversible — le passage en « souhaité ».
      const first = blocking[0]
      return first ? { ...prev, criteria: { ...prev.criteria, [first.key]: 1 } } : prev
    })
  }, [lever, blocking])

  // Bascule binaire et réversible : « souhaité » ⇄ état d'origine. Pas de cycle
  // à trois temps, donc rien à mémoriser ni à deviner.
  const toggleCriterion = useCallback((c: CriteriaEntry) => {
    setStaged((p) => {
      const cur = p.criteria[c.key] ?? c.state
      return { ...p, criteria: { ...p.criteria, [c.key]: cur === 1 ? c.state : 1 } }
    })
  }, [])

  // Résumé des modifications — plus affiché (l'état d'après se lit sur le
  // contrôle), mais toujours calculé : c'est lui qui part au tracker.
  const changes = useMemo(() => {
    const out: string[] = []
    if (staged.budgetMax !== base.budgetMax) {
      out.push(
        `Budget max : ${formatBudget(base.budgetMax ?? 0)} → ${formatBudget(staged.budgetMax ?? 0)}`,
      )
    }
    if (staged.budgetMin !== base.budgetMin) {
      out.push(
        `Budget min : ${formatBudget(base.budgetMin ?? 0)} → ${formatBudget(staged.budgetMin ?? 0)}`,
      )
    }
    if (staged.minSurface !== base.minSurface) {
      out.push(
        `Surface min : ${formatSurface(base.minSurface ?? 0)} → ${formatSurface(staged.minSurface ?? 0)}`,
      )
    }
    if (staged.maxSurface !== base.maxSurface) {
      out.push(
        `Surface max : ${formatSurface(base.maxSurface ?? 0)} → ${formatSurface(staged.maxSurface ?? 0)}`,
      )
    }
    const added = staged.arrIds.filter((id) => !base.selectedArrIds.includes(id))
    if (added.length > 0) {
      out.push(
        `Secteur${added.length > 1 ? 's' : ''} ajouté${added.length > 1 ? 's' : ''} : ${added.map(arrLabel).join(', ')}`,
      )
    }
    for (const c of baseCriteria) {
      const next = staged.criteria[c.key] ?? 0
      if (next === c.state) continue
      out.push(`« ${c.label} » : ${STATE_LABEL[c.state]} → ${STATE_LABEL[next]}`)
    }
    return out
  }, [staged, base, baseCriteria])

  const dirty = changes.length > 0

  const apply = useCallback(() => {
    if (!dirty) return
    const s = useSearchStore.getState()
    if (staged.budgetMin !== base.budgetMin || staged.budgetMax !== base.budgetMax) {
      s.setBudgetRange(staged.budgetMin, staged.budgetMax)
    }
    if (staged.minSurface !== base.minSurface || staged.maxSurface !== base.maxSurface) {
      s.setSurface(staged.minSurface, staged.maxSurface)
    }
    // Ajout pur (cf. en-tête) : l'union côté serveur rend le geste toujours effectif.
    if (staged.arrIds.length !== base.selectedArrIds.length) s.setSelectedArrs(staged.arrIds)
    for (const c of baseCriteria) {
      const next = staged.criteria[c.key] ?? 0
      if (next === c.state) continue
      if (c.source === 'catalog') s.setChipState(c.label, next)
      else if (next === 0) s.removeCustomCriteria(c.key)
      else s.setCustomCriteriaState(c.key, next)
    }
    onApply({ lever, summary: changes.join(' · ') })
  }, [dirty, staged, base, baseCriteria, changes, lever, onApply])

  const neighbours = useMemo(() => suggestNeighbourArrs(base.selectedArrIds, 6), [base])
  const addedArrs = useMemo(
    () => staged.arrIds.filter((id) => !base.selectedArrIds.includes(id)),
    [staged.arrIds, base],
  )
  const openNeighbours = useMemo(
    () => neighbours.filter((id) => !staged.arrIds.includes(id)),
    [neighbours, staged.arrIds],
  )

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={onDismiss}
          hitSlop={14}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Fermer sans rien modifier"
        >
          <X size={20} color={MUTED} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{HEADLINE[diagnosis.trigger]}</Text>
        <Text style={styles.lead}>{diagnosis.primary.lead}</Text>

        <View style={styles.control}>
          {lever === 'budget' && (
            <>
              <View style={styles.minMax}>
                <View style={styles.minMaxCol}>
                  <Text style={styles.minMaxCap}>Minimum</Text>
                  <Text style={styles.minMaxVal} numberOfLines={1} adjustsFontSizeToFit>
                    {formatBudget(staged.budgetMin ?? BUDGET_SCALE[0])}
                  </Text>
                </View>
                <View style={[styles.minMaxCol, styles.minMaxColRight]}>
                  <Text style={styles.minMaxCap}>Maximum</Text>
                  <Text
                    style={[
                      styles.minMaxVal,
                      staged.budgetMax !== base.budgetMax && styles.minMaxValChanged,
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {formatBudget(staged.budgetMax ?? 0)}
                  </Text>
                </View>
              </View>
              <RangeSlider
                min={0}
                max={BUDGET_MAX_INDEX}
                step={1}
                low={budgetIndex(staged.budgetMin ?? BUDGET_SCALE[0])}
                high={budgetIndex(staged.budgetMax ?? BUDGET_SCALE[BUDGET_MAX_INDEX])}
                minGap={1}
                onChange={(lo, hi) =>
                  setStaged((p) => ({ ...p, budgetMin: BUDGET_SCALE[lo], budgetMax: BUDGET_SCALE[hi] }))
                }
              />
            </>
          )}

          {lever === 'surface' && (
            <>
              <View style={styles.minMax}>
                <View style={styles.minMaxCol}>
                  <Text style={styles.minMaxCap}>Minimum</Text>
                  <Text
                    style={[
                      styles.minMaxVal,
                      staged.minSurface !== base.minSurface && styles.minMaxValChanged,
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {formatSurface(staged.minSurface ?? SURFACE_SCALE[0])}
                  </Text>
                </View>
                <View style={[styles.minMaxCol, styles.minMaxColRight]}>
                  <Text style={styles.minMaxCap}>Maximum</Text>
                  <Text style={styles.minMaxVal} numberOfLines={1} adjustsFontSizeToFit>
                    {formatSurface(staged.maxSurface ?? SURFACE_SCALE[SURFACE_MAX_INDEX])}
                  </Text>
                </View>
              </View>
              <RangeSlider
                min={0}
                max={SURFACE_MAX_INDEX}
                step={1}
                low={surfaceIndex(staged.minSurface ?? SURFACE_SCALE[0])}
                high={surfaceIndex(staged.maxSurface ?? SURFACE_SCALE[SURFACE_MAX_INDEX])}
                minGap={1}
                onChange={(lo, hi) =>
                  setStaged((p) => ({ ...p, minSurface: SURFACE_SCALE[lo], maxSurface: SURFACE_SCALE[hi] }))
                }
              />
            </>
          )}

          {lever === 'zone' && (
            <View style={styles.stack}>
              {openNeighbours.length === 0 && addedArrs.length === 0 ? (
                <Text style={styles.none}>
                  Tous les arrondissements limitrophes sont déjà dans votre recherche.
                </Text>
              ) : (
                <>
                  {addedArrs.map((id) => (
                    <Pastille
                      key={id}
                      label={arrLabel(id)}
                      state={2}
                      onPress={() =>
                        setStaged((p) => ({ ...p, arrIds: p.arrIds.filter((x) => x !== id) }))
                      }
                      accessibilityLabel={`Retirer le ${arrLabel(id)} de votre recherche`}
                    />
                  ))}
                  {openNeighbours.map((id) => (
                    <Pastille
                      key={id}
                      label={arrLabel(id)}
                      state={0}
                      onPress={() => setStaged((p) => ({ ...p, arrIds: [...p.arrIds, id] }))}
                      accessibilityLabel={`Ajouter le ${arrLabel(id)} à votre recherche`}
                    />
                  ))}
                </>
              )}
            </View>
          )}

          {lever === 'criteria' && (
            <View style={styles.stack}>
              {blocking.length === 0 ? (
                <Text style={styles.none}>
                  Aucun critère ne bloque votre recherche pour l’instant.
                </Text>
              ) : (
                blocking.map((c) => {
                  const st = staged.criteria[c.key] ?? c.state
                  return (
                    <Pastille
                      key={c.key}
                      label={c.label}
                      state={st}
                      onPress={() => toggleCriterion(c)}
                      accessibilityLabel={
                        st === 1
                          ? `${c.label}, souhaité. Toucher pour remettre en ${STATE_LABEL[c.state]}`
                          : `${c.label}, ${STATE_LABEL[c.state]}. Toucher pour passer en souhaité`
                      }
                    />
                  )
                })
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
        <Pressable
          onPress={apply}
          disabled={!dirty}
          accessibilityRole="button"
          accessibilityState={{ disabled: !dirty }}
          style={({ pressed }) => [
            styles.primary,
            !dirty && styles.primaryOff,
            pressed && dirty && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.primaryTxt}>Appliquer et relancer</Text>
        </Pressable>

        {onEditBrief != null && (
          <Pressable
            onPress={onEditBrief}
            hitSlop={8}
            style={styles.ghost}
            accessibilityRole="button"
          >
            <Text style={styles.ghostTxt}>Revoir mon brief</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 14 },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  scroll: { flex: 1 },
  scrollBody: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 },

  title: { fontSize: 27, fontWeight: '800', color: INK, lineHeight: 33, letterSpacing: -0.4 },
  lead: { fontSize: 15, color: MUTED, lineHeight: 22, marginTop: 12 },

  control: { marginTop: 28 },
  // Une pastille par ligne : c'est ce qui les rend lisibles, et ce qui laisse
  // respirer un libellé long sans jamais le tronquer.
  stack: { gap: 10, alignItems: 'flex-start' },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillLabel: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  pillState: { fontSize: 12.5, fontWeight: '500', opacity: 0.72, flexShrink: 0 },

  none: { fontSize: 14, color: MUTED, lineHeight: 20 },

  minMax: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
  minMaxCol: { flex: 1 },
  minMaxColRight: { alignItems: 'flex-end' },
  minMaxCap: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: MUTED,
  },
  minMaxVal: { fontSize: 21, fontWeight: '800', color: INK, marginTop: 2 },
  minMaxValChanged: { color: ACCENT },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.07)',
    backgroundColor: BG,
  },
  primary: {
    height: 52,
    borderRadius: 26,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryOff: { backgroundColor: ACCENT_DISABLED },
  primaryTxt: { fontSize: 16, fontWeight: '700', color: '#fff' },

  ghost: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 8 },
  ghostTxt: { fontSize: 14, fontWeight: '600', color: MUTED, textDecorationLine: 'underline' },
})
