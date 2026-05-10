'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useSearchStore } from '@/lib/searchStore'

interface BudgetOption {
  label: string
  max: number
  sublabel?: string
}

const BUDGET_OPTIONS: BudgetOption[] = [
  { label: '< 200 000 €', max: 200_000, sublabel: 'Studio, petite surface' },
  { label: '200 000 – 350 000 €', max: 350_000, sublabel: '2-3 pièces en région' },
  { label: '350 000 – 500 000 €', max: 500_000, sublabel: 'Bon confort, bonne localisation' },
  { label: '500 000 – 750 000 €', max: 750_000, sublabel: 'Paris ou grandes villes' },
  { label: '750 000 – 1 500 000 €', max: 1_500_000, sublabel: 'Grand appartement ou maison' },
  { label: '> 1 500 000 €', max: 99_000_000, sublabel: 'Prestige' },
]

interface BudgetStepProps {
  onNext: () => void
  onSkip: () => void
}

export default function BudgetStep({ onNext, onSkip }: BudgetStepProps) {
  const { setBudgetMax, budgetMax } = useSearchStore()
  const [selected, setSelected] = useState<number | null>(budgetMax)

  const handleSelect = (max: number) => {
    setSelected(max)
    setBudgetMax(max)
  }

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
            Quel est votre budget ?
          </h2>
          <p className="text-[14px] text-neutral-400 mt-1.5">
            Une fourchette suffit. Vous pourrez affiner plus tard.
          </p>
        </motion.div>
      </div>

      {/* Budget options */}
      <div className="px-6 flex-1 flex flex-col gap-2.5 overflow-y-auto pb-4">
        {BUDGET_OPTIONS.map((opt, i) => {
          const isSelected = selected === opt.max
          return (
            <motion.button
              key={opt.max}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => handleSelect(opt.max)}
              className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border text-left transition-all active:scale-[0.98]"
              style={{
                backgroundColor: isSelected ? '#914E3C' : 'white',
                borderColor: isSelected ? '#914E3C' : 'rgba(0,0,0,0.08)',
              }}
            >
              <div>
                <p className="text-[15px] font-semibold" style={{ color: isSelected ? 'white' : '#1a1a1a' }}>
                  {opt.label}
                </p>
                {opt.sublabel && (
                  <p className="text-[12px] mt-0.5" style={{ color: isSelected ? 'rgba(255,255,255,0.7)' : '#a3a3a3' }}>
                    {opt.sublabel}
                  </p>
                )}
              </div>
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center flex-shrink-0"
                >
                  <div className="w-2 h-2 rounded-full bg-white" />
                </motion.div>
              )}
            </motion.button>
          )
        })}
      </div>

      {/* CTAs */}
      <div
        className="px-6 pt-4 pb-10 flex flex-col gap-3 flex-shrink-0"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 32px)' }}
      >
        <button
          onClick={onNext}
          disabled={!selected}
          className="w-full py-4 rounded-2xl font-semibold text-[16px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
          style={{ backgroundColor: selected ? '#914E3C' : '#D4A89A', cursor: selected ? 'pointer' : 'default' }}
        >
          Continuer
          <ChevronRight size={18} />
        </button>
        <button
          onClick={onSkip}
          className="w-full py-3 text-[14px] font-medium text-neutral-400 active:text-neutral-600 transition-colors"
        >
          Passer cette étape
        </button>
      </div>
    </div>
  )
}
