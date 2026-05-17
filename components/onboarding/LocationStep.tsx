'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Loader2, HelpCircle, ChevronLeft } from 'lucide-react'
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

const ENTITY_COLORS: Record<RecognizedLocationEntity['type'], { bg: string; text: string; border: string }> = {
  metro_station:      { bg: 'rgba(29,78,216,0.08)',   text: '#1d4ed8', border: 'rgba(29,78,216,0.2)' },
  rer_station:        { bg: 'rgba(14,116,144,0.08)',  text: '#0e7490', border: 'rgba(14,116,144,0.2)' },
  tram_station:       { bg: 'rgba(5,150,105,0.08)',   text: '#059669', border: 'rgba(5,150,105,0.2)' },
  transilien_station: { bg: 'rgba(101,163,13,0.08)',  text: '#65a30d', border: 'rgba(101,163,13,0.2)' },
  semantic_neighborhood: { bg: 'rgba(145,78,60,0.08)', text: '#914E3C', border: 'rgba(145,78,60,0.2)' },
  administrative_area:   { bg: 'rgba(145,78,60,0.08)', text: '#914E3C', border: 'rgba(145,78,60,0.2)' },
}

// ─── Example pools (3 types, one picked randomly per page load) ────────────

const EXAMPLES_SIMPLE = [
  'Vincennes et Saint-Mandé',
  'Belleville et Ménilmontant',
  'Aligre et Ledru-Rollin',
  'Boulogne-Billancourt',
  'Pigalle',
  'Montreuil',
]

const EXAMPLES_COMPLEX = [
  'Paris 13 à moins de 5mn du métro',
  'Paris 11 sauf Bastille',
  'entre Pigalle et Montmartre',
  'Paris 10 proche gare du Nord',
  'Paris 15 pas trop excentré',
  "Paris 18 sauf la Goutte d'Or",
]

const EXAMPLES_POI = [
  "proche de l'hôpital Saint-Antoine",
  'autour de la station Nation',
  'à deux pas de République',
  'près de la Sorbonne',
  'proche gare de Lyon',
  'quartier du Marais',
]

function pickExamples(): [string, string, string] {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]
  return [pick(EXAMPLES_SIMPLE), pick(EXAMPLES_COMPLEX), pick(EXAMPLES_POI)]
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function LocationStep({ onOpenMap, onSkip }: LocationStepProps) {
  const { locationQuery, setLocation } = useSearchStore()
  const [query, setQuery] = useState(locationQuery)
  const [recognizedEntity, setRecognizedEntity] = useState<RecognizedLocationEntity | [RecognizedLocationEntity, RecognizedLocationEntity] | null>(null)
  const [ui, setUi] = useState<UIState>({ kind: 'typing' })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Examples generated once on mount, different on each page load
  const [examples] = useState<[string, string, string]>(() => pickExamples())

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300)
    return () => clearTimeout(t)
  }, [])

  // Run entity recognizer on query change (for disambiguation detection only)
  useEffect(() => {
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current)
    if (query.trim().length < 2) { setRecognizedEntity(null); return }
    suggestDebounce.current = setTimeout(() => {
      setRecognizedEntity(recognizeLocationEntity(query))
    }, 400)
    return () => { if (suggestDebounce.current) clearTimeout(suggestDebounce.current) }
  }, [query])

  useEffect(() => {
    if (ui.kind === 'clarification' || ui.kind === 'disambiguation') setUi({ kind: 'typing' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // ── Map opening helpers ──────────────────────────────────────────────────

  const openMapWithEntity = useCallback((entity: RecognizedLocationEntity, rawInput: string) => {
    const intent = entityToIntent(entity)
    setLocation({ query: rawInput, label: entity.displayLabel, lat: entity.coordinates?.lat ?? 0, lng: entity.coordinates?.lng ?? 0, intent })
    onOpenMap()
  }, [setLocation, onOpenMap])

  const openMapWithQuery = useCallback((
    centerQuery: string,
    preselectZones?: string[],
    geoConstraints?: import('@/lib/services/geoConstraintService').GeoConstraint[],
    resolutionStrategy?: string,
    rawInput?: string,
    parserSource?: 'spatial_intent_parser' | 'llm_fallback', // DEBUG
  ) => {
    const parsed = parseLocationIntent(centerQuery.trim())
    const intent = {
      ...(preselectZones?.length ? { ...parsed, location_terms: preselectZones } : parsed),
      ...(geoConstraints?.length ? { geoConstraints } : {}),
      ...(resolutionStrategy ? { resolutionStrategy } : {}),
      ...(parserSource ? { parserSource } : {}), // DEBUG
    }
    setLocation({ query: (rawInput ?? centerQuery).trim(), label: centerQuery.trim(), lat: 0, lng: 0, intent })
    onOpenMap()
  }, [setLocation, onOpenMap])

  // "Dessiner sur la carte" — open empty map centered on Paris
  const handleDrawOnMap = useCallback(() => {
    setLocation({
      query: '', label: '', lat: 48.8566, lng: 2.3522,
      intent: { location_terms: [], lifestyle_terms: [], transport_constraints: [], confidence: 1 },
    })
    onOpenMap()
  }, [setLocation, onOpenMap])

  // ── Main CTA handler ──────────────────────────────────────────────────────

  const handleOpenMap = useCallback(async () => {
    const q = query.trim()
    if (q.length < 2) return

    if (recognizedEntity !== null) {
      if (Array.isArray(recognizedEntity)) {
        setUi({ kind: 'disambiguation', entities: recognizedEntity })
        return
      }
      openMapWithEntity(recognizedEntity, q)
      return
    }

    setUi({ kind: 'analyzing' })
    const analysis = await analyzeLocationIntent(q)
    const src = analysis?.parserSource // DEBUG

    if (!analysis || analysis.status === 'clear' || analysis.mapAction?.type === 'open_map') {
      openMapWithQuery(analysis?.mapAction?.centerQuery ?? q, analysis?.mapAction?.preselectQueries, analysis?.geoConstraints, analysis?.resolutionStrategy, q, src) // DEBUG: src
      return
    }
    if (analysis.status === 'not_found') {
      openMapWithQuery(analysis?.mapAction?.centerQuery ?? q, analysis?.mapAction?.preselectQueries, analysis?.geoConstraints, analysis?.resolutionStrategy, q, src) // DEBUG: src
      return
    }
    if (analysis.status === 'contradictory') {
      setUi({ kind: 'clarification', analysis: { ...analysis, clarificationQuestion: analysis.clarificationQuestion ?? "Ces contraintes semblent incompatibles. Que souhaitez-vous privilégier ?" } })
      return
    }
    if (analysis.status === 'too_vague') {
      setUi({ kind: 'clarification', analysis: { ...analysis, clarificationQuestion: analysis.clarificationQuestion ?? "Pouvez-vous préciser un secteur géographique de départ ?" } })
      return
    }
    setUi({ kind: 'clarification', analysis })
  }, [query, recognizedEntity, openMapWithEntity, openMapWithQuery])

  // Re-analyse the option's specific query so geoConstraints are preserved.
  // Old behavior only passed preselectZones, silently dropping poi/transport constraints.
  const handleSelectOption = useCallback(async (opt: { preselectZones: string[]; centerQuery: string; label: string; query: string }) => {
    const effectiveQuery = opt.query?.trim() || query.trim()
    setUi({ kind: 'analyzing' })
    const reanalysis = await analyzeLocationIntent(effectiveQuery)
    const src = reanalysis?.parserSource // DEBUG
    if (!reanalysis || reanalysis.status === 'clear' || reanalysis.mapAction?.type === 'open_map') {
      openMapWithQuery(
        reanalysis?.mapAction?.centerQuery ?? opt.centerQuery ?? effectiveQuery,
        reanalysis?.mapAction?.preselectQueries ?? opt.preselectZones,
        reanalysis?.geoConstraints,
        reanalysis?.resolutionStrategy,
        effectiveQuery,
        src,
      )
      return
    }
    // Re-analysis still ambiguous — open map with at least the zone info
    openMapWithQuery(opt.centerQuery ?? effectiveQuery, opt.preselectZones, undefined, undefined, effectiveQuery)
  }, [query, openMapWithQuery])

  const handleBackToTyping = useCallback(() => {
    setUi({ kind: 'typing' })
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const canContinue = query.trim().length >= 2
  const isAnalyzing = ui.kind === 'analyzing'
  const showClarification = ui.kind === 'clarification'
  const showDisambiguation = ui.kind === 'disambiguation'

  return (
    <div className="flex flex-col h-full items-center justify-center">
      <motion.div
        className="w-full px-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Title + subtitle */}
        <div className="text-center mb-5">
          <h2 className="text-[22px] font-bold text-neutral-900 leading-tight">
            Où aimeriez-vous habiter ?
          </h2>
          <p className="text-[14px] text-neutral-400 mt-1.5 leading-relaxed">
            Décrivez librement une ou plusieurs zones. Vous pourrez ensuite les affiner sur la carte.
          </p>
        </div>

        {/* Examples — plain text, rotating, no bubbles */}
        <div className="text-center mb-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400 mb-2">
            Exemples
          </p>
          {examples.map((ex, i) => (
            <p
              key={i}
              className="text-[13px] italic text-neutral-400 leading-relaxed cursor-pointer active:text-neutral-600 transition-colors"
              onClick={() => setQuery(ex)}
            >
              {ex}
            </p>
          ))}
        </div>

        {/* Textarea */}
        <div
          className="flex items-start gap-3 bg-white border border-black/8 rounded-2xl px-4 py-3.5 shadow-sm transition-opacity mb-3"
          style={{
            borderColor: query.trim().length > 0 ? 'rgba(145,78,60,0.3)' : undefined,
            opacity: isAnalyzing ? 0.6 : 1,
          }}
        >
          <textarea
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            disabled={isAnalyzing}
            className="flex-1 text-[14px] text-neutral-900 bg-transparent outline-none resize-none leading-relaxed"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        {/* Disambiguation modal */}
        <AnimatePresence>
          {showDisambiguation && ui.kind === 'disambiguation' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="mb-3 rounded-2xl overflow-hidden"
              style={{ backgroundColor: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
            >
              <div className="px-4 pt-4 pb-1">
                <p className="text-[13px] font-semibold text-neutral-700 mb-3">
                  Que voulez-vous dire par <span className="italic">{query.trim()}</span> ?
                </p>
                <div className="flex flex-col gap-2 overflow-y-auto max-h-52">
                  {ui.entities.map((entity) => (
                    <button
                      key={entity.id}
                      onClick={() => openMapWithEntity(entity, query.trim())}
                      className="flex items-center gap-3 w-full text-left bg-white rounded-xl px-3.5 py-3 border border-black/8 active:bg-black/4 transition-colors"
                    >
                      <span className="text-[18px] flex-shrink-0">{entity.emoji}</span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-neutral-900 leading-tight">{entity.displayLabel}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: ENTITY_COLORS[entity.type].text }}>
                          {entity.type === 'semantic_neighborhood' ? 'Secteur vécu · IRIS autour du centre' : 'Station · IRIS à proximité'}
                        </p>
                      </div>
                      <ArrowRight size={14} className="flex-shrink-0 ml-auto text-neutral-300" />
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleBackToTyping} className="w-full flex items-center justify-center gap-1.5 py-2.5 border-t border-black/6 text-[12px] font-medium text-neutral-400 active:text-neutral-600 transition-colors mt-2">
                <ChevronLeft size={13} /> Modifier ma recherche
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Clarification section */}
        <AnimatePresence>
          {showClarification && ui.kind === 'clarification' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="mb-3 rounded-2xl overflow-hidden"
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
                      <button key={opt.query} onClick={() => handleSelectOption(opt)} className="text-left w-full bg-white rounded-xl px-3.5 py-2.5 border border-black/8 active:bg-black/4 transition-colors">
                        <p className="text-[13px] font-semibold text-neutral-900 leading-tight">{opt.label}</p>
                        {opt.description && <p className="text-[11px] text-neutral-400 mt-0.5">{opt.description}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={handleBackToTyping} className="w-full flex items-center justify-center gap-1.5 py-2.5 border-t border-black/6 text-[12px] font-medium text-neutral-400 active:text-neutral-600 transition-colors">
                <ChevronLeft size={13} /> Modifier ma recherche
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Primary CTA */}
        {!showDisambiguation && !(showClarification && ui.kind === 'clarification' && ui.analysis.clarificationOptions?.length) && (
          <button
            onClick={showClarification ? () => openMapWithQuery(query) : handleOpenMap}
            disabled={!canContinue || isAnalyzing}
            className="w-full py-4 rounded-2xl font-semibold text-[16px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90 mb-3"
            style={{
              backgroundColor: canContinue && !isAnalyzing ? '#914E3C' : '#D4A89A',
              cursor: canContinue && !isAnalyzing ? 'pointer' : 'default',
            }}
          >
            {isAnalyzing ? (
              <><Loader2 size={18} className="animate-spin" />Analyse en cours…</>
            ) : (
              <>{showClarification ? 'Ouvrir la carte quand même' : 'Afficher sur la carte'}<ArrowRight size={18} /></>
            )}
          </button>
        )}

        {/* Dessiner sur la carte */}
        <div className="text-center" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
          <button
            onClick={handleDrawOnMap}
            className="text-[14px] font-medium text-neutral-400 active:text-neutral-600 transition-colors"
          >
            Dessiner sur la carte
          </button>
        </div>
      </motion.div>
    </div>
  )
}
