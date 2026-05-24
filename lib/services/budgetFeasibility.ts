/**
 * Budget feasibility math for the Budget step.
 *
 * Ratio per IRIS = budgetMax / (median €/m² × target surface m²)
 *   > 1.3 → comfortable (sauge)
 *   ≈ 1.0 → average    (sand)
 *   < 0.75 → tight     (terracotta)
 *
 * Colours are interpolated continuously in HSL between three stops, so a
 * ratio of 0.9 doesn't visually snap to the "tight" bucket — it stays close
 * to the "average" hue.
 */

import { irisMedian } from './irisMarketService'

const STOP_TIGHT     = { ratio: 0.75, hex: '#A05A40' } // terracotta atténué
const STOP_AVERAGE   = { ratio: 1.0,  hex: '#C4A87A' } // beige/sable
const STOP_COMFORT   = { ratio: 1.3,  hex: '#7A9E7E' } // vert sauge doux
const NO_DATA_COLOR  = '#C8C0B0'                       // gris neutre

// ─── Color helpers ──────────────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
  const v = hex.replace('#', '')
  const r = parseInt(v.slice(0, 2), 16) / 255
  const g = parseInt(v.slice(2, 4), 16) / 255
  const b = parseInt(v.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break
      case g: h = (b - r) / d + 2;   break
      case b: h = (r - g) / d + 4;   break
    }
    h *= 60
    if (h < 0) h += 360
  }
  return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if      (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else             [r, g, b] = [c, 0, x]
  const m = l - c / 2
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const HSL_TIGHT   = hexToHsl(STOP_TIGHT.hex)
const HSL_AVERAGE = hexToHsl(STOP_AVERAGE.hex)
const HSL_COMFORT = hexToHsl(STOP_COMFORT.hex)

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpHsl(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  // Hue lerp shortest path
  let h0 = a[0], h1 = b[0]
  if (Math.abs(h1 - h0) > 180) {
    if (h1 > h0) h0 += 360
    else         h1 += 360
  }
  return [lerp(h0, h1, t) % 360, lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/**
 * Continuous color for a feasibility ratio.
 *  - ratio ≤ 0.75 clamps to STOP_TIGHT
 *  - ratio ≥ 1.3 clamps to STOP_COMFORT
 *  - between: interpolated through STOP_AVERAGE at ratio = 1.0
 */
export function feasibilityColor(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return NO_DATA_COLOR
  if (ratio <= STOP_TIGHT.ratio) return STOP_TIGHT.hex
  if (ratio >= STOP_COMFORT.ratio) return STOP_COMFORT.hex
  if (ratio <= STOP_AVERAGE.ratio) {
    const t = (ratio - STOP_TIGHT.ratio) / (STOP_AVERAGE.ratio - STOP_TIGHT.ratio)
    const [h, s, l] = lerpHsl(HSL_TIGHT, HSL_AVERAGE, t)
    return hslToHex(h, s, l)
  }
  const t = (ratio - STOP_AVERAGE.ratio) / (STOP_COMFORT.ratio - STOP_AVERAGE.ratio)
  const [h, s, l] = lerpHsl(HSL_AVERAGE, HSL_COMFORT, t)
  return hslToHex(h, s, l)
}

export const NO_DATA_FILL = NO_DATA_COLOR

// ─── Ratio + signal ─────────────────────────────────────────────────────────

export interface FeasibilityPerIris {
  irisId: string
  ratio: number | null  // null when median is unknown
  color: string         // hex (already pre-computed for performance)
}

/**
 * Compute per-IRIS feasibility colours for the current budget + surface.
 * Pure function — cheap enough to call on every slider `input` event.
 */
export function computeFeasibility(
  irisIds: string[],
  budgetMax: number,
  surface: number,
): FeasibilityPerIris[] {
  if (budgetMax <= 0 || surface <= 0) {
    return irisIds.map(id => ({ irisId: id, ratio: null, color: NO_DATA_COLOR }))
  }
  return irisIds.map(id => {
    const m = irisMedian(id)
    if (!m) return { irisId: id, ratio: null, color: NO_DATA_COLOR }
    const ratio = budgetMax / (m.median * surface)
    return { irisId: id, ratio, color: feasibilityColor(ratio) }
  })
}

// ─── Textual signal ─────────────────────────────────────────────────────────

export interface BudgetSignal {
  text: string
  tone: 'comfort' | 'average' | 'tight' | 'very_tight' | 'none'
  /** Median ratio across rated IRIS, or null when nothing is rated. */
  ratio: number | null
}

export function budgetSignal(
  irisIds: string[],
  budgetMax: number,
  surface: number,
): BudgetSignal {
  if (budgetMax <= 0 || surface <= 0 || irisIds.length === 0) {
    return { text: '', tone: 'none', ratio: null }
  }
  const ratios = irisIds
    .map(id => irisMedian(id))
    .filter((m): m is NonNullable<ReturnType<typeof irisMedian>> => m !== null)
    .map(m => budgetMax / (m.median * surface))
  if (ratios.length === 0) {
    return { text: 'Données marché indisponibles sur ces zones', tone: 'none', ratio: null }
  }
  // Use median rather than mean — more robust to a single very-cheap or
  // very-expensive IRIS pulling the average around.
  const sorted = [...ratios].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]

  if (median >= 1.3)  return { text: 'Budget confortable pour vos zones',                 tone: 'comfort',    ratio: median }
  if (median >= 1.0)  return { text: 'Budget dans la moyenne — plusieurs biens accessibles', tone: 'average',    ratio: median }
  if (median >= 0.75) return { text: 'Budget serré — quelques opportunités existent',     tone: 'tight',      ratio: median }
  return                       { text: 'Budget très limité pour ces zones',                  tone: 'very_tight', ratio: median }
}
