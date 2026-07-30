'use client'

/**
 * S9 — résumé ultra-court du brief, affiché en HAUT de l'écran de chargement
 * quand on arrive depuis un lien généré par un LLM (/h/<token>).
 *
 * C'est le seul endroit du parcours web où l'utilisateur voit que sa
 * conversation ChatGPT/Claude a bien été transmise. Sur la vidéo qui suit,
 * on n'affiche RIEN de plus : l'attention doit aller au visionnage.
 *
 * Volontairement plus pauvre que le récap (AIBriefRecap) : quelques lignes
 * lisibles en deux secondes, pas un formulaire. Afficher un brief complet et
 * modifiable dès l'arrivée promettrait une finesse de filtrage que des
 * critères donnés en trois phrases à un LLM ne peuvent pas tenir.
 */

import {
  useSearchStore,
  ROOMS_MAX,
  BEDROOMS_MAX,
  type ChipState,
} from '@/lib/searchStore'
import { SURFACE_UNLIMITED } from './BienStep'
import { BUDGET_UNLIMITED } from './BudgetStep'

export interface BriefSummary {
  /** Zone telle que la personne l'a formulée, ou son libellé résolu. */
  zone: string | null
  /** « Appartement · 3p+ · 60 m² min » */
  bien: string | null
  /** « ≤ 750 K€ » */
  budget: string | null
  /** Critères qualifiés, obligatoires d'abord. */
  criteres: string[]
}

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  appartement: 'Appartement',
  maison: 'Maison',
  loft: 'Loft',
  atelier: 'Atelier',
}

/** Au-delà, l'écran redevient un formulaire — donc on coupe. */
const MAX_CRITERES = 5

function fmtMoney(v: number): string {
  if (v >= BUDGET_UNLIMITED) return '5 M€+'
  if (v >= 1_000_000) {
    const m = v / 1_000_000
    return Number.isInteger(m) ? `${m} M€` : `${m.toFixed(1).replace('.', ',')} M€`
  }
  return `${(v / 1_000).toLocaleString('fr-FR')} K€`
}

function fmtBudget(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null
  if (min == null) return `≤ ${fmtMoney(max!)}`
  if (max == null) return `≥ ${fmtMoney(min)}`
  return `${fmtMoney(min)} – ${fmtMoney(max)}`
}

function fmtRooms(min: number | null, max: number | null): string | null {
  const label = (v: number) => (v <= 1 ? 'Studio' : v >= ROOMS_MAX ? '7p+' : `${v}p`)
  if (min == null && max == null) return null
  if (min != null && max != null) {
    return min === max ? label(min) : `${label(min)} – ${label(max)}`
  }
  if (min != null) return `${label(min)}+`
  return `≤ ${label(max!)}`
}

function fmtBedrooms(min: number | null): string | null {
  if (min == null) return null
  return min >= BEDROOMS_MAX ? '6+ ch' : `${min} ch`
}

function fmtSurface(min: number | null, max: number | null): string | null {
  const fmt = (v: number) => (v >= SURFACE_UNLIMITED ? '500 m²+' : `${v} m²`)
  if (min == null && max == null) return null
  if (min == null) return `≤ ${fmt(max!)}`
  if (max == null) return `${fmt(min)} min`
  return `${fmt(min)} – ${fmt(max)}`
}

/**
 * Instantané du store, pris une fois après l'injection du brief.
 * Lecture via getState() : aucun abonnement, donc aucun re-rendu parasite.
 */
export function buildBriefSummary(): BriefSummary {
  const s = useSearchStore.getState()

  const bienParts = [
    s.propertyTypes.length > 0
      ? s.propertyTypes.map((t) => PROPERTY_TYPE_LABELS[t] ?? t).join(', ')
      : null,
    fmtRooms(s.minRooms, s.maxRooms),
    fmtBedrooms(s.minBedrooms),
    fmtSurface(s.minSurface, s.maxSurface),
  ].filter((p): p is string => Boolean(p))

  // Obligatoires (2) avant souhaités (1). L'état 3 est une exclusion : il n'a
  // rien à faire dans un résumé d'accueil, qui dit ce qu'on cherche.
  const chips = Object.entries(s.chipStates ?? {}) as Array<[string, ChipState]>
  const customs = (s.customCriteria ?? []).map(
    (c) => [c.label, c.state as ChipState] as [string, ChipState],
  )
  const criteres = [...chips, ...customs]
    .filter(([label, state]) => Boolean(label) && (state === 1 || state === 2))
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label)
    .slice(0, MAX_CRITERES)

  return {
    zone: (s.locationLabel || s.locationQuery || '').trim() || null,
    bien: bienParts.length > 0 ? bienParts.join(' · ') : null,
    budget: fmtBudget(s.budgetMin, s.budgetMax),
    criteres,
  }
}
