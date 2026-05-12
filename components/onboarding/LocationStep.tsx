'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, MapPin, ArrowRight, Loader2, HelpCircle, ChevronLeft } from 'lucide-react'
import { parseLocationIntent } from '@/lib/services/locationIntentParser'
import { analyzeLocationIntent, type LocationIntentAnalysis } from '@/lib/services/locationIntentAnalyzerService'
import { recognizeLocationEntity, entityToIntent, type RecognizedLocationEntity } from '@/lib/services/locationEntityRecognizer'
import { useSearchStore } from '@/lib/searchStore'

interface LocationStepProps {
  onOpenMap: () => void
  onSkip: () => void
}

type UIState =
  | { kind: 'typing' }
  | { kind: 'analyzing' }
  | { kind: 'disambiguation'; entities: [RecognizedLocationEntity, RecognizedLocationEntity] }
  | { kind: 'clarification'; analysis: LocationIntentAnalysis }

// ─── Entity chip display ───────────────────────────────────────────────────

const ENTITY_COLORS: Record<RecognizedLocationEntity['type'], { bg: string; text: string; border: string }> = {
  metro_station:      { bg: 'rgba(29,78,216,0.08)',   text: '#1d4ed8', border: 'rgba(29,78,216,0.2)' },
  rer_station:        { bg: 'rgba(14,116,144,0.08)',  text: '#0e7490', border: 'rgba(14,116,144,0.2)' },
  tram_station:       { bg: 'rgba(5,150,105,0.08)',   text: '#059669', border: 'rgba(5,150,105,0.2)' },
  transilien_station: { bg: 'rgba(101,163,13,0.08)',  text: '#65a30d', border: 'rgba(101,163,13,0.2)' },
  semantic_neighborhood: { bg: 'rgba(145,78,60,0.08)', text: '#914E3C', border: 'rgba(145,78,60,0.2)' },
  administrative_area:   { bg: 'rgba(145,78,60,0.08)', text: '#914E3C', border: 'rgba(145,78,60,0.2)' },
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function LocationStep({ onOpenMap, onSkip }: LocationStepProps) {
  const { locationQuery, setLocation } = useSearchStore()
  const [query, setQuery] = useState(locationQuery)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [recognizedEntity, setRecognizedEntity] = useState<RecognizedLocationEntity | [RecognizedLocationEntity, RecognizedLocationEntity] | null>(null)
  const [ui, setUi] = useState<UIState>({ kind: 'typing' })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300)
    return () => clearTimeout(t)
  }, [])

  // Debounce: run entity recognizer first (local, instant), fallback to text parser
  useEffect(() => {
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current)
    if (query.trim().length < 2) {
      setSuggestions([])
      setRecognizedEntity(null)
      return
    }
    suggestDebounce.current = setTimeout(() => {
      const entity = recognizeLocationEntity(query)
      setRecognizedEntity(entity)
      if (entity !== null) {
        setSuggestions([]) // entity chip replaces text suggestions
      } else {
        const intent = parseLocationIntent(query)
        setSuggestions(intent.location_terms.slice(0, 4))
      }
    }, 400)
    return () => { if (suggestDebounce.current) clearTimeout(suggestDebounce.current) }
  }, [query])

  // Reset to typing when query changes
  useEffect(() => {
    if (ui.kind === 'clarification' || ui.kind === 'disambiguation') setUi({ kind: 'typing' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // ── Map opening helpers ──────────────────────────────────────────────────

  const openMapWithEntity = useCallback((entity: RecognizedLocationEntity) => {
    const intent = entityToIntent(entity)
    setLocation({
      query: entity.label,
      label: entity.displayLabel,
      lat: entity.coordinates?.lat ?? 0,
      lng: entity.coordinates?.lng ?? 0,
      intent,
    })
    onOpenMap()
  }, [setLocation, onOpenMap])

  const openMapWithQuery = useCallback((
    q: string,
    preselectZones?: string[],
    geoConstraints?: import('@/lib/services/geoConstraintService').GeoConstraint[],
    resolutionStrategy?: string,
  ) => {
    const parsed = parseLocationIntent(q.trim())
    const intent = {
      ...(preselectZones?.length ? { ...parsed, location_terms: preselectZones } : parsed),
      ...(geoConstraints?.length ? { geoConstraints } : {}),
      ...(resolutionStrategy ? { resolutionStrategy } : {}),
    }
    setLocation({ query: q.trim(), label: q.trim(), lat: 0, lng: 0, intent })
    onOpenMap()
  }, [setLocation, onOpenMap])

  // ── Main CTA handler ──────────────────────────────────────────────────────

  const handleOpenMap = useCallback(async () => {
    const q = query.trim()
    if (q.length < 2) return

    // Fast path: entity recognized locally — skip LLM
    if (recognizedEntity !== null) {
      if (Array.isArray(recognizedEntity)) {
        // Ambiguous: show disambiguation modal
        setUi({ kind: 'disambiguation', entities: recognizedEntity })
        return
      }
      openMapWithEntity(recognizedEntity)
      return
    }

    // Slow path: LLM analysis
    setUi({ kind: 'analyzing' })
    const analysis = await analyzeLocationIntent(q)

    if (!analysis || analysis.status === 'clear' || analysis.mapAction?.type === 'open_map') {
      openMapWithQuery(
        analysis?.mapAction?.centerQuery ?? q,
        analysis?.mapAction?.preselectQueries,
        analysis?.geoConstraints,
        analysis?.resolutionStrategy,
      )
      return
    }

    if (analysis.status === 'not_found') {
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

    if (analysis.status === 'contradictory') {
      setUi({
        kind: 'clarification',
        analysis: {
          ...analysis,
          clarificationQuestion: analysis.clarificationQuestion
            ?? "Ces contraintes semblent incompatibles. Que souhaitez-vous privilégier ?",
        },
      })
      return
    }

    if (analysis.status === 'too_vague') {
      setUi({
        kind: 'clarification',
        analysis: {
          ...analysis,
          clarificationQuestion: analysis.clarificationQuestion
            ?? "Pouvez-vous préciser un secteur géographique de départ ?",
        },
      })
      return
    }

    // ambiguous or unhandled
    setUi({ kind: 'clarification', analysis })
  }, [query, recognizedEntity, openMapWithEntity, openMapWithQuery])

  const handleSelectOption = useCallback((opt: { preselectZones: string[]; centerQuery: string; label: string; query: string }) => {
    const intent = {
      location_terms: opt.preselectZones ?? [],
      lifestyle_terms: [] as string[],
      transport_constraints: [] as string[],
      confidence: 0.95,
    }
    setLocation({ query: opt.centerQuery || opt.query, label: opt.label, lat: 0, lng: 0, intent })
    onOpenMap()
  }, [setLocation, onOpenMap])

  const handleBackToTyping = useCallback(() => {
    setUi({ kind: 'typing' })
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  // ── Derived state ─────────────────────────────────────────────────────────

  const canContinue = query.trim().length >= 2
  const isAnalyzing = ui.kind === 'analyzing'
  const showClarification = ui.kind === 'clarification'
  const showDisambiguation = ui.kind === 'disambiguation'
  const singleEntity = recognizedEntity !== null && !Array.isArray(recognizedEntity) ? recognizedEntity : null

  // ── Render ────────────────────────────────────────────────────────────────

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
              placeholder="Ex : Paris 12, métro Daumesnil, Butte-aux-Cailles…"
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

      {/* Recognition area: entity chip OR text suggestions */}
      <div className="px-6 flex-shrink-0 min-h-[40px]">
        <AnimatePresence mode="wait">
          {/* Single recognized entity chip */}
          {singleEntity && ui.kind === 'typing' && (
            <motion.div
              key="entity-chip"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-wrap gap-2"
            >
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold border"
                style={ENTITY_COLORS[singleEntity.type]}
              >
                <span>{singleEntity.emoji}</span>
                <span>{singleEntity.displayLabel}</span>
              </div>
            </motion.div>
          )}
          {/* Fallback text suggestions */}
          {!singleEntity && suggestions.length > 0 && ui.kind === 'typing' && (
            <motion.div
              key="suggestions"
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

      {/* Disambiguation modal */}
      <AnimatePresence>
        {showDisambiguation && ui.kind === 'disambiguation' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mx-6 mb-2 rounded-2xl overflow-hidden"
            style={{ backgroundColor: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
          >
            <div className="px-4 pt-4 pb-1">
              <p className="text-[13px] font-semibold text-neutral-700 mb-3">
                Que voulez-vous dire par <span className="italic">{query.trim()}</span> ?
              </p>
              <div className="flex flex-col gap-2 overflow-y-auto max-h-52">
                {ui.entities.map((entity) => {
                  const colors = ENTITY_COLORS[entity.type]
                  return (
                    <button
                      key={entity.id}
                      onClick={() => openMapWithEntity(entity)}
                      className="flex items-center gap-3 w-full text-left bg-white rounded-xl px-3.5 py-3 border border-black/8 active:bg-black/4 transition-colors"
                    >
                      <span className="text-[18px] flex-shrink-0">{entity.emoji}</span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-neutral-900 leading-tight">
                          {entity.displayLabel}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: colors.text }}>
                          {entity.type === 'semantic_neighborhood'
                            ? 'Secteur vécu · IRIS autour du centre'
                            : 'Station · IRIS à proximité'}
                        </p>
                      </div>
                      <ArrowRight size={14} className="flex-shrink-0 ml-auto text-neutral-300" />
                    </button>
                  )
                })}
              </div>
            </div>
            <button
              onClick={handleBackToTyping}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 border-t border-black/6 text-[12px] font-medium text-neutral-400 active:text-neutral-600 transition-colors mt-2"
            >
              <ChevronLeft size={13} />
              Modifier ma recherche
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* LLM Clarification section */}
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
                <div className="flex flex-col gap-2 overflow-y-auto max-h-52">
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

      {/* Example chips — only in typing mode, no entity recognized */}
      <AnimatePresence>
        {ui.kind === 'typing' && !singleEntity && (
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
                'métro Daumesnil',
                'Butte-aux-Cailles',
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
        {/* Primary CTA — hidden during disambiguation (user must choose) */}
        {!showDisambiguation && !(showClarification && ui.kind === 'clarification' && ui.analysis.clarificationOptions?.length) && (
          <button
            onClick={showClarification ? () => openMapWithQuery(query) : handleOpenMap}
            disabled={!canContinue || isAnalyzing}
            className="w-full py-4 rounded-2xl font-semibold text-[16px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
            style={{
              backgroundColor: canContinue && !isAnalyzing ? '#914E3C' : '#D4A89A',
              cursor: canContinue && !isAnalyzing ? 'pointer' : 'default',
            }}
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
