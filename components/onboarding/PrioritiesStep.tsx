'use client'

import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useSearchStore } from '@/lib/searchStore'

const PRIORITIES = [
  { value: 'calme', label: 'Calme', emoji: '🌿' },
  { value: 'animé', label: 'Animé', emoji: '✨' },
  { value: 'familial', label: 'Familial', emoji: '👨‍👩‍👧' },
  { value: 'transports', label: 'Transports', emoji: '🚇' },
  { value: 'écoles', label: 'Écoles', emoji: '🏫' },
  { value: 'commerces', label: 'Commerces', emoji: '🛍️' },
  { value: 'nature', label: 'Nature', emoji: '🌳' },
  { value: 'patrimoine', label: 'Patrimoine', emoji: '🏛️' },
  { value: 'lumineux', label: 'Lumineux', emoji: '☀️' },
  { value: 'vue', label: 'Belle vue', emoji: '🌇' },
  { value: 'parking', label: 'Parking', emoji: '🚗' },
  { value: 'extérieur', label: 'Extérieur', emoji: '🌸' },
]

interface PrioritiesStepProps {
  onNext: () => void
  onSkip: () => void
}

export default function PrioritiesStep({ onNext, onSkip }: PrioritiesStepProps) {
  const { togglePriority, priorities } = useSearchStore()

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
            Qu'est-ce qui compte pour vous ?
          </h2>
          <p className="text-[14px] text-neutral-400 mt-1.5">
            Sélectionnez vos priorités de vie. SHOMEE les prendra en compte.
          </p>
        </motion.div>
      </div>

      {/* Priorities grid */}
      <div className="px-6 flex-1 overflow-y-auto pb-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-wrap gap-2.5"
        >
          {PRIORITIES.map((p, i) => {
            const isSelected = priorities.includes(p.value)
            return (
              <motion.button
                key={p.value}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.1 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => togglePriority(p.value)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full border text-[14px] font-medium transition-all active:scale-95"
                style={{
                  backgroundColor: isSelected ? '#914E3C' : 'white',
                  color: isSelected ? 'white' : '#1a1a1a',
                  borderColor: isSelected ? '#914E3C' : 'rgba(0,0,0,0.08)',
                }}
              >
                <span>{p.emoji}</span>
                <span>{p.label}</span>
              </motion.button>
            )
          })}
        </motion.div>

        {/* Counter */}
        {priorities.length > 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[12px] text-neutral-400 mt-5"
          >
            {priorities.length} priorité{priorities.length > 1 ? 's' : ''} sélectionnée{priorities.length > 1 ? 's' : ''}
          </motion.p>
        )}
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
          {priorities.length > 0 ? 'Voir ma sélection' : 'Passer'}
          <ChevronRight size={18} />
        </button>
        {priorities.length > 0 && (
          <button
            onClick={onSkip}
            className="w-full py-3 text-[14px] font-medium text-neutral-400 active:text-neutral-600 transition-colors"
          >
            Passer cette étape
          </button>
        )}
      </div>
    </div>
  )
}
