/**
 * Intercalaire « faire évoluer ma recherche » (P6).
 *
 * Règle de composition, posée après le retour « c'est trop compliqué, il y a
 * beaucoup trop d'informations, c'est illisible » : UN écran = UN constat, UN
 * geste, UN bouton. Quatre blocs, pas un de plus :
 *
 *   1. TITRE    — le constat, en gros, tout en haut. C'est l'information n°1.
 *   2. LEAD     — une seule phrase grise, GÉNÉRIQUE : ce qui bloque + le geste
 *                 attendu. Elle ne nomme pas le critère — la pastille juste en
 *                 dessous le porte déjà, le dire deux fois n'apprend rien.
 *   3. CONTRÔLE — l'élément d'onboarding correspondant, dans son ÉTAT RÉEL.
 *   4. SORTIE   — « Ce n'est pas ce qui vous bloque ? » + bouton secondaire
 *                 « Revoir toute ma recherche », dans le flux et non en pied.
 *   5. ACTIONS  — le CTA principal « Appliquer et relancer », seul en pied,
 *                 grisé tant que rien n'a bougé.
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
import { useCallback, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowRight, Check, Plus, X } from 'lucide-react-native'
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
 * Pastille auto-descriptive : l'état est écrit dessus, donc aucune légende n'est
 * nécessaire. Le libellé peut être long (critère personnalisé saisi par
 * l'acquéreur) : il se rétracte et passe à la ligne plutôt que de déborder.
 *
 * `onRemove` ajoute la croix de suppression. Quand elle est là, l'icône d'état
 * disparaît : une pastille rédhibitoire porterait sinon DEUX croix — l'une
 * décorative, l'autre active — indiscernables au doigt. On ne perd rien,
 * l'état est écrit en toutes lettres juste à côté.
 *
 * `stateText` remplace le mot d'état là où le vocabulaire des critères ne veut
 * rien dire : un arrondissement jamais ajouté n'est pas « retiré ».
 */
function Pastille({
  label,
  state,
  stateText,
  onPress,
  onRemove,
  accessibilityLabel,
  removeLabel,
}: {
  label: string
  state: ChipState
  stateText?: string
  onPress: () => void
  onRemove?: () => void
  accessibilityLabel: string
  removeLabel?: string
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
      {onRemove == null && <Icon size={12} strokeWidth={3} color={st.fg} />}
      <Text style={[styles.pillLabel, { color: st.fg }]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[styles.pillState, { color: st.fg }]} numberOfLines={1}>
        {stateText ?? STATE_LABEL[state]}
      </Text>
      {onRemove != null && (
        <Pressable
          onPress={onRemove}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={removeLabel ?? `Retirer ${label}`}
          style={({ pressed }) => [
            styles.pillRemove,
            { borderLeftColor: st.border },
            pressed && { opacity: 0.55 },
          ]}
        >
          <X size={13} strokeWidth={2.5} color={st.fg} />
        </Pressable>
      )}
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
   * « Revoir toute ma recherche » : la sortie quand notre proposition n'est
   * pas la bonne. Optionnelle — sans elle, le bloc n'est simplement pas rendu.
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

  // AUCUN pré-positionnement. Les contrôles arrivent dans l'ÉTAT RÉEL de la
  // recherche : on voit son propre réglage, pas une modification déjà faite en
  // son nom. C'est aussi ce qui donne son sens au bouton grisé — il s'allume au
  // premier geste, donc il confirme qu'on a bien changé quelque chose.
  // Contrepartie assumée : l'écran n'est plus « prêt à appliquer » d'emblée ;
  // la sortie reste « Revoir toute ma recherche », remontée dans le flux.

  // Bascule binaire et réversible : « souhaité » ⇄ état d'origine. Pas de cycle
  // à trois temps, donc rien à mémoriser ni à deviner.
  const toggleCriterion = useCallback((c: CriteriaEntry) => {
    setStaged((p) => {
      const cur = p.criteria[c.key] ?? c.state
      return { ...p, criteria: { ...p.criteria, [c.key]: cur === 1 ? c.state : 1 } }
    })
  }, [])

  // Retirer sans perdre la main : la pastille reste à l'écran, marquée
  // « retiré », et un tap la restaure dans son état d'origine. Comme tout le
  // reste, rien n'est écrit dans la recherche avant « Appliquer et relancer ».
  const removeCriterion = useCallback((c: CriteriaEntry) => {
    setStaged((p) => ({ ...p, criteria: { ...p.criteria, [c.key]: 0 } }))
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
                      stateText="dans ma recherche"
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
                      stateText="ajouter"
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
                      // Pas de croix sur une pastille déjà retirée : il ne reste
                      // qu'un geste, la restaurer.
                      onRemove={st === 0 ? undefined : () => removeCriterion(c)}
                      accessibilityLabel={
                        st === 0
                          ? `${c.label}, retiré. Toucher pour le remettre en ${STATE_LABEL[c.state]}`
                          : st === 1
                            ? `${c.label}, souhaité. Toucher pour remettre en ${STATE_LABEL[c.state]}`
                            : `${c.label}, ${STATE_LABEL[c.state]}. Toucher pour passer en souhaité`
                      }
                      removeLabel={`Retirer ${c.label} de votre recherche`}
                    />
                  )
                })
              )}
            </View>
          )}
        </View>

        {/* Sortie latérale, remontée dans le flux : notre diagnostic peut se
            tromper de levier, et il ne doit pas falloir chercher tout en bas de
            page pour le dire. Bouton à contour, pas plein — « Appliquer et
            relancer » reste le CTA principal de l'écran. */}
        {onEditBrief != null && (
          <View style={styles.aside}>
            <Text style={styles.asideCap}>Ce n’est pas ce qui vous bloque ?</Text>
            <Pressable
              onPress={onEditBrief}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Revoir toute ma recherche"
              style={({ pressed }) => [styles.asideBtn, pressed && { opacity: 0.65 }]}
            >
              <Text style={styles.asideBtnTxt} numberOfLines={1}>
                Revoir toute ma recherche
              </Text>
              <ArrowRight size={16} strokeWidth={2.5} color={ACCENT} />
            </Pressable>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
        <Pressable
          onPress={apply}
          disabled={!dirty}
          accessibilityRole="button"
          accessibilityState={{ disabled: !dirty }}
          accessibilityHint={
            dirty ? undefined : 'Modifiez d’abord un élément ci-dessus pour activer ce bouton.'
          }
          style={({ pressed }) => [
            styles.primary,
            !dirty && styles.primaryOff,
            pressed && dirty && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.primaryTxt}>Appliquer et relancer</Text>
        </Pressable>
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
  // Séparée par un filet vertical : on doit voir qu'il s'agit d'un SECOND
  // bouton et non d'une décoration. hitSlop 12 rend la cible confortable au
  // pouce sans agrandir la pastille.
  pillRemove: {
    marginLeft: 3,
    marginRight: -6,
    paddingLeft: 9,
    paddingRight: 8,
    paddingVertical: 7,
    borderLeftWidth: 1,
    flexShrink: 0,
  },

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

  aside: { marginTop: 34, paddingTop: 20, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)' },
  asideCap: { fontSize: 14.5, fontWeight: '600', color: INK, lineHeight: 20, marginBottom: 12 },
  asideBtn: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 23,
    borderWidth: 1.5,
    borderColor: ACCENT,
  },
  asideBtnTxt: { fontSize: 15, fontWeight: '700', color: ACCENT, flexShrink: 1 },
})
