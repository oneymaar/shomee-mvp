'use client'

import { useEffect, useState } from 'react'
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

const SURFACE_MIN = 20
const SURFACE_MAX = 200
const SURFACE_STEP = 5
const SURFACE_DEFAULT = 50

interface BienStepProps {
  onNext: () => void
  onSkip: () => void
}

export default function BienStep({ onNext, onSkip }: BienStepProps) {
  const {
    togglePropertyType, setPropertyTypes, propertyTypes,
    setMinRooms, minRooms,
    setSurface, minSurface,
  } = useSearchStore()

  // ── Local UI state ────────────────────────────────────────────────────────
  // "Indifférent" / "Peu importe" are visual-only — they clear the underlying
  // store fields. We track the explicit click so the chip can stay highlighted
  // (otherwise it would be indistinguishable from "user hasn't touched it").
  const [typeIndifferent, setTypeIndifferent] = useState(false)
  const [roomsAny, setRoomsAny] = useState(false)
  const [surface, setSurfaceLocal] = useState<number>(minSurface ?? SURFACE_DEFAULT)
  const [surfaceTouched, setSurfaceTouched] = useState(minSurface !== null)

  // Keep the local surface in sync if the user navigates back and the
  // store value was hydrated from a previous visit.
  useEffect(() => {
    if (minSurface !== null && !surfaceTouched) {
      setSurfaceLocal(minSurface)
      setSurfaceTouched(true)
    }
  }, [minSurface, surfaceTouched])

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

  const handleSurfaceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    setSurfaceLocal(v)
    setSurfaceTouched(true)
    setSurface(v, null)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const typesSelected = propertyTypes.length > 0
  const roomsSelected = minRooms !== null
  const surfaceProgress = ((surface - SURFACE_MIN) / (SURFACE_MAX - SURFACE_MIN)) * 100
  // Slider track gradient — terracotta up to the thumb, neutral past it.
  const trackBg = `linear-gradient(to right, #914E3C 0%, #914E3C ${surfaceProgress}%, rgba(0,0,0,0.08) ${surfaceProgress}%, rgba(0,0,0,0.08) 100%)`

  const canContinue = typesSelected || typeIndifferent || roomsSelected || roomsAny || surfaceTouched

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

        {/* Surface */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-600">
              Surface souhaitée
            </p>
            <p
              className="text-[18px] font-bold tabular-nums leading-none transition-opacity"
              style={{
                color: '#914E3C',
                opacity: surfaceTouched ? 1 : 0.55,
              }}
            >
              {surface} m²
            </p>
          </div>
          <input
            type="range"
            min={SURFACE_MIN}
            max={SURFACE_MAX}
            step={SURFACE_STEP}
            value={surface}
            onChange={handleSurfaceChange}
            aria-label="Surface souhaitée en mètres carrés"
            className="shomee-surface-slider w-full mb-2"
            style={{ background: trackBg }}
          />
          <div className="flex justify-between text-[11px] text-neutral-600 mb-7">
            <span>{SURFACE_MIN} m²</span>
            <span>{SURFACE_MAX}+ m²</span>
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
