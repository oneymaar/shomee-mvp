'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, MapPin, ArrowRight } from 'lucide-react'
import { parseLocationIntent } from '@/lib/services/locationIntentParser'
import { useSearchStore } from '@/lib/searchStore'

interface LocationStepProps {
  onOpenMap: () => void
  onSkip: () => void
}

export default function LocationStep({ onOpenMap, onSkip }: LocationStepProps) {
  const { locationQuery, setLocation } = useSearchStore()
  const [query, setQuery] = useState(locationQuery)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300)
    return () => clearTimeout(t)
  }, [])

  // Update suggestions after a pause — never triggers geocoding or map movement
  useEffect(() => {
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current)
    if (query.trim().length < 3) { setSuggestions([]); return }

    suggestDebounce.current = setTimeout(() => {
      const intent = parseLocationIntent(query)
      setSuggestions(intent.location_terms.slice(0, 4))
    }, 600)

    return () => { if (suggestDebounce.current) clearTimeout(suggestDebounce.current) }
  }, [query])

  const handleOpenMap = () => {
    // Save the raw query; geocoding happens in LocationMapStep
    const intent = parseLocationIntent(query.trim())
    // Store query text without triggering geocode here
    setLocation({ query: query.trim(), label: query.trim(), lat: 0, lng: 0, intent })
    onOpenMap()
  }

  const canContinue = query.trim().length >= 2

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
            Où aimeriez-vous habiter ?
          </h2>
          <p className="text-[14px] text-neutral-400 mt-1.5 leading-relaxed">
            Décrivez librement une ou plusieurs zones. Vous pourrez ensuite les affiner sur la carte.
          </p>
        </motion.div>

        {/* Input */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-5"
        >
          <div
            className="flex items-start gap-3 bg-white border border-black/8 rounded-2xl px-4 py-3.5 shadow-sm"
            style={{ borderColor: query.trim().length > 0 ? 'rgba(145,78,60,0.3)' : undefined }}
          >
            <Search size={18} className="text-neutral-400 flex-shrink-0 mt-0.5" />
            <textarea
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={'Ex : Paris 12 proche du bois de Vincennes, Saint-Mandé, autour de Nation…'}
              rows={3}
              className="flex-1 text-[14px] text-neutral-900 placeholder:text-neutral-400 bg-transparent outline-none resize-none leading-relaxed"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </motion.div>
      </div>

      {/* Detected terms (suggestions) */}
      <div className="px-6 flex-shrink-0 min-h-[40px]">
        <AnimatePresence>
          {suggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className="flex flex-wrap gap-2"
            >
              {suggestions.map((s) => (
                <div
                  key={s}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium"
                  style={{ backgroundColor: 'rgba(145,78,60,0.08)', color: '#914E3C' }}
                >
                  <MapPin size={11} />
                  {s}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Example chips */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.25 }}
        className="px-6 mt-4 flex-shrink-0"
      >
        <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400 mb-2.5">
          Exemples
        </p>
        <div className="flex flex-col gap-2">
          {[
            'Paris 11, Paris 12, proche ligne 1',
            'Saint-Mandé ou Vincennes',
            'Autour de Nation et Daumesnil',
          ].map((ex) => (
            <button
              key={ex}
              onClick={() => setQuery(ex)}
              className="text-left text-[13px] text-neutral-500 px-3 py-2 rounded-xl bg-white border border-black/8 active:bg-black/4 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* CTAs */}
      <div
        className="px-6 pt-4 flex flex-col gap-3 flex-shrink-0"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 32px)' }}
      >
        <button
          onClick={handleOpenMap}
          disabled={!canContinue}
          className="w-full py-4 rounded-2xl font-semibold text-[16px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
          style={{ backgroundColor: canContinue ? '#914E3C' : '#D4A89A', cursor: canContinue ? 'pointer' : 'default' }}
        >
          Affiner sur la carte
          <ArrowRight size={18} />
        </button>
        <button
          onClick={onSkip}
          className="w-full py-3 text-[14px] font-medium text-neutral-400 active:text-neutral-600 transition-colors"
        >
          Continuer sans carte
        </button>
      </div>
    </div>
  )
}
