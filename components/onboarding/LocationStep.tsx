'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, MapPin, ArrowRight, Loader2, HelpCircle, ChevronLeft } from 'lucide-react'
import { parseLocationIntent } from '@/lib/services/locationIntentParser'
import { analyzeLocationIntent, type LocationIntentAnalysis } from '@/lib/services/locationIntentAnalyzerService'
import { useSearchStore } from '@/lib/searchStore'

interface LocationStepProps {
  onOpenMap: () => void
  onSkip: () => void
}

type UIState =
  | { kind: 'typing' }
  | { kind: 'analyzing' }
  | { kind: 'clarification'; analysis: LocationIntentAnalysis }

export default function LocationStep({ onOpenMap, onSkip }: LocationStepProps) {
  const { locationQuery, setLocation } = useSearchStore()
  const [query, setQuery] = useState(locationQuery)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [ui, setUi] = useState<UIState>({ kind: 'typing' })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current)
    if (query.trim().length < 3) { setSuggestions([]); return }
    suggestDebounce.current = setTimeout(() => {
      const intent = parseLocationIntent(query)
      setSuggestions(intent.location_terms.slice(0, 4))
    }, 600)
    return () => { if (suggestDebounce.current) clearTimeout(suggestDebounce.current) }
  }, [query])

  // Reset to typing when query changes after clarification
  useEffect(() => {
    if (ui.kind === 'clarification') setUi({ kind: 'typing' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const openMapWithQuery = useCallback((q: string, preselectZones?: string[]) => {
    const parsed = parseLocationIntent(q.trim())
    // LLM preselectZones override the rule-based parser when provided
    const intent = preselectZones?.length
      ? { ...parsed, location_terms: preselectZones }
      : parsed
    setLocation({ query: q.trim(), label: q.trim(), lat: 0, lng: 0, intent })
    onOpenMap()
  }, [setLocation, onOpenMap])

  const handleOpenMap = useCallback(async () => {
    const q = query.trim()
    if (q.length < 2) return

    setUi({ kind: 'analyzing' })

    const analysis = await analyzeLocationIntent(q)

    // Fallback: if API fails or returns clear → open map directly
    if (!analysis || analysis.status === 'clear' || analysis.mapAction?.type === 'open_map') {
      openMapWithQuery(
        analysis?.mapAction?.centerQuery ?? q,
        analysis?.mapAction?.preselectQueries,
      )
      return
    }

    if (analysis.status === 'not_found') {
      // Show clarification but without options — user should refine their query
      setUi({
        kind: 'clarification',
        analysis: {
          ...analysis,
          clarificationQuestion: analysis.clarificationQuestion ?? "Je ne reconnais pas ce lieu. Essayez avec un arrondissement ou une commune.",
          clarificationOptions: null,
        },
      })
      return
    }

    // ambiguous or too_vague — show clarification
    setUi({ kind: 'clarification', analysis })
  }, [query, openMapWithQuery])

  const handleSelectOption = useCallback((opt: { preselectZones: string[]; centerQuery: string; label: string; query: string }) => {
    // Bypass the rule-based parser: use explicit zones from LLM directly
    const intent = {
      location_terms: opt.preselectZones ?? [],
      lifestyle_terms: [] as string[],
      transport_constraints: [] as string[],
      confidence: 0.95,
    }
    setLocation({
      query: opt.centerQuery || opt.query,
      label: opt.label,
      lat: 0, lng: 0,
      intent,
    })
    onOpenMap()
  }, [setLocation, onOpenMap])

  const handleBackToTyping = useCallback(() => {
    setUi({ kind: 'typing' })
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const canContinue = query.trim().length >= 2
  const isAnalyzing = ui.kind === 'analyzing'
  const showClarification = ui.kind === 'clarification'

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
            className="flex items-start gap-3 bg-white border border-black/8 rounded-2xl px-4 py-3.5 shadow-sm transition-opacity"
            style={{
              borderColor: query.trim().length > 0 ? 'rgba(145,78,60,0.3)' : undefined,
              opacity: isAnalyzing ? 0.6 : 1,
            }}
          >
            <Search size={18} className="text-neutral-400 flex-shrink-0 mt-0.5" />
            <textarea
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ex : Paris 12 proche du bois de Vincennes, Saint-Mandé, autour de Nation…"
              rows={3}
              disabled={isAnalyzing}
              className="flex-1 text-[14px] text-neutral-900 placeholder:text-neutral-400 bg-transparent outline-none resize-none leading-relaxed"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </motion.div>
      </div>

      {/* Detected terms */}
      <div className="px-6 flex-shrink-0 min-h-[40px]">
        <AnimatePresence>
          {suggestions.length > 0 && ui.kind === 'typing' && (
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

      {/* Clarification section */}
      <AnimatePresence>
        {showClarification && ui.kind === 'clarification' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mx-6 mb-2 rounded-2xl overflow-hidden"
            style={{ backgroundColor: 'rgba(145,78,60,0.06)', border: '1px solid rgba(145,78,60,0.15)' }}
          >
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-start gap-2 mb-3">
                <HelpCircle size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#914E3C' }} />
                <p className="text-[13px] font-semibold leading-snug" style={{ color: '#914E3C' }}>
                  {ui.analysis.clarificationQuestion ?? "Pouvez-vous préciser ?"}
                </p>
              </div>

              {ui.analysis.clarificationOptions && ui.analysis.clarificationOptions.length > 0 && (
                <div className="flex flex-col gap-2">
                  {ui.analysis.clarificationOptions.map((opt) => (
                    <button
                      key={opt.query}
                      onClick={() => handleSelectOption(opt)}
                      className="text-left w-full bg-white rounded-xl px-3.5 py-2.5 border border-black/8 active:bg-black/4 transition-colors"
                    >
                      <p className="text-[13px] font-semibold text-neutral-900 leading-tight">{opt.label}</p>
                      {opt.description && (
                        <p className="text-[11px] text-neutral-400 mt-0.5">{opt.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleBackToTyping}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 border-t border-black/6 text-[12px] font-medium text-neutral-400 active:text-neutral-600 transition-colors"
            >
              <ChevronLeft size={13} />
              Modifier ma recherche
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Example chips — only in typing mode */}
      <AnimatePresence>
        {ui.kind === 'typing' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="px-6 mt-2 flex-shrink-0"
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
        )}
      </AnimatePresence>

      <div className="flex-1" />

      {/* CTAs */}
      <div
        className="px-6 pt-4 flex flex-col gap-3 flex-shrink-0"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 32px)' }}
      >
        {/* Primary CTA — open map (or skip if clarification has no options) */}
        {!(showClarification && ui.kind === 'clarification' && ui.analysis.clarificationOptions?.length) && (
          <button
            onClick={showClarification ? () => openMapWithQuery(query) : handleOpenMap}
            disabled={!canContinue || isAnalyzing}
            className="w-full py-4 rounded-2xl font-semibold text-[16px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
            style={{ backgroundColor: canContinue && !isAnalyzing ? '#914E3C' : '#D4A89A', cursor: canContinue && !isAnalyzing ? 'pointer' : 'default' }}
          >
            {isAnalyzing ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Analyse en cours…
              </>
            ) : (
              <>
                {showClarification ? 'Ouvrir la carte quand même' : 'Affiner sur la carte'}
                <ArrowRight size={18} />
              </>
            )}
          </button>
        )}

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
