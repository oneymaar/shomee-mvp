'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import {
  useSearchStore,
  type PropertyType,
  ROOMS_MIN,
  ROOMS_MAX,
  BEDROOMS_MIN,
  BEDROOMS_MAX,
} from '@/lib/searchStore'

const PROPERTY_TYPES: Array<{ value: PropertyType; label: string; emoji: string }> = [
  { value: 'appartement', label: 'Appartement', emoji: '🏢' },
  { value: 'maison', label: 'Maison', emoji: '🏡' },
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
const SURFACE_DEFAULT_MIN_INDEX = SURFACE_SCALE.indexOf(30)
const SURFACE_DEFAULT_MAX_INDEX = SURFACE_SCALE_MAX_INDEX

function formatSurface(v: number): string {
  if (v >= SURFACE_UNLIMITED) return '500 m² +'
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

// ─── Rooms / bedrooms label helpers ──────────────────────────────────────
// Single source of truth for value-to-display formatting so the slider
// caption and the brief recap stay consistent.

function formatRooms(v: number): string {
  if (v <= 1) return 'Studio'
  if (v >= ROOMS_MAX) return `${ROOMS_MAX}p +`
  return `${v}p`
}
function formatBedrooms(v: number): string {
  if (v >= BEDROOMS_MAX) return `${BEDROOMS_MAX} ch +`
  return `${v} ch`
}

interface BienStepProps {
  onNext: () => void
}

export default function BienStep({ onNext }: BienStepProps) {
  const {
    togglePropertyType, propertyTypes,
    setRoomsRange, minRooms, maxRooms,
    setBedroomsRange, minBedrooms, maxBedrooms,
    setSurface, minSurface, maxSurface,
  } = useSearchStore()

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

  // Rooms slider — anchored on values 1..7. Defaults: min=Studio, max=7+.
  const initialRoomsMin = useMemo(
    () => (minRooms ?? ROOMS_MIN),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const initialRoomsMax = useMemo(
    () => (maxRooms ?? ROOMS_MAX),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [roomsMin, setRoomsMin] = useState<number>(initialRoomsMin)
  const [roomsMax, setRoomsMax] = useState<number>(initialRoomsMax)

  // Bedrooms slider — anchored on values 1..6. Defaults: max=6+, min derived
  // from the rooms→bedrooms coupling on first mount.
  const initialBedroomsMin = useMemo(
    () => (minBedrooms ?? Math.min(BEDROOMS_MAX, Math.max(BEDROOMS_MIN, initialRoomsMin - 1))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const initialBedroomsMax = useMemo(
    () => (maxBedrooms ?? BEDROOMS_MAX),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [bedroomsMin, setBedroomsMin] = useState<number>(initialBedroomsMin)
  const [bedroomsMax, setBedroomsMax] = useState<number>(initialBedroomsMax)

  // Persist defaults once on mount so the user can leave without touching
  // and still have ranges recorded.
  useEffect(() => {
    if (minSurface == null || maxSurface == null) {
      setSurface(SURFACE_SCALE[initialSurfaceMinIndex], SURFACE_SCALE[initialSurfaceMaxIndex])
    }
    if (minRooms == null || maxRooms == null) {
      setRoomsRange(initialRoomsMin, initialRoomsMax)
    }
    if (minBedrooms == null || maxBedrooms == null) {
      setBedroomsRange(initialBedroomsMin, initialBedroomsMax)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handlePropertyType = (value: PropertyType) => {
    togglePropertyType(value)
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

  // Rooms handlers — also auto-couple bedrooms.min via the store and
  // reflect the bumped local bedrooms slider when the coupling fires.
  const coupleBedroomsToRooms = (newRoomsMin: number) => {
    const coupledMin = Math.min(BEDROOMS_MAX, Math.max(BEDROOMS_MIN, newRoomsMin - 1))
    const nextBedroomsMax = Math.max(bedroomsMax, coupledMin)
    setBedroomsMin(coupledMin)
    setBedroomsMax(nextBedroomsMax)
  }
  const handleRoomsMin = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    const next = Math.min(v, roomsMax)
    setRoomsMin(next)
    setRoomsRange(next, roomsMax)
    coupleBedroomsToRooms(next)
  }
  const handleRoomsMax = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    const next = Math.max(v, roomsMin)
    setRoomsMax(next)
    setRoomsRange(roomsMin, next)
  }

  // Bedrooms handlers — enforce `bedroomsMin <= roomsMin` (less-than-or-equal,
  // not strictly less than: rule explicitly relaxed at the user's request).
  const handleBedroomsMin = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value)
    const capByRooms = Math.min(BEDROOMS_MAX, roomsMin)
    const next = Math.min(raw, capByRooms, bedroomsMax)
    setBedroomsMin(next)
    setBedroomsRange(next, bedroomsMax)
  }
  const handleBedroomsMax = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    const next = Math.max(v, bedroomsMin)
    setBedroomsMax(next)
    setBedroomsRange(bedroomsMin, next)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const surfaceMinValue = SURFACE_SCALE[surfMinIndex]
  const surfaceMaxValue = SURFACE_SCALE[surfMaxIndex]
  const surfaceTrack = useMemo(() => {
    const lo = (surfMinIndex / SURFACE_SCALE_MAX_INDEX) * 100
    const hi = (surfMaxIndex / SURFACE_SCALE_MAX_INDEX) * 100
    return { lo, hi }
  }, [surfMinIndex, surfMaxIndex])

  const roomsTrack = useMemo(() => {
    const span = ROOMS_MAX - ROOMS_MIN
    return {
      lo: ((roomsMin - ROOMS_MIN) / span) * 100,
      hi: ((roomsMax - ROOMS_MIN) / span) * 100,
    }
  }, [roomsMin, roomsMax])

  const bedroomsTrack = useMemo(() => {
    const span = BEDROOMS_MAX - BEDROOMS_MIN
    return {
      lo: ((bedroomsMin - BEDROOMS_MIN) / span) * 100,
      hi: ((bedroomsMax - BEDROOMS_MIN) / span) * 100,
    }
  }, [bedroomsMin, bedroomsMax])

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
          <div className="flex flex-wrap gap-1.5 mb-6">
            {PROPERTY_TYPES.map((pt) => {
              const isSelected = propertyTypes.includes(pt.value)
              return (
                <button
                  key={pt.value}
                  type="button"
                  onClick={() => handlePropertyType(pt.value)}
                  className="shomee-chip"
                  data-selected={isSelected}
                >
                  <span>{pt.emoji}</span>
                  <span>{pt.label}</span>
                </button>
              )
            })}
          </div>
        </motion.div>

        {/* Surface — dual-thumb range */}
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
              <p className="text-[17px] font-bold tabular-nums leading-none" style={{ color: '#A64B27' }}>
                {formatSurface(surfaceMinValue)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-600 mb-0.5">Maximum</p>
              <p className="text-[17px] font-bold tabular-nums leading-none" style={{ color: '#A64B27' }}>
                {formatSurface(surfaceMaxValue)}
              </p>
            </div>
          </div>
          <div className="shomee-dual-slider mb-7">
            <div
              className="shomee-dual-slider-track"
              style={{
                backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.08) ${surfaceTrack.lo}%, #A64B27 ${surfaceTrack.lo}%, #A64B27 ${surfaceTrack.hi}%, rgba(0,0,0,0.08) ${surfaceTrack.hi}%)`,
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

        {/* Nombre de pièces — dual-thumb range Studio → 7+ */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-600 mb-3">
            Nombre de pièces
          </p>
          <div className="flex items-baseline justify-between px-1 mb-2.5">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-600 mb-0.5">Minimum</p>
              <p className="text-[17px] font-bold tabular-nums leading-none" style={{ color: '#A64B27' }}>
                {formatRooms(roomsMin)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-600 mb-0.5">Maximum</p>
              <p className="text-[17px] font-bold tabular-nums leading-none" style={{ color: '#A64B27' }}>
                {formatRooms(roomsMax)}
              </p>
            </div>
          </div>
          <div className="shomee-dual-slider mb-7">
            <div
              className="shomee-dual-slider-track"
              style={{
                backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.08) ${roomsTrack.lo}%, #A64B27 ${roomsTrack.lo}%, #A64B27 ${roomsTrack.hi}%, rgba(0,0,0,0.08) ${roomsTrack.hi}%)`,
              }}
            />
            <input
              type="range" min={ROOMS_MIN} max={ROOMS_MAX} step={1}
              value={roomsMin} onChange={handleRoomsMin}
              aria-label="Nombre minimum de pièces"
              className="shomee-dual-slider-input shomee-dual-slider-input-min"
            />
            <input
              type="range" min={ROOMS_MIN} max={ROOMS_MAX} step={1}
              value={roomsMax} onChange={handleRoomsMax}
              aria-label="Nombre maximum de pièces"
              className="shomee-dual-slider-input shomee-dual-slider-input-max"
            />
          </div>
        </motion.div>

        {/* Nombre de chambres — dual-thumb range 1 → 6+ */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.26, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-600 mb-3">
            Nombre de chambres
          </p>
          <div className="flex items-baseline justify-between px-1 mb-2.5">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-600 mb-0.5">Minimum</p>
              <p className="text-[17px] font-bold tabular-nums leading-none" style={{ color: '#A64B27' }}>
                {formatBedrooms(bedroomsMin)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-600 mb-0.5">Maximum</p>
              <p className="text-[17px] font-bold tabular-nums leading-none" style={{ color: '#A64B27' }}>
                {formatBedrooms(bedroomsMax)}
              </p>
            </div>
          </div>
          <div className="shomee-dual-slider">
            <div
              className="shomee-dual-slider-track"
              style={{
                backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.08) ${bedroomsTrack.lo}%, #A64B27 ${bedroomsTrack.lo}%, #A64B27 ${bedroomsTrack.hi}%, rgba(0,0,0,0.08) ${bedroomsTrack.hi}%)`,
              }}
            />
            <input
              type="range" min={BEDROOMS_MIN} max={BEDROOMS_MAX} step={1}
              value={bedroomsMin} onChange={handleBedroomsMin}
              aria-label="Nombre minimum de chambres"
              className="shomee-dual-slider-input shomee-dual-slider-input-min"
            />
            <input
              type="range" min={BEDROOMS_MIN} max={BEDROOMS_MAX} step={1}
              value={bedroomsMax} onChange={handleBedroomsMax}
              aria-label="Nombre maximum de chambres"
              className="shomee-dual-slider-input shomee-dual-slider-input-max"
            />
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
          style={{ backgroundColor: '#A64B27' }}
        >
          Continuer
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}
