/**
 * Diagnostic de recherche « bloquée » (P6) — décide QUEL levier proposer dans
 * l'intercalaire du feed, et prépare la suggestion chiffrée correspondante.
 *
 * Principe produit : quand une recherche patine, on ne devine pas à la place de
 * l'acquéreur et on ne modifie RIEN silencieusement (invariant : l'implicite ne
 * touche jamais au déclaratif). On identifie le frein le plus probable, on
 * réaffiche l'élément d'onboarding correspondant (chips quartiers, curseur
 * budget / surface, chips de critères) pré-positionné sur la suggestion, et
 * l'acquéreur valide — ou non — explicitement.
 *
 * 100 % pur (aucun accès store, aucun React) : testable et réutilisable côté web.
 */
import { budgetSignal } from '@shomee/core/geo/budgetFeasibility'
import type { ChipState } from '@shomee/core/stores/searchStore'
import {
  BUDGET_SCALE,
  BUDGET_MAX_INDEX,
  BUDGET_UNLIMITED,
  budgetIndex,
  SURFACE_SCALE,
  surfaceIndex,
} from './scales'

export type LeverKind = 'criteria' | 'budget' | 'surface' | 'zone'

/**
 * Ce qui a déclenché l'intercalaire :
 *  · `streak`   — plusieurs rejets rapides d'affilée : les biens passent les
 *                 filtres durs mais ne plaisent pas → c'est le déclaratif fin
 *                 (critères) qui est le plus suspect.
 *  · `starving` — le feed est quasi vide / épuisé : ce sont les filtres de
 *                 capacité (budget, zone, surface) qui étranglent la recherche.
 *  · `empty`    — le moteur n'a rendu AUCUN bien. C'est le cas le plus dur :
 *                 il n'y a rien à regarder, l'écran est donc un cul-de-sac s'il
 *                 ne propose pas de sortie. Une exclusion (critère rédhibitoire)
 *                 suffit à vider un feed à elle seule : elle passe donc en tête
 *                 du diagnostic, avant les leviers de capacité.
 */
export type DiagnosisTrigger = 'streak' | 'starving' | 'empty'

/** Vue minimale du searchStore nécessaire au diagnostic. */
export interface SearchSnapshot {
  selectedArrIds: string[]
  selectedCommuneIds: string[]
  selectedIrisIds: string[]
  budgetMin: number | null
  budgetMax: number | null
  minSurface: number | null
  maxSurface: number | null
  chipStates: Record<string, ChipState>
  customCriteria: Array<{ id: string; label: string; state: ChipState }>
}

/** Critère unifié (catalogue + personnalisé) manipulable dans l'intercalaire. */
export interface CriteriaEntry {
  /** Clé de staging : le label pour le catalogue, l'id pour un critère perso. */
  key: string
  label: string
  state: ChipState
  source: 'catalog' | 'custom'
}

export interface Lever {
  kind: LeverKind
  /** Constat — ce que le système a détecté comme bloquant. */
  title: string
  /** Proposition concrète, en vouvoiement. */
  suggestion: string
  /** Libellé court pour proposer ce levier en second rideau. */
  short: string
  /** Score interne de sélection (non affiché). */
  score: number
}

export interface Diagnosis {
  trigger: DiagnosisTrigger
  primary: Lever
  /** Autres leviers pertinents, du plus au moins probable. */
  alternatives: Lever[]
}

// ─── Critères ────────────────────────────────────────────────────────────────

/** Fusionne chips catalogue et critères personnalisés en une liste unique. */
export function allCriteria(
  s: Pick<SearchSnapshot, 'chipStates' | 'customCriteria'>,
): CriteriaEntry[] {
  const out: CriteriaEntry[] = []
  for (const [label, state] of Object.entries(s.chipStates)) {
    if (!state) continue
    out.push({ key: label, label, state, source: 'catalog' })
  }
  for (const c of s.customCriteria) {
    if (!c.state) continue
    out.push({ key: c.id, label: c.label, state: c.state, source: 'custom' })
  }
  return out
}

/** Critères « durs » : obligatoires (2) et rédhibitoires (3). */
export function hardCriteria(
  s: Pick<SearchSnapshot, 'chipStates' | 'customCriteria'>,
): CriteriaEntry[] {
  return allCriteria(s).filter((c) => c.state === 2 || c.state === 3)
}

// ─── Suggestions chiffrées ───────────────────────────────────────────────────

/** Deux crans d'échelle au-dessus (≈ +10 à +25 % selon la zone de l'échelle). */
export function suggestBudgetMax(current: number | null): number {
  const base = current ?? 0
  if (base <= 0) return BUDGET_SCALE[budgetIndex(400_000)]
  const next = Math.min(BUDGET_MAX_INDEX, budgetIndex(base) + 2)
  return BUDGET_SCALE[next]
}

/** Deux crans d'échelle en dessous, plancher à la première valeur de l'échelle. */
export function suggestMinSurface(current: number | null): number {
  const base = current ?? 0
  if (base <= 0) return SURFACE_SCALE[0]
  const next = Math.max(0, surfaceIndex(base) - 2)
  return SURFACE_SCALE[next]
}

// ─── Zones ───────────────────────────────────────────────────────────────────

/**
 * Adjacence des arrondissements parisiens. Approximation volontairement
 * généreuse (deux arrondissements qui ne se touchent qu'en un point — 9e / 17e
 * place de Clichy — sont comptés voisins) : elle ne sert qu'à PROPOSER des
 * zones à ajouter, jamais à filtrer.
 */
const ARR_NEIGHBOURS: Record<number, number[]> = {
  1: [2, 3, 4, 6, 7, 8],
  2: [1, 3, 9, 10],
  3: [1, 2, 4, 10, 11],
  4: [1, 3, 5, 11, 12],
  5: [4, 6, 12, 13, 14],
  6: [1, 5, 7, 14, 15],
  7: [1, 6, 8, 15, 16],
  8: [1, 7, 9, 16, 17],
  9: [2, 8, 10, 17, 18],
  10: [2, 3, 9, 11, 18, 19],
  11: [3, 4, 10, 12, 20],
  12: [4, 5, 11, 13, 20],
  13: [5, 12, 14],
  14: [5, 6, 13, 15],
  15: [6, 7, 14, 16],
  16: [7, 8, 15, 17],
  17: [8, 9, 16, 18],
  18: [9, 10, 17, 19],
  19: [10, 18, 20],
  20: [11, 12, 19],
}

export function arrNumber(id: string): number | null {
  const m = /^arr-(\d{1,2})$/.exec(id)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 20 ? n : null
}

/** « 1er », « 11e » — libellé court pour les chips. */
export function arrLabel(id: string): string {
  const n = arrNumber(id)
  if (n == null) return id
  return n === 1 ? '1er' : `${n}e`
}

/**
 * Arrondissements limitrophes non encore sélectionnés, triés par nombre de
 * contacts avec la zone actuelle (les plus « collés » d'abord) puis par numéro
 * pour rester déterministe.
 */
export function suggestNeighbourArrs(selectedArrIds: string[], limit = 6): string[] {
  const selected = new Set<number>()
  for (const id of selectedArrIds) {
    const n = arrNumber(id)
    if (n != null) selected.add(n)
  }
  if (selected.size === 0) return []
  const contacts = new Map<number, number>()
  for (const n of selected) {
    for (const nb of ARR_NEIGHBOURS[n] ?? []) {
      if (selected.has(nb)) continue
      contacts.set(nb, (contacts.get(nb) ?? 0) + 1)
    }
  }
  return [...contacts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([n]) => `arr-${n}`)
}

// ─── Diagnostic ──────────────────────────────────────────────────────────────

function budgetLever(s: SearchSnapshot, trigger: DiagnosisTrigger): Lever | null {
  const max = s.budgetMax
  // Aucun plafond déclaré (ou plafond « sans limite ») : rien à élargir.
  if (max == null || max <= 0 || max >= BUDGET_UNLIMITED) return null
  const signal = budgetSignal(s.selectedIrisIds, max, s.minSurface ?? 50)
  // Sans donnée marché sur les zones, le budget reste un levier plausible mais
  // ne peut pas être affirmé : score bas, il ne passera pas en principal seul.
  const base =
    signal.tone === 'very_tight'
      ? 100
      : signal.tone === 'tight'
        ? 62
        : signal.tone === 'none'
          ? 34
          : 12
  return {
    kind: 'budget',
    score: base + (trigger !== 'streak' ? 15 : 0),
    title:
      signal.tone === 'very_tight'
        ? 'Votre budget est très serré pour ces quartiers'
        : signal.tone === 'tight'
          ? 'Votre budget est un peu juste pour ces quartiers'
          : 'Votre budget cadre fortement les résultats',
    suggestion: 'Remonter le plafond ouvre mécaniquement le champ des biens visibles.',
    short: 'Ajuster le budget',
  }
}

/**
 * Un critère DUR est le seul levier capable de vider un feed à lui tout seul :
 * « rédhibitoire » exclut le bien, quoi qu'il vaille par ailleurs. C'est pour
 * cette raison qu'UN SEUL rédhibitoire suffit à ouvrir ce levier (le seuil de
 * deux ne vaut que pour les obligatoires, plus progressifs), et qu'il passe
 * devant tout le reste quand le moteur n'a rien rendu.
 */
function criteriaLever(s: SearchSnapshot, trigger: DiagnosisTrigger): Lever | null {
  const hard = hardCriteria(s)
  const dealbreaking = hard.filter((c) => c.state === 3)
  const dealbreakers = dealbreaking.length
  const mandatory = hard.length - dealbreakers
  if (hard.length === 0) return null
  if (dealbreakers === 0 && mandatory < 2) return null
  const plural = (n: number) => (n > 1 ? 's' : '')

  // Un seul rédhibitoire : on le NOMME. « Vous avez 1 critère rédhibitoire »
  // laisse l'acquéreur chercher lequel ; « "Lumineux" écarte tous les biens »
  // désigne le frein et rend le geste suivant évident.
  const named = dealbreakers === 1 ? `« ${dealbreaking[0].label} »` : null

  const title =
    trigger === 'empty'
      ? named
        ? `${named} écarte tous les biens`
        : dealbreakers > 0
          ? `Vos ${dealbreakers} critères rédhibitoires écartent tous les biens`
          : `Vos ${mandatory} critères obligatoires ne sont jamais tous réunis`
      : dealbreakers > mandatory
        ? `Vous avez ${dealbreakers} critère${plural(dealbreakers)} rédhibitoire${plural(dealbreakers)}`
        : `Vous avez ${mandatory} critère${plural(mandatory)} obligatoire${plural(mandatory)}`

  return {
    kind: 'criteria',
    // Sur un feed vide, l'exclusion explique le résultat à elle seule : elle
    // doit sortir devant budget / zone / surface, qui ne font que réduire.
    score:
      Math.min(95, 30 + 15 * hard.length) +
      (trigger === 'streak' ? 15 : 0) +
      (trigger === 'empty' ? (dealbreakers > 0 ? 120 : 40) : 0),
    title,
    suggestion:
      dealbreakers > 0
        ? 'Un critère rédhibitoire exclut le bien, quelles que soient ses autres qualités. En « souhaité », il fait redescendre les biens concernés dans le classement au lieu de les supprimer.'
        : 'Passer un critère en « souhaité » le garde dans le classement sans exclure les biens qui ne l’ont pas.',
    short: 'Assouplir mes critères',
  }
}

function zoneLever(s: SearchSnapshot, trigger: DiagnosisTrigger): Lever | null {
  if (suggestNeighbourArrs(s.selectedArrIds).length === 0) return null
  const zones = s.selectedArrIds.length + s.selectedCommuneIds.length
  const base = zones <= 1 ? 72 : zones === 2 ? 52 : zones === 3 ? 30 : 12
  return {
    kind: 'zone',
    score: base + (trigger !== 'streak' ? 15 : 0),
    title:
      zones <= 1
        ? 'Votre recherche tient sur un seul secteur'
        : `Votre recherche tient sur ${zones} secteurs`,
    suggestion: 'Les arrondissements limitrophes offrent souvent le même cadre de vie.',
    short: 'Élargir la zone',
  }
}

function surfaceLever(s: SearchSnapshot, trigger: DiagnosisTrigger): Lever | null {
  const min = s.minSurface
  if (min == null || min < 40) return null
  const base = min >= 80 ? 60 : min >= 60 ? 42 : 26
  return {
    kind: 'surface',
    score: base + (trigger !== 'streak' ? 15 : 0),
    title: `Vous demandez au minimum ${min} m²`,
    suggestion: 'Quelques mètres carrés de moins font souvent basculer beaucoup de biens.',
    short: 'Revoir la surface',
  }
}

/**
 * Levier de repli quand aucune règle ne s'applique (recherche déjà très large) :
 * on propose la zone si possible, sinon le budget, sinon les critères — l'écran
 * doit TOUJOURS avoir quelque chose d'actionnable à montrer, jamais un cul-de-sac.
 */
function fallbackLever(s: SearchSnapshot): Lever {
  if (suggestNeighbourArrs(s.selectedArrIds).length > 0) {
    return {
      kind: 'zone',
      score: 1,
      title: 'Affinons votre recherche',
      suggestion: 'Ajouter un arrondissement limitrophe est le levier le plus rapide.',
      short: 'Élargir la zone',
    }
  }
  if (s.budgetMax != null && s.budgetMax > 0 && s.budgetMax < BUDGET_UNLIMITED) {
    return {
      kind: 'budget',
      score: 1,
      title: 'Affinons votre recherche',
      suggestion: 'Remonter le plafond ouvre mécaniquement le champ des biens visibles.',
      short: 'Ajuster le budget',
    }
  }
  return {
    kind: 'criteria',
    score: 1,
    title: 'Affinons votre recherche',
    suggestion: 'Ajustez vos critères : « souhaité » classe sans exclure.',
    short: 'Ajuster mes critères',
  }
}

/**
 * Choisit le levier à mettre en avant. Renvoie toujours un diagnostic — un
 * intercalaire sans proposition serait pire que pas d'intercalaire du tout.
 */
export function diagnoseSearch(s: SearchSnapshot, trigger: DiagnosisTrigger): Diagnosis {
  const levers = [
    criteriaLever(s, trigger),
    budgetLever(s, trigger),
    zoneLever(s, trigger),
    surfaceLever(s, trigger),
  ].filter((l): l is Lever => l !== null)

  if (levers.length === 0) return { trigger, primary: fallbackLever(s), alternatives: [] }

  levers.sort((a, b) => b.score - a.score)
  return { trigger, primary: levers[0], alternatives: levers.slice(1) }
}
