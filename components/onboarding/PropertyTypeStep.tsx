'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useSearchStore, type PropertyType } from '@/lib/searchStore'

const PROPERTY_TYPES: Array<{ value: PropertyType; label: string; emoji: string }> = [
  { value: 'appartement', label: 'Appartement', emoji: '🏢' },
  { value: 'maison', label: 'Maison', emoji: '🏡' },
  { value: 'studio', label: 'Studio', emoji: '🛋️' },
  { value: 'loft', label: 'Loft', emoji: '🏗️' },
  { value: 'duplex', label: 'Duplex', emoji: '🏘️' },
]

const ROOM_OPTIONS = [
  { value: 1, label: '1 pièce' },
  { value: 2, label: '2 pièces' },
  { value: 3, label: '3 pièces' },
  { value: 4, label: '4 pièces' },
  { value: 5, label: '5 pièces +' },
]

interface PropertyTypeStepProps {
  onNext: () => void
  onSkip: () => void
}

export default function PropertyTypeStep({ onNext, onSkip }: PropertyTypeStepProps) {
  const { togglePropertyType, propertyTypes, setMinRooms, minRooms } = useSearchStore()
  const [selectedRooms, setSelectedRooms] = useState<number | null>(minRooms)

  const handleRooms = (v: number) => {
    const next = selectedRooms === v ? null : v
    setSelectedRooms(next)
    setMinRooms(next)
  }

  const canContinue = propertyTypes.length > 0 || selectedRooms !== null

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
            Quel type de bien ?
          </h2>
          <p className="text-[14px] text-neutral-600 mt-1.5">
            Sélectionnez tout ce qui vous correspond.
          </p>
        </motion.div>
      </div>

      <div className="px-6 flex-1 overflow-y-auto pb-4">
        {/* Property types */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-600 mb-3">
            Type de bien
          </p>
          <div className="flex flex-wrap gap-2.5 mb-7">
            {PROPERTY_TYPES.map((pt) => {
              const isSelected = propertyTypes.includes(pt.value)
              return (
                <button
                  key={pt.value}
                  onClick={() => togglePropertyType(pt.value)}
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
          </div>
        </motion.div>

        {/* Rooms */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-600 mb-3">
            Nombre de pièces minimum
          </p>
          <div className="flex gap-2.5 flex-wrap">
            {ROOM_OPTIONS.map((opt) => {
              const isSelected = selectedRooms === opt.value
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
