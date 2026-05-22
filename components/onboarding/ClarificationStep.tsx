'use client'

import { motion } from 'framer-motion'
import { ArrowRight, ChevronLeft, HelpCircle } from 'lucide-react'
import type { ClarificationOption, LocationIntentAnalysis } from '@/lib/services/locationIntentAnalyzerService'

interface ClarificationStepProps {
  /** Raw user input — surfaced as the searched-for phrase at the top */
  originalQuery: string
  analysis: LocationIntentAnalysis
  /** User picks one of the suggested refinements */
  onSelectOption: (opt: ClarificationOption) => void
  /** User wants to refine their typed query */
  onBackToTyping: () => void
  /** User wants to open the map with the original (vague) query anyway */
  onOpenAnyway: () => void
}

export default function ClarificationStep({
  originalQuery,
  analysis,
  onSelectOption,
  onBackToTyping,
  onOpenAnyway,
}: ClarificationStepProps) {
  const question = analysis.clarificationQuestion ?? 'Pouvez-vous préciser votre recherche ?'
  const options = analysis.clarificationOptions ?? []

  return (
    <div
      className="flex flex-col h-full px-4"
      style={{ overscrollBehavior: 'none', overflow: 'hidden' }}
    >
      {/* Header */}
      <motion.div
        className="flex-none pt-3 pb-3"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <p
          className="text-[11px] font-bold uppercase tracking-widest mb-2"
          style={{ color: '#914E3C' }}
        >
          Affinons ensemble
        </p>
        <div className="flex items-start gap-2.5">
          <HelpCircle size={20} className="flex-shrink-0 mt-0.5" style={{ color: '#914E3C' }} />
          <h2 className="text-[20px] font-bold text-neutral-900 leading-snug tracking-tight">
            {question}
          </h2>
        </div>
        {originalQuery && (
          <p className="text-[13px] text-neutral-600 mt-2 ml-7">
            Votre recherche : <span className="italic">« {originalQuery} »</span>
          </p>
        )}
      </motion.div>

      {/* Options — scrollable */}
      <div className="flex-1 overflow-y-auto -mx-1 px-1 pb-2">
        <div className="flex flex-col gap-2.5">
          {options.map((opt, i) => (
            <motion.button
              key={`${opt.query}-${i}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => onSelectOption(opt)}
              className="text-left w-full bg-white rounded-2xl px-4 py-3.5 border border-black/8 active:bg-black/4 transition-colors flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-neutral-900 leading-snug">
                  {opt.label}
                </p>
                {opt.description && (
                  <p className="text-[13px] text-neutral-600 mt-1 leading-snug">
                    {opt.description}
                  </p>
                )}
              </div>
              <ArrowRight
                size={16}
                className="flex-shrink-0 mt-1 text-neutral-300"
                aria-hidden
              />
            </motion.button>
          ))}
        </div>
      </div>

      {/* Bottom CTAs */}
      <motion.div
        className="flex-none flex flex-col gap-2 pt-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      >
        <button
          onClick={onOpenAnyway}
          className="w-full py-3.5 rounded-2xl font-semibold text-[14px] active:opacity-80 transition-opacity border"
          style={{
            color: '#914E3C',
            borderColor: 'rgba(145,78,60,0.35)',
            backgroundColor: 'transparent',
          }}
        >
          Ouvrir la carte quand même
        </button>
        <button
          onClick={onBackToTyping}
          className="w-full flex items-center justify-center gap-1 py-2 text-[13px] font-medium text-neutral-600 active:text-neutral-800 transition-colors"
        >
          <ChevronLeft size={14} /> Modifier ma recherche
        </button>
      </motion.div>
    </div>
  )
}
