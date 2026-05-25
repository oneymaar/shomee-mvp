'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useSearchStore, type PropertyType } from '@/lib/searchStore'

const PROPERTY_TYPES: Array<{ value: PropertyType; label: string; emoji: string }> = [
  { value: 'appartement', label: 'Appartement', emoji: '🏢' },
  { value: 'maison', label: 'Maison', emoji: '🏡' },
  { value: 'loft', label: 'Loft', emoji: '🏗️' },
  { value: 'atelier', label: 'Atelier', emoji: '🛠️' },
]

const ROOM_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Studio' },
  { value: 2, label: '2 pièces' },
  { value: 3, label: '3 pièces' },
  { value: 4, label: '4 pièces +' },
]

// Non-linear surface scale — finer at the bottom, coarser at the top:
//    10 →  100 m²   step  5
//   100 →  200 m²   step 10
//   200 →  500 m²   step 50
//   500+ m²  = sentinel for "no upper limit" (stored verbatim as 999;
//   downstream consumers should treat any maxSurface ≥ this as unbounded).
export const SURFACE_UNLIMITED = 999
function buildSurfaceScale(): number[] {
  const steps: number[] = []
  for (let v =  10; v <= 100; v += 5)  steps.push(v)
  for (let v = 110; v <= 200; v += 10) steps.push(v)
  for (let v = 250; v <= 500; v += 50) steps.push(v)
  steps.push(SURFACE_UNLIMITED)
  return steps
}
const SURFACE_SCALE = buildSurfaceScale()
const SURFACE_SCALE_MAX_INDEX = SURFACE_SCALE.length - 1
// Defaults: 30 m² → 70 m² — covers the median Paris flat without locking
// the user into studio-only or large-only territory.
const SURFACE_DEFAULT_MIN_INDEX = SURFACE_SCALE.indexOf(30)
const SURFACE_DEFAULT_MAX_INDEX = SURFACE_SCALE.indexOf(70)

function formatSurface(v: number): string {
  if (v >= SURFACE_UNLIMITED) return '500 m²+'
  return `${v} m²`
}
function findClosestSurfaceIndex(v: number): number {
  let best = 0
  let bestDiff = Number.POSITIVE_INFINITY
  for (let i = 0; i < SURFACE_SCALE.length; i++) {
    const d = Math.abs(SURFACE_SCALE[i] - v)
    if (d < bestDiff) { bestDiff = d; best = i }
  }
  return best
}

interface BienStepProps {
  onNext: () => void
  onSkip: () => void
}

export default function BienStep({ onNext, onSkip }: BienStepProps) {
  const {
    togglePropertyType, setPropertyTypes, propertyTypes,
    setMinRooms, minRooms,
    setSurface, minSurface, maxSurface,
  } = useSearchStore()

  // ── Local UI state ────────────────────────────────────────────────────────
  // "Indifférent" / "Peu importe" are visual-only — they clear the underlying
  // store fields. We track the explicit click so the chip can stay highlighted
  // (otherwise it would be indistinguishable from "user hasn't touched it").
  const [typeIndifferent, setTypeIndifferent] = useState(false)
  const [roomsAny, setRoomsAny] = useState(false)

  // Surface dual-slider — same pattern as the Budget step.
  const initialSurfaceMinIndex = useMemo(
    () => (minSurface == null ? SURFACE_DEFAULT_MIN_INDEX : findClosestSurfaceIndex(minSurface)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const initialSurfaceMaxIndex = useMemo(
    () => (maxSurface == null ? SURFACE_DEFAULT_MAX_INDEX : findClosestSurfaceIndex(maxSurface)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [surfMinIndex, setSurfMinIndex] = useState<number>(initialSurfaceMinIndex)
  const [surfMaxIndex, setSurfMaxIndex] = useState<number>(initialSurfaceMaxIndex)

  // Persist defaults once on mount so the user can leave without touching
  // and still have a surface range recorded.
  useEffect(() => {
    if (minSurface == null || maxSurface == null) {
      setSurface(SURFACE_SCALE[initialSurfaceMinIndex], SURFACE_SCALE[initialSurfaceMaxIndex])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handlePropertyType = (value: PropertyType) => {
    setTypeIndifferent(false)
    togglePropertyType(value)
  }
  const handleTypeIndifferent = () => {
    setTypeIndifferent(true)
    setPropertyTypes([])
  }

  const handleRooms = (value: number) => {
    setRoomsAny(false)
    setMinRooms(minRooms === value ? null : value)
  }
  const handleRoomsAny = () => {
    setRoomsAny(true)
    setMinRooms(null)
  }

  const commitSurface = (lo: number, hi: number) => {
    setSurface(SURFACE_SCALE[lo], SURFACE_SCALE[hi])
  }
  const handleSurfaceMin = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = Number(e.target.value)
    const next = Math.min(idx, surfMaxIndex)
    setSurfMinIndex(next)
    commitSurface(next, surfMaxIndex)
  }
  const handleSurfaceMax = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = Number(e.target.value)
    const next = Math.max(idx, surfMinIndex)
    setSurfMaxIndex(next)
    commitSurface(surfMinIndex, next)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const surfaceMinValue = SURFACE_SCALE[surfMinIndex]
  const surfaceMaxValue = SURFACE_SCALE[surfMaxIndex]
  const surfaceTrack = useMemo(() => {
    const lo = (surfMinIndex / SURFACE_SCALE_MAX_INDEX) * 100
    const hi = (surfMaxIndex / SURFACE_SCALE_MAX_INDEX) * 100
    return { lo, hi }
  }, [surfMinIndex, surfMaxIndex])

  // The Bien step always commits a default surface range on mount, so the
  // user can continue at any point. Surface is no longer part of canContinue.
  const canContinue = true

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-5 flex-shrink-0">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="text-[22px] font-bold text-neutral-900 leading-tight">
            Votre bien
          </h2>
          <p className="text-[14px] text-neutral-600 mt-1.5">
            Quelques infos pour cadrer votre cible.
          </p>
        </motion.div>
      </div>

      {/* Scrollable body */}
      <div className="px-6 flex-1 overflow-y-auto pb-4">
        {/* Type de bien */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-600 mb-3">
            Type de bien
          </p>
          <div className="flex flex-wrap gap-2.5 mb-7">
            {PROPERTY_TYPES.map((pt) => {
              const isSelected = !typeIndifferent && propertyTypes.includes(pt.value)
              return (
                <button
                  key={pt.value}
                  onClick={() => handlePropertyType(pt.value)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full border text-[14px] font-medium transition-all active:scale-95"
                  style={{
                    backgroundColor: isSelected ? '#914E3C' : 'white',
                    color: isSelected ? 'white' : '#1a1a1a',
                    borderColor: isSelected ? '#914E3C' : 'rgba(0,0,0,0.08)',
                  }}
                >
                  <span>{pt.emoji}</span>
                  <span>{pt.label}</span>
                </button>
              )
            })}
            <button
              onClick={handleTypeIndifferent}
              className="px-4 py-2.5 rounded-full border text-[14px] font-medium transition-all active:scale-95"
              style={{
                backgroundColor: typeIndifferent ? '#914E3C' : 'white',
                color: typeIndifferent ? 'white' : '#1a1a1a',
                borderColor: typeIndifferent ? '#914E3C' : 'rgba(0,0,0,0.08)',
              }}
            >
              Indifférent
            </button>
          </div>
        </motion.div>

        {/* Surface — dual-thumb range, same component as the Budget slider */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-600 mb-3">
            Surface
          </p>
          <div className="flex items-baseline justify-between px-1 mb-2.5">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-600 mb-0.5">Minimum</p>
              <p className="text-[17px] font-bold tabular-nums leading-none" style={{ color: '#914E3C' }}>
                {formatSurface(surfaceMinValue)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-600 mb-0.5">Maximum</p>
              <p className="text-[17px] font-bold tabular-nums leading-none" style={{ color: '#914E3C' }}>
                {formatSurface(surfaceMaxValue)}
              </p>
            </div>
          </div>
          <div className="shomee-dual-slider mb-7">
            <div
              className="shomee-dual-slider-track"
              style={{
                backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.08) ${surfaceTrack.lo}%, #914E3C ${surfaceTrack.lo}%, #914E3C ${surfaceTrack.hi}%, rgba(0,0,0,0.08) ${surfaceTrack.hi}%)`,
              }}
            />
            <input
              type="range" min={0} max={SURFACE_SCALE_MAX_INDEX} step={1}
              value={surfMinIndex} onChange={handleSurfaceMin}
              aria-label="Surface minimum"
              className="shomee-dual-slider-input shomee-dual-slider-input-min"
            />
            <input
              type="range" min={0} max={SURFACE_SCALE_MAX_INDEX} step={1}
              value={surfMaxIndex} onChange={handleSurfaceMax}
              aria-label="Surface maximum"
              className="shomee-dual-slider-input shomee-dual-slider-input-max"
            />
          </div>
        </motion.div>

        {/* Pièces */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-600 mb-3">
            Nombre de pièces
          </p>
          <div className="flex gap-2.5 flex-wrap">
            {ROOM_OPTIONS.map((opt) => {
              const isSelected = !roomsAny && minRooms === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => handleRooms(opt.value)}
                  className="px-4 py-2.5 rounded-full border text-[14px] font-medium transition-all active:scale-95"
                  style={{
                    backgroundColor: isSelected ? '#914E3C' : 'white',
                    color: isSelected ? 'white' : '#1a1a1a',
                    borderColor: isSelected ? '#914E3C' : 'rgba(0,0,0,0.08)',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
            <button
              onClick={handleRoomsAny}
              className="px-4 py-2.5 rounded-full border text-[14px] font-medium transition-all active:scale-95"
              style={{
                backgroundColor: roomsAny ? '#914E3C' : 'white',
                color: roomsAny ? 'white' : '#1a1a1a',
                borderColor: roomsAny ? '#914E3C' : 'rgba(0,0,0,0.08)',
              }}
            >
              Peu importe
            </button>
          </div>
        </motion.div>
      </div>

      {/* CTAs */}
      <div
        className="px-6 pt-4 pb-10 flex flex-col gap-3 flex-shrink-0"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 32px)' }}
      >
        <button
          onClick={onNext}
          className="w-full py-4 rounded-2xl font-semibold text-[16px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
          style={{ backgroundColor: '#914E3C' }}
        >
          {canContinue ? 'Continuer' : 'Passer'}
          <ChevronRight size={18} />
        </button>
        {canContinue && (
          <button
            onClick={onSkip}
            className="w-full py-3 text-[14px] font-medium text-neutral-600 active:text-neutral-800 transition-colors"
          >
            Passer cette étape
          </button>
        )}
      </div>
    </div>
  )
}
