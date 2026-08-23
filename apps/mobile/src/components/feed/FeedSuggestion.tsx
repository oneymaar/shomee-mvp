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
 *   4. SORTIE   — un simple lien « Modifier d'autres critères » sous le CTA.
 *                 Lien et non bouton : « Appliquer et relancer » doit rester le
 *                 seul geste plein de l'écran.
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
 * Deux modes de présentation, une seule feuille :
 *   · SURCOUCHE — sans prop `height`, l'écran se pose en absolute par-dessus
 *     le feed. Réservé au cas `empty` : il n'y a alors aucun bien à traverser.
 *   · LIGNE DE FEED — avec `height`, l'écran devient une ligne de la FlatList,
 *     fabriquée UN BIEN À L'AVANCE. Il arrive donc au scroll, comme un bien,
 *     au lieu de surgir après une temporisation sur un feed devenu inerte.
 *
 * ZONES — la carte, pas des pastilles. Le levier `zone` monte la carte de
 * l'onboarding entière (ajout, retrait, zoom, déplacement), en mode embarqué :
 * elle y masque ses propres CTA et se contente de pousser sa sélection. Le
 * retrait, lui, devient réellement effectif — on écrit les QUATRE listes
 * (arrondissements, quartiers, IRIS, communes), alors que l'ancien raccourci
 * n'écrivait que `selectedArrIds` et se faisait annuler par les IRIS, puisque
 * /api/feed/generate résout la zone cible en UNION de ces listes. Les pastilles
 * d'arrondissements limitrophes restent le repli quand la WebView est
 * indisponible (Expo Go, web) — et là, l'ajout seul reste la règle.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, ChevronUp, Plus, X } from 'lucide-react-native'
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
import { MAP_WEBVIEW_AVAILABLE } from '@/components/onboarding/QuartierMapWebView'
import { ACCENT, ACCENT_DISABLED, BG, INK, MUTED } from '@/components/onboarding/ui'
import { ZoneMapPicker, type ZoneSelection } from './ZoneMapPicker'
import {
  allCriteria,
  arrLabel,
  suggestNeighbourArrs,
  type CriteriaEntry,
  type Diagnosis,
  type DiagnosisTrigger,
  type LeverKind,
} from '@/lib/searchDiagnosis'
import { colors, fonts, serifSizes } from '@/lib/theme'

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
  0: { bg: '#ffffff', fg: '#201A16', border: 'rgba(0,0,0,0.09)' },
  1: { bg: '#FFFFFF', fg: '#9b4a2e', border: '#e8907a' },
  2: { bg: '#A6512B', fg: '#ffffff', border: '#A6512B' },
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
  /**
   * Sélection remontée par la carte, en attente. `null` tant que la carte n'a
   * rien poussé — donc tant que rien n'a changé de ce côté.
   */
  zones: ZoneSelection | null
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
  onBack,
  height,
}: {
  diagnosis: Diagnosis
  onApply: (change: AppliedChange) => void
  /**
   * Croix en haut à droite — passer sans rien changer. Optionnelle : en mode
   * ligne de feed, elle n'a de sens que s'il reste un bien APRÈS l'intercalaire.
   * Sur la dernière ligne, « passer » ne mènerait nulle part.
   */
  onDismiss?: () => void
  /**
   * « Revoir toute ma recherche » : la sortie quand notre proposition n'est
   * pas la bonne. Optionnelle — sans elle, le bloc n'est simplement pas rendu.
   */
  onEditBrief?: () => void
  /**
   * Chevron « Revenir au bien précédent ». En mode ligne de feed, le scroll est
   * gelé tant que l'intercalaire est posé (sinon un geste vertical partirait
   * dans la carte du dessous) : ce bouton est la seule remontée possible.
   */
  onBack?: () => void
  /**
   * Hauteur imposée. Renseignée → l'écran devient une LIGNE de FlatList, dans
   * le flux, à la hauteur du viewport. Absente → surcouche plein écran par
   * dessus le feed (cas `empty` : il n'y a pas de feed à traverser).
   */
  height?: number
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
    zones: null,
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

    // Carte : comparaison d'ENSEMBLES, sur les quatre granularités. C'est ce qui
    // rend le bouton honnête. Un simple drapeau « carte touchée » s'allumerait
    // sur un zoom, et resterait allumé après un ajout suivi de son retrait —
    // alors qu'on serait revenu très exactement à la sélection de départ.
    if (staged.zones) {
      const norm = (a: string[]) => [...a].sort().join(',')
      const z = staged.zones
      if (
        norm(z.arrIds) !== norm(base.selectedArrIds) ||
        norm(z.quartierIds) !== norm(base.selectedQuartierIds) ||
        norm(z.irisIds) !== norm(base.selectedIrisIds) ||
        norm(z.communeIds) !== norm(base.selectedCommuneIds)
      ) {
        out.push(`Zone : ${z.label || 'sélection modifiée sur la carte'}`)
      }
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
    // Carte : les QUATRE listes, sinon un retrait ne tiendrait pas (les IRIS
    // ramèneraient la zone par l'union côté serveur). Le libellé suit la zone.
    if (staged.zones) {
      const z = staged.zones
      useSearchStore.setState({
        selectedArrIds: z.arrIds,
        selectedQuartierIds: z.quartierIds,
        selectedIrisIds: z.irisIds,
        selectedCommuneIds: z.communeIds,
        ...(z.label ? { locationLabel: z.label } : {}),
      })
    }
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

  // La carte remplace les pastilles dès qu'elle est montable. Sans
  // `react-native-webview` (Expo Go, web), on garde le raccourci limitrophes :
  // mieux vaut un geste réduit qu'un écran vide.
  const isMap = lever === 'zone' && MAP_WEBVIEW_AVAILABLE

  // La carte pousse sa sélection à chaque geste : on la met EN ATTENTE, jamais
  // dans le store. C'est « Appliquer et relancer » qui décide.
  const handleZoneChange = useCallback((sel: ZoneSelection) => {
    setStaged((p) => ({ ...p, zones: sel }))
  }, [])

  return (
    <View
      style={[
        styles.root,
        height != null ? styles.rootRow : null,
        height != null ? { height } : null,
        { paddingTop: insets.top + 8 },
      ]}
    >
      {/* Trois fentes : le chevron reste centré que la croix soit rendue ou
          non — sinon le libellé se décalerait d'une ligne à l'autre. */}
      <View style={styles.topBar}>
        <View style={styles.topSide} />
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={14}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Revenir au bien précédent"
          >
            <ChevronUp size={18} color={INK} />
            <Text style={styles.backTxt}>Revenir au bien précédent</Text>
          </Pressable>
        ) : (
          <View style={styles.back} />
        )}
        <View style={styles.topSide}>
          {onDismiss != null && (
            <Pressable
              onPress={onDismiss}
              hitSlop={14}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel="Passer sans rien modifier"
            >
              <X size={20} color={MUTED} />
            </Pressable>
          )}
        </View>
      </View>

      {isMap ? (
        /* Carte : mise en page NON scrollable. Un ScrollView ferait lutter le
           geste vertical contre le déplacement de la carte, et `flex: 1` n'a
           aucun sens dans un contenu scrollable. Titre compact, une phrase, et
           tout le reste de la hauteur va à la carte. */
        <View style={styles.mapBody}>
          <View style={styles.mapHead}>
            <Text style={[styles.title, styles.titleCompact]} numberOfLines={2}>
              {HEADLINE[diagnosis.trigger]}
            </Text>
            <Text style={[styles.lead, styles.leadCompact]} numberOfLines={2}>
              {diagnosis.primary.lead}
            </Text>
          </View>
          <View style={styles.mapWrap}>
            <ZoneMapPicker onChange={handleZoneChange} />
          </View>
        </View>
      ) : (
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

      </ScrollView>
      )}

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

        {/* Sortie : notre diagnostic peut se tromper de levier. Un lien, pas un
            second bouton — sinon l'écran redevient un choix entre deux gestes. */}
        {onEditBrief != null && (
          <Pressable
            onPress={onEditBrief}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Modifier d'autres critères"
            style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.linkTxt}>Modifier d’autres critères</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG },
  // Mode ligne de feed : la même feuille, mais dans le flux. `relative` annule
  // l'absolute ci-dessus ; la largeur vient de l'étirement dans la FlatList et
  // la hauteur est imposée par la prop.
  rootRow: { position: 'relative' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  topSide: { width: 34, alignItems: 'center', justifyContent: 'center' },
  back: {
    flex: 1,
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backTxt: { fontSize: 14, fontWeight: '600', color: INK, marginLeft: 6 },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  scroll: { flex: 1 },
  scrollBody: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 },

  // Serif de marque : l'intercalaire pose une QUESTION à l'acquéreur, il a le
  // même statut éditorial qu'une étape du funnel.
  title: {
    fontFamily: fonts.serif,
    fontSize: serifSizes.stepTitle,
    color: INK,
    lineHeight: 34,
    letterSpacing: -0.2,
  },
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
  minMaxVal: { fontFamily: fonts.serif, fontSize: 21, color: INK, marginTop: 2 },
  minMaxValChanged: { color: ACCENT },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E8D9CB',
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
  primaryTxt: { fontSize: 15.5, fontWeight: '600', color: colors.creamOnDark },

  link: { alignSelf: 'center', marginTop: 2, paddingVertical: 11, paddingHorizontal: 10 },
  linkTxt: { fontSize: 14.5, fontWeight: '700', color: ACCENT },

  // Mode carte : le texte se serre pour que la carte respire.
  mapBody: { flex: 1 },
  mapHead: { paddingHorizontal: 20, paddingTop: 2 },
  titleCompact: { fontSize: 22, lineHeight: 27 },
  leadCompact: { fontSize: 14, lineHeight: 19, marginTop: 8 },
  mapWrap: { flex: 1, marginTop: 14 },
})
