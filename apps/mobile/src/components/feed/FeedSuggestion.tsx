/**
 * Intercalaire « faire évoluer ma recherche » (P6) — remplace l'ancienne sonde
 * FeedProbe, dont les pastilles appliquaient une modification instantanée et
 * opaque (un tap sur la croix relançait le moteur sans que l'acquéreur sache ce
 * qui venait de changer).
 *
 * Nouveau contrat, en trois temps lisibles :
 *   1. CONSTAT     — le système annonce ce qu'il a détecté comme bloquant
 *                    (`searchDiagnosis`) ;
 *   2. PROPOSITION — l'élément d'onboarding correspondant est réaffiché (chips
 *                    quartiers, curseur budget / surface, chips critères),
 *                    PRÉ-POSITIONNÉ sur la suggestion, avec l'impact estimé ;
 *   3. VALIDATION  — rien n'est écrit dans le searchStore tant que l'acquéreur
 *                    n'a pas appuyé sur « Appliquer et relancer ». Le récapitulatif
 *                    des modifications en attente reste affiché juste au-dessus du
 *                    bouton : on sait toujours ce qu'on s'apprête à changer.
 *
 * Invariant produit respecté : l'implicite (comportement de scroll) ne modifie
 * JAMAIS silencieusement le déclaratif — il ne fait que proposer.
 *
 * Deux garde-fous non négociables, appris des retours précédents :
 *
 *  · ZONES : on ne propose QUE d'ajouter des arrondissements limitrophes, jamais
 *    d'en retirer. `setSelectedArrs` n'écrit que `selectedArrIds`, alors que
 *    /api/feed/generate résout la zone cible en UNION de `arrondissementIds`,
 *    des IRIS et des quartiers du snapshot. Retirer un arrondissement ici le
 *    laisserait donc revenir par ses IRIS : un geste sans effet visible, soit
 *    exactement l'opacité qu'on corrige. Élargir, en union, marche toujours.
 *
 *  · CHIFFRES : l'impact est exprimé dans le VOCABULAIRE DU RÉCAP (bande de
 *    disponibilité + biens/semaine), jamais en nombre absolu de biens.
 *    /api/feed/estimate compte le catalogue Prisma, pas les fiches réellement
 *    servies au feed : afficher « 12 biens » ici alors que le feed en présente 4
 *    recréerait mot pour mot l'incohérence de comptage déjà signalée.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowRight, Check, Plus, RotateCcw, X } from 'lucide-react-native'
import type { ChipState } from '@shomee/core/stores/searchStore'
import { useSearchStore } from '@/lib/stores'
import { apiFetch } from '@/lib/api'
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
import { CriteriaChip } from '@/components/onboarding/CriteriaChip'
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
  type Lever,
  type LeverKind,
} from '@/lib/searchDiagnosis'

// Vocabulaire des 4 états — strictement celui de l'onboarding.
const STATE_LABEL: Record<ChipState, string> = {
  0: 'retiré',
  1: 'souhaité',
  2: 'obligatoire',
  3: 'rédhibitoire',
}

// Cycle de re-tap identique à l'étape Critères : obligatoire → souhaité →
// rédhibitoire → obligatoire. Aucun état ne piège l'acquéreur.
function nextState(s: ChipState): ChipState {
  return s === 2 ? 1 : s === 1 ? 3 : 2
}

const CHIP_STYLE: Record<ChipState, { bg: string; fg: string; border: string }> = {
  0: { bg: '#ffffff', fg: '#1a1a1a', border: 'rgba(0,0,0,0.09)' },
  1: { bg: '#fdf0ed', fg: '#9b4a2e', border: '#e8907a' },
  2: { bg: '#C1533A', fg: '#ffffff', border: '#C1533A' },
  3: { bg: '#f3f0ee', fg: '#9a9a9a', border: 'rgba(0,0,0,0.10)' },
}
const LEGEND: Array<{ state: 1 | 2 | 3; label: string }> = [
  { state: 1, label: 'Souhaité' },
  { state: 2, label: 'Obligatoire' },
  { state: 3, label: 'Rédhibitoire' },
]

// L'écran sert trois moments différents ; seuls le sur-titre et la phrase
// d'accroche changent, tout le reste (constat, contrôle, impact, validation)
// est identique — c'est ce qui le rend reconnaissable d'une fois sur l'autre.
const KICKER: Record<DiagnosisTrigger, string> = {
  streak: 'Faire évoluer ma recherche',
  starving: 'Faire évoluer ma recherche',
  empty: 'Aucun bien pour l’instant',
}
const INTRO: Record<DiagnosisTrigger, string> = {
  streak: 'Vous avez passé plusieurs biens rapidement.',
  starving: 'Vous avez fait le tour des biens qui correspondent.',
  empty:
    'Votre recherche est trop étroite : aucun bien du catalogue ne la satisfait aujourd’hui.',
}

// ─── Estimation (mêmes bandes que la jauge de rareté du récap) ───────────────
type Band = 'rare' | 'selective' | 'steady' | 'abundant'
type Estimate = { band: Band; perWeekMin: number; perWeekMax: number }
const BAND_LABEL: Record<Band, string> = {
  rare: 'Rare',
  selective: 'Sélectif',
  steady: 'Régulier',
  abundant: 'Large',
}
const BAND_RANK: Record<Band, number> = { rare: 0, selective: 1, steady: 2, abundant: 3 }

function flowText(e: Estimate): string {
  const hi = Math.max(e.perWeekMin, e.perWeekMax)
  const lo = Math.min(e.perWeekMin, e.perWeekMax)
  if (hi <= 0) return 'moins d’un bien par semaine'
  if (lo === hi) return `~${hi} bien${hi > 1 ? 's' : ''} / semaine`
  return `${lo} à ${hi} biens / semaine`
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

export function FeedSuggestion({
  diagnosis,
  onApply,
  onDismiss,
  dismissLabel = 'Garder ma recherche telle quelle',
}: {
  diagnosis: Diagnosis
  onApply: (change: AppliedChange) => void
  onDismiss: () => void
  /**
   * Libellé de la sortie sans rien changer. Sur un feed vide il n'y a rien à
   * « garder » derrière l'écran : l'appelant dit où mène la porte de sortie.
   */
  dismissLabel?: string
}) {
  const insets = useSafeAreaInsets()

  // Photo du store au montage : la référence « avant » ne doit pas bouger sous
  // les pieds de l'écran pendant qu'on manipule les contrôles.
  const base = useRef(useSearchStore.getState()).current
  const baseCriteria = useMemo<CriteriaEntry[]>(() => allCriteria(base), [base])

  const [lever, setLever] = useState<LeverKind>(diagnosis.primary.kind)
  const [staged, setStaged] = useState<Staged>(() => ({
    budgetMin: base.budgetMin,
    budgetMax: base.budgetMax,
    minSurface: base.minSurface,
    maxSurface: base.maxSurface,
    arrIds: [...base.selectedArrIds],
    criteria: Object.fromEntries(baseCriteria.map((c) => [c.key, c.state])),
  }))

  // Levier courant : son constat + sa proposition. `diagnoseSearch` garantit
  // toujours un `primary`, et les alternatives portent leurs propres textes.
  const current: Lever = useMemo(
    () =>
      [diagnosis.primary, ...diagnosis.alternatives].find((l) => l.kind === lever) ??
      diagnosis.primary,
    [diagnosis, lever],
  )

  // Pré-positionnement de la suggestion : une seule fois par levier, à sa
  // première ouverture. Revenir sur un levier déjà visité ne réécrase donc pas
  // les ajustements manuels de l'acquéreur.
  const primed = useRef<Set<LeverKind>>(new Set())
  useEffect(() => {
    if (primed.current.has(lever)) return
    primed.current.add(lever)
    setStaged((prev) => {
      if (lever === 'budget') return { ...prev, budgetMax: suggestBudgetMax(prev.budgetMax) }
      if (lever === 'surface') return { ...prev, minSurface: suggestMinSurface(prev.minSurface) }
      if (lever === 'zone') {
        const next = suggestNeighbourArrs(prev.arrIds, 1)[0]
        return next && !prev.arrIds.includes(next)
          ? { ...prev, arrIds: [...prev.arrIds, next] }
          : prev
      }
      // Critères : on pré-positionne le passage en « souhaité » — le geste le
      // plus réversible et le moins destructeur. Sur un feed vide on vise
      // d'abord un RÉDHIBITOIRE (c'est lui qui exclut, donc lui qui explique le
      // zéro) ; sinon un obligatoire. Sans ce repli, une recherche n'ayant qu'un
      // rédhibitoire arrivait ici sans rien de pré-positionné : le bouton
      // « Appliquer » restait grisé et l'écran devenait un cul-de-sac.
      const dealbreaker = baseCriteria.find((c) => c.state === 3)
      const mandatory = baseCriteria.find((c) => c.state === 2)
      const first =
        diagnosis.trigger === 'empty' ? (dealbreaker ?? mandatory) : (mandatory ?? dealbreaker)
      return first ? { ...prev, criteria: { ...prev.criteria, [first.key]: 1 } } : prev
    })
  }, [lever, baseCriteria, diagnosis.trigger])

  // ── Récapitulatif des modifications en attente ────────────────────────────
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
    if (added.length > 0) out.push(`Secteur${added.length > 1 ? 's' : ''} ajouté${added.length > 1 ? 's' : ''} : ${added.map(arrLabel).join(', ')}`)
    for (const c of baseCriteria) {
      const next = staged.criteria[c.key] ?? 0
      if (next === c.state) continue
      out.push(
        next === 0
          ? `« ${c.label} » retiré de votre recherche`
          : `« ${c.label} » : ${STATE_LABEL[c.state]} → ${STATE_LABEL[next]}`,
      )
    }
    return out
  }, [staged, base, baseCriteria])

  const dirty = changes.length > 0

  // Les filtres DURS ont-ils bougé ? Seuls ceux-là sont visibles par
  // /api/feed/estimate — les critères, eux, ne sont pas des filtres.
  const hardChanged =
    staged.budgetMin !== base.budgetMin ||
    staged.budgetMax !== base.budgetMax ||
    staged.minSurface !== base.minSurface ||
    staged.maxSurface !== base.maxSurface ||
    staged.arrIds.length !== base.selectedArrIds.length

  // ── Impact estimé ─────────────────────────────────────────────────────────
  const showsImpact = lever !== 'criteria' || hardChanged
  const [baseEstimate, setBaseEstimate] = useState<Estimate | null>(null)
  const [nextEstimate, setNextEstimate] = useState<Estimate | null>(null)
  const [projecting, setProjecting] = useState(false)
  const [estimateFailed, setEstimateFailed] = useState(false)

  const estimate = useCallback(
    async (st: Staged): Promise<Estimate | null> => {
      try {
        const res = await apiFetch('/api/feed/estimate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            arrondissementIds: st.arrIds,
            communeIds: base.selectedCommuneIds,
            budgetMin: st.budgetMin,
            budgetMax: st.budgetMax,
            minSurface: st.minSurface,
            maxSurface: st.maxSurface,
            minRooms: base.minRooms,
            maxRooms: base.maxRooms,
            minBedrooms: base.minBedrooms,
            maxBedrooms: base.maxBedrooms,
          }),
        })
        if (!res.ok) throw new Error('estimate_failed')
        const data = (await res.json()) as Partial<Estimate>
        if (!data || typeof data.band !== 'string' || !(data.band in BAND_LABEL)) return null
        return {
          band: data.band as Band,
          perWeekMin: Number(data.perWeekMin ?? 0),
          perWeekMax: Number(data.perWeekMax ?? 0),
        }
      } catch {
        return null
      }
    },
    [base],
  )

  // Référence « avant » : calculée une seule fois, jamais recalculée.
  useEffect(() => {
    let cancelled = false
    void estimate({
      budgetMin: base.budgetMin,
      budgetMax: base.budgetMax,
      minSurface: base.minSurface,
      maxSurface: base.maxSurface,
      arrIds: [...base.selectedArrIds],
      criteria: {},
    }).then((e) => {
      if (cancelled) return
      if (e == null) setEstimateFailed(true)
      else setBaseEstimate(e)
    })
    return () => {
      cancelled = true
    }
  }, [base, estimate])

  // Projection « après » : différée pendant le drag du curseur. Sans changement
  // de filtre dur, la projection EST la référence — inutile de rappeler l'API.
  useEffect(() => {
    if (!showsImpact) return
    if (!hardChanged) {
      setProjecting(false)
      setNextEstimate(baseEstimate)
      return
    }
    let cancelled = false
    setProjecting(true)
    const id = setTimeout(() => {
      void estimate(staged).then((e) => {
        if (cancelled) return
        setProjecting(false)
        if (e == null) setEstimateFailed(true)
        else setNextEstimate(e)
      })
    }, 380)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [staged, showsImpact, hardChanged, baseEstimate, estimate])

  // ── Application ───────────────────────────────────────────────────────────
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

  // ── Données des contrôles ─────────────────────────────────────────────────
  const neighbours = useMemo(() => suggestNeighbourArrs(base.selectedArrIds, 6), [base])
  const addedArrs = useMemo(
    () => staged.arrIds.filter((id) => !base.selectedArrIds.includes(id)),
    [staged.arrIds, base],
  )
  const openNeighbours = useMemo(
    () => neighbours.filter((id) => !staged.arrIds.includes(id)),
    [neighbours, staged.arrIds],
  )
  const activeCriteria = baseCriteria.filter((c) => (staged.criteria[c.key] ?? 0) !== 0)
  const droppedCriteria = baseCriteria.filter((c) => (staged.criteria[c.key] ?? 0) === 0)

  const intro = INTRO[diagnosis.trigger]

  const others = [diagnosis.primary, ...diagnosis.alternatives].filter((l) => l.kind !== lever)

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBar}>
        <Text style={styles.kicker}>{KICKER[diagnosis.trigger]}</Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={14}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
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
        <Text style={styles.intro}>{intro}</Text>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.sub}>{current.suggestion}</Text>

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
                  setStaged((p) => ({
                    ...p,
                    budgetMin: BUDGET_SCALE[lo],
                    budgetMax: BUDGET_SCALE[hi],
                  }))
                }
              />
              <Text style={styles.hint}>
                Glissez les bornes pour ajuster votre fourchette. Nous avons pré-positionné le
                plafond sur notre suggestion — libre à vous de le ramener où vous voulez.
              </Text>
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
                  setStaged((p) => ({
                    ...p,
                    minSurface: SURFACE_SCALE[lo],
                    maxSurface: SURFACE_SCALE[hi],
                  }))
                }
              />
              <Text style={styles.hint}>
                Glissez les bornes pour ajuster la surface recherchée.
              </Text>
            </>
          )}

          {lever === 'zone' && (
            <>
              <Text style={styles.sectionCap}>À ajouter — arrondissements limitrophes</Text>
              <View style={styles.chips}>
                {openNeighbours.length === 0 && addedArrs.length === 0 ? (
                  <Text style={styles.empty}>
                    Tous les arrondissements limitrophes sont déjà dans votre recherche.
                  </Text>
                ) : (
                  <>
                    {addedArrs.map((id) => (
                      <View key={id} style={styles.chipWrap}>
                        <CriteriaChip
                          label={arrLabel(id)}
                          state={2}
                          onPress={() =>
                            setStaged((p) => ({
                              ...p,
                              arrIds: p.arrIds.filter((x) => x !== id),
                            }))
                          }
                          onRemove={() =>
                            setStaged((p) => ({
                              ...p,
                              arrIds: p.arrIds.filter((x) => x !== id),
                            }))
                          }
                        />
                      </View>
                    ))}
                    {openNeighbours.map((id) => (
                      <View key={id} style={styles.chipWrap}>
                        <CriteriaChip
                          label={arrLabel(id)}
                          state={0}
                          onPress={() => setStaged((p) => ({ ...p, arrIds: [...p.arrIds, id] }))}
                        />
                      </View>
                    ))}
                  </>
                )}
              </View>

              <Text style={styles.sectionCap}>Déjà dans votre recherche</Text>
              <View style={styles.chips}>
                {base.selectedArrIds.length === 0 ? (
                  <Text style={styles.empty}>
                    Vous n’avez pas restreint votre recherche à un arrondissement.
                  </Text>
                ) : (
                  base.selectedArrIds.map((id) => (
                    <View key={id} style={[styles.chipWrap, styles.staticPill]}>
                      <Text style={styles.staticPillTxt}>{arrLabel(id)}</Text>
                    </View>
                  ))
                )}
              </View>
              <Text style={styles.hint}>
                Cet écran sert à élargir : vos secteurs actuels restent dans la recherche. Touchez
                un arrondissement limitrophe pour l’ajouter, retouchez-le pour l’enlever.
              </Text>
            </>
          )}

          {lever === 'criteria' && (
            <>
              <View style={styles.legend}>
                {LEGEND.map((l) => {
                  const st = CHIP_STYLE[l.state]
                  return (
                    <View
                      key={l.state}
                      style={[styles.legendPill, { backgroundColor: st.bg, borderColor: st.border }]}
                    >
                      {l.state === 1 && <Plus size={9} strokeWidth={3} color={st.fg} />}
                      {l.state === 2 && <Check size={9} strokeWidth={3} color={st.fg} />}
                      {l.state === 3 && <X size={9} strokeWidth={3} color={st.fg} />}
                      <Text style={[styles.legendTxt, { color: st.fg }]}>{l.label}</Text>
                    </View>
                  )
                })}
              </View>
              <View style={styles.chips}>
                {activeCriteria.length === 0 ? (
                  <Text style={styles.empty}>
                    {baseCriteria.length === 0
                      ? 'Vous n’avez pas encore de critère enregistré.'
                      : 'Vous avez retiré tous vos critères — restaurez-en un ci-dessous si besoin.'}
                  </Text>
                ) : (
                  activeCriteria.map((c) => (
                    <View key={c.key} style={styles.chipWrap}>
                      <CriteriaChip
                        label={c.label}
                        state={staged.criteria[c.key] ?? c.state}
                        onPress={() =>
                          setStaged((p) => ({
                            ...p,
                            criteria: {
                              ...p.criteria,
                              [c.key]: nextState(p.criteria[c.key] ?? c.state),
                            },
                          }))
                        }
                        onRemove={() =>
                          setStaged((p) => ({ ...p, criteria: { ...p.criteria, [c.key]: 0 } }))
                        }
                      />
                    </View>
                  ))
                )}
              </View>

              {/* Rien n'est irréversible dans cet écran : un critère retiré reste
                  restaurable tant qu'on n'a pas appliqué. */}
              {droppedCriteria.length > 0 && (
                <>
                  <Text style={styles.sectionCap}>Retirés — touchez pour restaurer</Text>
                  <View style={styles.chips}>
                    {droppedCriteria.map((c) => (
                      <Pressable
                        key={c.key}
                        onPress={() =>
                          setStaged((p) => ({ ...p, criteria: { ...p.criteria, [c.key]: c.state } }))
                        }
                        hitSlop={6}
                        style={[styles.chipWrap, styles.restorePill]}
                        accessibilityRole="button"
                        accessibilityLabel={`Restaurer le critère ${c.label}`}
                      >
                        <RotateCcw size={11} color={MUTED} />
                        <Text style={styles.restoreTxt}>{c.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.hint}>
                Touchez une pastille pour changer son niveau d’exigence, la croix pour la retirer.
                Un critère « souhaité » remonte les biens qui l’ont sans exclure les autres.
              </Text>
            </>
          )}
        </View>

        {/* Impact estimé — même vocabulaire que la jauge du récap, jamais un
            nombre de biens (cf. en-tête). Masqué si l'estimation échoue. */}
        {showsImpact && !estimateFailed && (
          <View style={styles.impact}>
            <Text style={styles.sectionCap}>Disponibilité estimée</Text>
            {baseEstimate == null ? (
              <View style={styles.impactLoading}>
                <ActivityIndicator color={ACCENT} size="small" />
                <Text style={styles.impactLoadingTxt}>Estimation en cours…</Text>
              </View>
            ) : (
              <View style={styles.impactRow}>
                <View style={styles.impactCol}>
                  <Text style={styles.impactCap}>Aujourd’hui</Text>
                  <Text style={styles.impactBand}>{BAND_LABEL[baseEstimate.band]}</Text>
                  <Text style={styles.impactFlow}>{flowText(baseEstimate)}</Text>
                </View>
                <ArrowRight size={16} color={MUTED} />
                <View style={styles.impactCol}>
                  <Text style={styles.impactCap}>Après</Text>
                  {projecting || nextEstimate == null ? (
                    <ActivityIndicator color={ACCENT} size="small" style={styles.impactSpinner} />
                  ) : (
                    <>
                      <Text
                        style={[
                          styles.impactBand,
                          BAND_RANK[nextEstimate.band] > BAND_RANK[baseEstimate.band] &&
                            styles.impactBandUp,
                        ]}
                      >
                        {BAND_LABEL[nextEstimate.band]}
                      </Text>
                      <Text style={styles.impactFlow}>{flowText(nextEstimate)}</Text>
                    </>
                  )}
                </View>
              </View>
            )}
            <Text style={styles.impactNote}>
              Estimation du flux d’annonces sur vos filtres — pas le nombre de biens de ce feed.
            </Text>
          </View>
        )}

        {/* Autres leviers — l'acquéreur n'est jamais enfermé dans notre diagnostic. */}
        {others.length > 0 && (
          <View style={styles.alts}>
            <Text style={styles.sectionCap}>Autre piste</Text>
            <View style={styles.chips}>
              {others.map((a) => (
                <Pressable
                  key={a.kind}
                  onPress={() => setLever(a.kind)}
                  style={({ pressed }) => [styles.altBtn, pressed && { opacity: 0.7 }]}
                  hitSlop={6}
                  accessibilityRole="button"
                >
                  <Text style={styles.altTxt}>{a.short}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Pied fixe : le récapitulatif et les actions restent toujours visibles,
          quelle que soit la hauteur d'écran (et la longueur du contenu). */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
        <View style={styles.pending}>
          <Text style={styles.pendingCap}>
            {dirty ? 'Modifications en attente' : 'Aucune modification pour l’instant'}
          </Text>
          {changes.slice(0, 3).map((c, i) => (
            <Text key={`${i}-${c}`} style={styles.pendingTxt} numberOfLines={2}>
              • {c}
            </Text>
          ))}
          {changes.length > 3 && (
            <Text style={styles.pendingTxt}>
              • et {changes.length - 3} autre{changes.length - 3 > 1 ? 's' : ''} modification
              {changes.length - 3 > 1 ? 's' : ''}
            </Text>
          )}
        </View>

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

        <Pressable onPress={onDismiss} hitSlop={8} style={styles.ghost} accessibilityRole="button">
          <Text style={styles.ghostTxt}>{dismissLabel}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  kicker: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: ACCENT,
  },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  scroll: { flex: 1 },
  scrollBody: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 },

  intro: { fontSize: 13.5, color: MUTED, marginBottom: 6 },
  title: { fontSize: 21, fontWeight: '800', color: INK, lineHeight: 27 },
  sub: { fontSize: 14, color: MUTED, lineHeight: 20, marginTop: 8 },

  control: { marginTop: 20 },

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
  minMaxVal: { fontSize: 19, fontWeight: '800', color: INK, marginTop: 2 },
  minMaxValChanged: { color: ACCENT },

  sectionCap: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: MUTED,
    marginTop: 14,
    marginBottom: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipWrap: { maxWidth: '100%' },
  empty: { fontSize: 13, color: MUTED, fontStyle: 'italic', flexShrink: 1 },
  hint: { fontSize: 12.5, color: MUTED, lineHeight: 18, marginTop: 12 },

  staticPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  staticPillTxt: { fontSize: 12.5, fontWeight: '500', color: MUTED, flexShrink: 1 },

  restorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(0,0,0,0.18)',
    backgroundColor: 'transparent',
  },
  restoreTxt: { fontSize: 12.5, fontWeight: '500', color: MUTED, flexShrink: 1 },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  legendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  legendTxt: { fontSize: 10.5, fontWeight: '600' },

  impact: { marginTop: 22 },
  impactLoading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  impactLoadingTxt: { fontSize: 13, color: MUTED },
  impactRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  impactCol: { flex: 1, minHeight: 54 },
  impactSpinner: { alignSelf: 'flex-start', marginTop: 8 },
  impactCap: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 2,
  },
  impactBand: { fontSize: 17, fontWeight: '800', color: INK },
  impactBandUp: { color: ACCENT },
  impactFlow: { fontSize: 12.5, color: MUTED, marginTop: 1 },
  impactNote: { fontSize: 11.5, color: MUTED, lineHeight: 16, marginTop: 10, fontStyle: 'italic' },

  alts: { marginTop: 24 },
  altBtn: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: '#fff',
  },
  altTxt: { fontSize: 13, fontWeight: '600', color: INK },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.07)',
    backgroundColor: BG,
  },
  pending: { marginBottom: 12 },
  pendingCap: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 4,
  },
  pendingTxt: { fontSize: 13, color: INK, lineHeight: 19 },

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
  ghostTxt: { fontSize: 14, fontWeight: '500', color: MUTED },
})
