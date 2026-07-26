/**
 * Échelles non-linéaires + formatters de l'onboarding — répliqués des composants
 * WEB (`BienStep` / `BudgetStep` / `AIBriefRecap`) qui les définissent HORS de
 * `@shomee/core`. Centralisés ici pour le funnel manuel natif (S7) : le
 * `RangeSlider` opère sur l'INDEX dans l'échelle (domaine linéaire 0..N-1), les
 * étapes mappent index↔valeur, et le récap réutilise les mêmes formatters.
 *
 * Aucun `Intl`/`toLocaleString` (Hermes a un support partiel) — formatage manuel.
 */
import { ROOMS_MAX, BEDROOMS_MAX } from '@shomee/core/stores/searchStore'

// ─── Surface (miroir BienStep.SURFACE_SCALE) ─────────────────────────────────
// 10→100 pas 5 · 100→200 pas 10 · 200→500 pas 50 · 999 = sentinelle « sans max ».
export const SURFACE_UNLIMITED = 999
export const SURFACE_SCALE: number[] = (() => {
  const s: number[] = []
  for (let v = 10; v <= 100; v += 5) s.push(v)
  for (let v = 110; v <= 200; v += 10) s.push(v)
  for (let v = 250; v <= 500; v += 50) s.push(v)
  s.push(SURFACE_UNLIMITED)
  return s
})()
export const SURFACE_MAX_INDEX = SURFACE_SCALE.length - 1
export const SURFACE_DEFAULT_MIN = 30

export function formatSurface(v: number): string {
  return v >= SURFACE_UNLIMITED ? '500 m² +' : `${v} m²`
}
export function surfaceIndex(v: number): number {
  return closestIndex(SURFACE_SCALE, v)
}

// ─── Budget (miroir BudgetStep.SCALE) ────────────────────────────────────────
// 50k→400k pas 25k · 450k→1M pas 50k · 1.1M→2M pas 100k · 2.5M→5M pas 500k ·
// 5_000_001 = sentinelle « 5 M€+ ».
export const BUDGET_UNLIMITED = 5_000_001
export const BUDGET_SCALE: number[] = (() => {
  const s: number[] = []
  for (let v = 50_000; v <= 400_000; v += 25_000) s.push(v)
  for (let v = 450_000; v <= 1_000_000; v += 50_000) s.push(v)
  for (let v = 1_100_000; v <= 2_000_000; v += 100_000) s.push(v)
  for (let v = 2_500_000; v <= 5_000_000; v += 500_000) s.push(v)
  s.push(BUDGET_UNLIMITED)
  return s
})()
export const BUDGET_MAX_INDEX = BUDGET_SCALE.length - 1
export const BUDGET_DEFAULT_MAX = 500_000

export function formatBudget(v: number): string {
  if (v >= BUDGET_UNLIMITED) return '5 M€+'
  if (v <= 0) return '0'
  if (v >= 1_000_000) {
    const m = v / 1_000_000
    return Number.isInteger(m) ? `${m} M€` : `${m.toFixed(1).replace('.', ',')} M€`
  }
  return `${Math.round(v / 1000)} K€`
}
export function budgetIndex(v: number): number {
  return closestIndex(BUDGET_SCALE, v)
}

// ─── Pièces / chambres (échelles linéaires — le RangeSlider opère sur la valeur
//     directement ; seul le formatage vit ici) ──────────────────────────────
export function formatRooms(v: number): string {
  if (v <= 1) return 'Studio'
  if (v >= ROOMS_MAX) return `${ROOMS_MAX}p +`
  return `${v}p`
}
export function formatBedrooms(v: number): string {
  if (v >= BEDROOMS_MAX) return `${BEDROOMS_MAX} ch +`
  return `${v} ch`
}

/** Index de l'entrée d'échelle la plus proche d'une valeur (init des sliders). */
function closestIndex(scale: number[], v: number): number {
  let best = 0
  let bestDiff = Number.POSITIVE_INFINITY
  for (let i = 0; i < scale.length; i++) {
    const d = Math.abs(scale[i] - v)
    if (d < bestDiff) {
      bestDiff = d
      best = i
    }
  }
  return best
}
