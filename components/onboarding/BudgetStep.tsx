'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle } from 'lucide-react'
import { useSearchStore } from '@/lib/searchStore'
import { budgetSignal, medianBudgetFor } from '@/lib/services/budgetFeasibility'
import {
  fetchParisGeoData,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '@/lib/services/geoDataService'
import BudgetFeasibilityMap from './BudgetFeasibilityMap'

// Non-linear budget scale — denser at the bottom, coarser at the top:
//    50 000 →   400 000 €   step  25 000
//   450 000 → 1 000 000 €   step  50 000
// 1 100 000 → 2 000 000 €   step 100 000
// 2 500 000 → 5 000 000 €   step 500 000
// 5 000 001 €  = sentinel for the "5 M€+" position. Stored verbatim in the
// search store; downstream consumers should treat any budgetMax ≥ this
// constant as "no upper limit". Exported for that purpose.
export const BUDGET_UNLIMITED = 5_000_001
const UNLIMITED_SENTINEL = BUDGET_UNLIMITED
function buildBudgetScale(): number[] {
  const steps: number[] = []
  for (let v =    50_000; v <=   400_000; v +=  25_000) steps.push(v)
  for (let v =   450_000; v <= 1_000_000; v +=  50_000) steps.push(v)
  for (let v = 1_100_000; v <= 2_000_000; v += 100_000) steps.push(v)
  for (let v = 2_500_000; v <= 5_000_000; v += 500_000) steps.push(v)
  steps.push(UNLIMITED_SENTINEL)
  return steps
}
const SCALE = buildBudgetScale()
const SCALE_MAX_INDEX = SCALE.length - 1
const INITIAL_MIN_INDEX = 0  // 50 000 € — the absolute lower bound
const FALLBACK_MAX_INDEX = SCALE.indexOf(500_000)

function formatBudget(value: number): string {
  if (value >= UNLIMITED_SENTINEL) return '5 M€+'
  if (value === 0) return '0'
  if (value >= 1_000_000) {
    const m = value / 1_000_000
    return Number.isInteger(m) ? `${m} M€` : `${m.toFixed(1).replace('.', ',')} M€`
  }
  return `${(value / 1_000).toLocaleString('fr-FR')} K€`
}

const TONE_DOT: Record<string, string> = {
  comfort: '#7A9E7E',
  average: '#C4A87A',
  tight: '#A05A40',
  very_tight: '#7A3A28',
  none: '#A3A3A3',
}

interface BudgetStepProps {
  onNext: () => void
  onSkip: () => void
}

export default function BudgetStep({ onNext, onSkip }: BudgetStepProps) {
  const {
    setBudgetRange, budgetMin, budgetMax,
    minSurface,
    selectedIrisIds, selectedArrIds, selectedQuartierIds, selectedCommuneIds,
  } = useSearchStore()

  // Surface is supposed to be set in the previous "Bien" step. If somehow
  // missing, fall back to the BienStep's default so the math still works.
  const surface = minSurface ?? 50

  // ── Resolve the effective IRIS set ───────────────────────────────────────
  // The Quartiers step may leave only arrondissements / quartiers / communes
  // populated when the user never zoomed deep enough for IRIS to load (a
  // zoom-12 click on arr-12 records selectedArrIds but childIrisIds=[]).
  // We expand here so the budget step always works at the IRIS grain
  // regardless of how the user selected upstream.
  const [effectiveIrisZones, setEffectiveIrisZones] = useState<GeoZone[]>([])
  const [irisLoading, setIrisLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [geoData, communes] = await Promise.all([
          fetchParisGeoData(),
          fetchSuburbanCommunes(),
        ])
        const allIris = await fetchParisIris(geoData.quartiers, communes)
        if (cancelled) return

        const direct = new Set(selectedIrisIds)
        const quSet  = new Set(selectedQuartierIds)
        const comSet = new Set(selectedCommuneIds)
        const arrSet = new Set(selectedArrIds)
        // arr → quartiers index for fast lookup
        const arrChildQuartiers = new Map<string, Set<string>>()
        for (const qu of geoData.quartiers) {
          if (!qu.parentId) continue
          if (!arrChildQuartiers.has(qu.parentId)) arrChildQuartiers.set(qu.parentId, new Set())
          arrChildQuartiers.get(qu.parentId)!.add(qu.id)
        }

        const picked: GeoZone[] = []
        for (const iris of allIris) {
          if (direct.has(iris.id)) { picked.push(iris); continue }
          const parent = iris.parentId
          if (!parent) continue
          if (quSet.has(parent)) { picked.push(iris); continue }
          if (comSet.has(parent)) { picked.push(iris); continue }
          // grandparent (arrondissement) match
          for (const arr of arrSet) {
            if (arrChildQuartiers.get(arr)?.has(parent)) { picked.push(iris); break }
          }
        }

        if (!cancelled) {
          setEffectiveIrisZones(picked)
          setIrisLoading(false)
        }
      } catch (e) {
        console.error('[BudgetStep] effective IRIS resolution failed', e)
        if (!cancelled) setIrisLoading(false)
      }
    })()
    return () => { cancelled = true }
    // Re-resolve when the upstream selection identity changes.
  }, [selectedIrisIds.join('|'), selectedArrIds.join('|'), selectedQuartierIds.join('|'), selectedCommuneIds.join('|')])

  const effectiveIrisIds = useMemo(
    () => effectiveIrisZones.map(z => z.id),
    [effectiveIrisZones],
  )

  // ── Slider state ─────────────────────────────────────────────────────────
  // Initial min: 50K (or whatever the user committed last time).
  // Initial max: 500K fallback while IRIS data is still loading; once we have
  //   effective IRIS, recompute median(medians) × surface and snap the thumb,
  //   but only if the user hasn't already touched the slider this session.
  const initialMinIndex = useMemo(
    () => (budgetMin == null ? INITIAL_MIN_INDEX : findClosestIndex(budgetMin)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const initialMaxIndex = useMemo(
    () => (budgetMax == null ? FALLBACK_MAX_INDEX : findClosestIndex(budgetMax)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [minIndex, setMinIndex] = useState<number>(initialMinIndex)
  const [maxIndex, setMaxIndex] = useState<number>(initialMaxIndex)
  const userTouchedRef = useRef(false)
  const initialMaxAppliedRef = useRef(budgetMax != null)

  // Persist defaults once on mount so the user can leave without touching.
  useEffect(() => {
    if (budgetMin == null || budgetMax == null) {
      setBudgetRange(SCALE[initialMinIndex], SCALE[initialMaxIndex])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Once effective IRIS resolve, snap the max thumb to the market-median
  // budget (ratio = 1.0), unless the user is already driving the slider.
  useEffect(() => {
    if (irisLoading) return
    if (userTouchedRef.current) return
    if (initialMaxAppliedRef.current) return
    const med = medianBudgetFor(effectiveIrisIds, surface)
    if (med == null) return
    const idx = findClosestIndex(med)
    initialMaxAppliedRef.current = true
    setMaxIndex(idx)
    setBudgetRange(SCALE[minIndex], SCALE[idx])
  }, [irisLoading, effectiveIrisIds, surface, minIndex, setBudgetRange])

  const minValue = SCALE[minIndex]
  const maxValue = SCALE[maxIndex]

  const commit = (lo: number, hi: number) => {
    setBudgetRange(SCALE[lo], SCALE[hi])
  }

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    userTouchedRef.current = true
    const idx = Number(e.target.value)
    const next = Math.min(idx, maxIndex)
    setMinIndex(next)
    commit(next, maxIndex)
  }
  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    userTouchedRef.current = true
    const idx = Number(e.target.value)
    const next = Math.max(idx, minIndex)
    setMaxIndex(next)
    commit(minIndex, next)
  }

  // ── Track progress for the active fill segment ───────────────────────────
  const trackProgress = useMemo(() => {
    const lo = (minIndex / SCALE_MAX_INDEX) * 100
    const hi = (maxIndex / SCALE_MAX_INDEX) * 100
    return { lo, hi }
  }, [minIndex, maxIndex])

  // ── Signal ───────────────────────────────────────────────────────────────
  const signal = useMemo(
    () => budgetSignal(effectiveIrisIds, maxValue, surface),
    [effectiveIrisIds, maxValue, surface],
  )
  const dotColor = TONE_DOT[signal.tone] ?? TONE_DOT.none
  const hasAnySelection =
    effectiveIrisIds.length > 0 ||
    selectedIrisIds.length > 0 ||
    selectedArrIds.length > 0 ||
    selectedQuartierIds.length > 0 ||
    selectedCommuneIds.length > 0

  return (
    <div className="flex flex-col h-full px-4" style={{ overscrollBehavior: 'none', overflow: 'hidden' }}>
      {/* Header — compact, same vibe as the Quartiers step */}
      <motion.div
        className="flex-none pt-3 pb-2"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-[22px] font-bold text-neutral-900 leading-tight tracking-tight">
          Quel est votre budget&nbsp;?
        </h2>
        <p className="text-[13px] text-neutral-600 mt-1">
          Glissez les bornes pour cadrer votre fourchette.
        </p>
      </motion.div>

      {/* Slider + values + signal */}
      <div className="flex-none mt-1">
        <div className="flex items-baseline justify-between px-1 mb-2.5">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-600 mb-0.5">Minimum</p>
            <p className="text-[17px] font-bold tabular-nums leading-none" style={{ color: '#914E3C' }}>
              {formatBudget(minValue)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-600 mb-0.5">Maximum</p>
            <p className="text-[17px] font-bold tabular-nums leading-none" style={{ color: '#914E3C' }}>
              {formatBudget(maxValue)}
            </p>
          </div>
        </div>

        <div className="shomee-dual-slider">
          <div
            className="shomee-dual-slider-track"
            style={{
              backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.08) ${trackProgress.lo}%, #914E3C ${trackProgress.lo}%, #914E3C ${trackProgress.hi}%, rgba(0,0,0,0.08) ${trackProgress.hi}%)`,
            }}
          />
          <input
            type="range" min={0} max={SCALE_MAX_INDEX} step={1}
            value={minIndex} onChange={handleMinChange}
            aria-label="Budget minimum"
            className="shomee-dual-slider-input shomee-dual-slider-input-min"
          />
          <input
            type="range" min={0} max={SCALE_MAX_INDEX} step={1}
            value={maxIndex} onChange={handleMaxChange}
            aria-label="Budget maximum"
            className="shomee-dual-slider-input shomee-dual-slider-input-max"
          />
        </div>

        {/* Signal — short phrase + colour dot */}
        <div className="mt-3 flex items-center gap-2 min-h-[20px]">
          {signal.text ? (
            <>
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: dotColor }}
                aria-hidden
              />
              <p className="text-[13px] font-medium text-neutral-900 leading-snug">
                {signal.text}
              </p>
            </>
          ) : hasAnySelection ? (
            <p className="text-[13px] text-neutral-600 leading-snug">
              Préparation de la lecture marché…
            </p>
          ) : (
            <p className="text-[13px] text-neutral-600 leading-snug">
              Sélectionnez d&apos;abord vos quartiers pour activer la lecture marché.
            </p>
          )}
        </div>
      </div>

      {/* Square feasibility map — receives geometries directly, no fetch here */}
      <div className="flex-none mt-3">
        <BudgetFeasibilityMap
          irisZones={effectiveIrisZones}
          loading={irisLoading}
          budgetMax={maxValue}
          surface={surface}
        />
      </div>

      <div className="flex-1 min-h-0" />

      {/* CTAs */}
      <div
        className="flex-none flex flex-col gap-1.5 pt-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
      >
        <button
          onClick={onNext}
          className="w-full py-3.5 rounded-2xl font-semibold text-[15px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
          style={{ backgroundColor: '#914E3C' }}
        >
          <CheckCircle size={16} />
          Valider mon budget
          <span className="bg-white/20 text-[12px] px-2 py-0.5 rounded-full">3 / 4</span>
        </button>
        <button
          onClick={onSkip}
          className="w-full py-2 text-[13px] font-medium text-neutral-600 active:text-neutral-800 transition-colors"
        >
          Passer cette étape
        </button>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function findClosestIndex(value: number): number {
  let best = 0
  let bestDiff = Number.POSITIVE_INFINITY
  for (let i = 0; i < SCALE.length; i++) {
    const d = Math.abs(SCALE[i] - value)
    if (d < bestDiff) { bestDiff = d; best = i }
  }
  return best
}
