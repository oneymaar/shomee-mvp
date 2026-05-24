/**
 * Budget feasibility math for the Budget step.
 *
 * Ratio per IRIS = budgetMax / (median €/m² × target surface m²)
 *   ≥ 1.3 → comfortable (sauge)
 *   ≈ 1.0 → average    (sand)
 *   ≤ 0.7 → tight      (terracotta)
 *
 * Colours are interpolated continuously in HSL between three stops, so a
 * ratio of 0.9 doesn't visually snap to the "tight" bucket — it stays close
 * to the "average" hue.
 *
 * When centroids are provided, we add a small spatial-noise jitter to the
 * median (±15%) and the ratio (±5%). The jitter is deterministic per
 * centroid (sin/cos on lng/lat), so adjacent IRIS get smooth gradients
 * rather than a tiled-checker look — until the real data lands.
 */

import { irisMedian } from './irisMarketService'

const STOP_TIGHT   = { ratio: 0.7, hex: '#A05A40' } // terracotta atténué
const STOP_AVERAGE = { ratio: 1.0, hex: '#C4A87A' } // beige/sable
const STOP_COMFORT = { ratio: 1.3, hex: '#7A9E7E' } // vert sauge doux
const NO_DATA_COLOR = '#C8C0B0'                     // gris neutre

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
  // Hue lerp via shortest arc
  let h0 = a[0], h1 = b[0]
  if (Math.abs(h1 - h0) > 180) {
    if (h1 > h0) h0 += 360
    else         h1 += 360
  }
  return [lerp(h0, h1, t) % 360, lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/**
 * Continuous color for a feasibility ratio.
 *  - ratio ≤ 0.7 clamps to STOP_TIGHT
 *  - ratio ≥ 1.3 clamps to STOP_COMFORT
 *  - between: interpolated through STOP_AVERAGE at ratio = 1.0
 */
export function feasibilityColor(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return NO_DATA_COLOR
  const clamped = Math.max(STOP_TIGHT.ratio, Math.min(STOP_COMFORT.ratio, ratio))
  if (clamped <= STOP_AVERAGE.ratio) {
    const t = (clamped - STOP_TIGHT.ratio) / (STOP_AVERAGE.ratio - STOP_TIGHT.ratio)
    const [h, s, l] = lerpHsl(HSL_TIGHT, HSL_AVERAGE, t)
    return hslToHex(h, s, l)
  }
  const t = (clamped - STOP_AVERAGE.ratio) / (STOP_COMFORT.ratio - STOP_AVERAGE.ratio)
  const [h, s, l] = lerpHsl(HSL_AVERAGE, HSL_COMFORT, t)
  return hslToHex(h, s, l)
}

export const NO_DATA_FILL = NO_DATA_COLOR

// ─── Spatial noise (mock-only — remove when real per-IRIS data lands) ──────
// Deterministic [-1, 1] value, smoothly varying across space and guaranteed
// distinct per IRIS even when two centroids land very close. Combines:
//   (a) multi-frequency sin/cos on lat/lng — smooth gradients between neighbours
//   (b) hash on the IRIS code — guarantees a distinct value per polygon
// Equal weighting so adjacent IRIS stay close in colour but never identical.
function spatialNoise(lng: number, lat: number): number {
  const f1 = Math.sin(lng * 30 + 0.31) * Math.cos(lat * 30 + 0.17)
  const f2 = Math.sin(lng * 78 + 1.91) * Math.cos(lat * 78 + 0.83) * 0.5
  const f3 = Math.sin(lng * 165 + 2.71) * Math.cos(lat * 165 + 1.13) * 0.25
  return (f1 + f2 + f3) / 1.75 // ~ [-1, 1]
}
function irisCodeNoise(id: string): number {
  // Cheap deterministic hash → [-1, 1]
  let h = 2166136261 | 0
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // Spread a bit more by also stirring the high bits
  h ^= h >>> 13
  return ((h >>> 0) / 0xffffffff) * 2 - 1
}

// ─── Ratio + signal ─────────────────────────────────────────────────────────

export interface IrisInput {
  id: string
  /** [lng, lat] — when present, enables spatial-noise mock + intra-zone radiance. */
  centroid?: [number, number]
}

export interface FeasibilityPerIris {
  irisId: string
  ratio: number | null
  color: string
}

/**
 * Compute per-IRIS feasibility colours for the current budget + surface.
 * Pure function — cheap enough to call on every slider `input` event.
 */
export function computeFeasibility(
  iris: IrisInput[],
  budgetMax: number,
  surface: number,
): FeasibilityPerIris[] {
  if (budgetMax <= 0 || surface <= 0) {
    return iris.map(i => ({ irisId: i.id, ratio: null, color: NO_DATA_COLOR }))
  }
  return iris.map(i => {
    const m = irisMedian(i.id)
    if (!m) return { irisId: i.id, ratio: null, color: NO_DATA_COLOR }
    // Mock-only realism: spread the per-commune flat fallback into a smooth
    // ±20% variation per IRIS. Mix the spatial term (smooth gradient between
    // neighbours) with a per-code hash (guarantees distinct values even when
    // centroids collide). Drop this whole block when the batch script lands
    // real per-IRIS medians.
    let median = m.median
    if (i.centroid) {
      const ns = spatialNoise(i.centroid[0], i.centroid[1])
      const nh = irisCodeNoise(i.id)
      const n = ns * 0.6 + nh * 0.4
      median = median * (1 + n * 0.20)
    } else {
      median = median * (1 + irisCodeNoise(i.id) * 0.20)
    }
    const ratio = budgetMax / (median * surface)
    return { irisId: i.id, ratio, color: feasibilityColor(ratio) }
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
  const sorted = [...ratios].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]

  if (median >= 1.3)  return { text: 'Budget confortable pour vos zones',                    tone: 'comfort',    ratio: median }
  if (median >= 1.0)  return { text: 'Budget dans la moyenne — plusieurs biens accessibles', tone: 'average',    ratio: median }
  if (median >= 0.7)  return { text: 'Budget serré — quelques opportunités existent',        tone: 'tight',      ratio: median }
  return                       { text: 'Budget très limité pour ces zones',                    tone: 'very_tight', ratio: median }
}

/**
 * Synchronous helper used by BudgetStep to derive the initial max slider
 * position: median(medians) × surface — i.e. exactly the "ratio = 1.0"
 * budget for the user's selected IRIS. Returns null when no rated IRIS.
 */
export function medianBudgetFor(irisIds: string[], surface: number): number | null {
  if (irisIds.length === 0 || surface <= 0) return null
  const medians = irisIds
    .map(id => irisMedian(id))
    .filter((m): m is NonNullable<ReturnType<typeof irisMedian>> => m !== null)
    .map(m => m.median)
  if (medians.length === 0) return null
  const sorted = [...medians].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const med = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
  return Math.round(med * surface)
}
