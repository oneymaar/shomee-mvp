'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ArrowUp, Check, X, Loader2 } from 'lucide-react'
import { useSearchStore } from '@/lib/searchStore'

const PROPERTY_TAGS: string[] = [
  'Extérieur',
  'Terrasse',
  'Balcon',
  'Dernier étage',
  'Traversant',
  'Lumineux',
  'Calme',
  'Vue dégagée',
  'Cuisine ouverte',
  'Charme / cachet',
]

const BUILDING_TAGS: string[] = [
  'Ascenseur',
  'Gardien',
  'Parking',
  'Cave',
  'Local vélo',
  'Faibles charges',
  'Petite copropriété',
  'Immeuble récent',
  'Standing',
  'Parties communes rénovées',
]

const PLACEHOLDER =
  'Ex : pas de chambre sur rue, terrasse orientée sud, ascenseur à partir du 3e…'

interface CriteriaStepProps {
  onNext: () => void
  onSkip: () => void
  /** Bubbled up so the parent onboarding chrome (back + progress) can hide
   *  while the textarea is focused. */
  onFocusChange?: (focused: boolean) => void
}

export default function CriteriaStep({ onNext, onSkip, onFocusChange }: CriteriaStepProps) {
  const {
    propertyTypes,
    propertyTags,
    togglePropertyTag,
    buildingTags,
    toggleBuildingTag,
    customCriteria,
    addCustomCriteria,
    removeCustomCriteria,
  } = useSearchStore()

  const showBuilding = useMemo(() => {
    if (propertyTypes.length === 0) return true
    return propertyTypes.some((t) => t === 'appartement' || t === 'loft' || t === 'atelier')
  }, [propertyTypes])

  // ── Focus mode state ─────────────────────────────────────────────────────
  // The textarea instance MUST stay mounted across mode switches so iOS
  // never sees a focus blip → keyboard stays open. That's why intro +
  // textarea live in a single fixed bottom container whose structural
  // position in the React tree never changes; only its className adapts.
  const [isFocused, setIsFocused] = useState(false)
  useEffect(() => {
    onFocusChange?.(isFocused)
  }, [isFocused, onFocusChange])
  useEffect(() => () => onFocusChange?.(false), [onFocusChange])

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const [text, setText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canValidate = text.trim().length >= 3 && !analyzing

  const handleValidate = async () => {
    if (!canValidate) return
    const input = text.trim()
    setAnalyzing(true)
    setError(null)
    try {
      const res = await fetch('/api/criteria/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'analyze failed')
      const items: Array<{ label: string; type: 'positive' | 'negative' }> = Array.isArray(data?.criteria)
        ? data.criteria
        : []
      if (items.length === 0) {
        setError("Je n'ai pas réussi à interpréter. Reformulez en une phrase.")
      } else {
        addCustomCriteria(items)
        setText('')
      }
    } catch {
      setError('Erreur réseau. Réessayez.')
    } finally {
      setAnalyzing(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }

  // Prevent the textarea from losing focus when the user taps action
  // buttons. preventDefault on pointer/mouse down stops the focus transfer
  // before the click fires.
  const keepFocus = (e: React.PointerEvent | React.MouseEvent) => {
    if (document.activeElement === textareaRef.current) {
      e.preventDefault()
    }
  }

  const exitFocus = () => {
    textareaRef.current?.blur()
    setIsFocused(false)
  }

  const hasAnyCriteria =
    propertyTags.length > 0 || buildingTags.length > 0 || customCriteria.length > 0

  // ── Shared chips renderer ───────────────────────────────────────────────
  const renderCriteriaChips = () => (
    <div className="flex flex-wrap gap-1.5">
      <AnimatePresence initial={false}>
        {customCriteria.map((c) => (
          <motion.span
            key={c.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="shomee-chip"
            data-tone={c.type}
          >
            {c.type === 'positive' ? (
              <Check size={11} strokeWidth={2.6} />
            ) : (
              <X size={11} strokeWidth={2.6} />
            )}
            <span>{c.label}</span>
            <button
              type="button"
              aria-label="Supprimer"
              onMouseDown={keepFocus}
              onPointerDown={keepFocus}
              onClick={() => removeCustomCriteria(c.id)}
              className="shomee-chip-close"
            >
              <X size={11} strokeWidth={2.6} />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* ─── Top region ──────────────────────────────────────────────────── */}
      <div className="flex-shrink-0">
        {isFocused ? (
          <motion.div
            key="focus-top"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
            className="flex justify-end px-3 pt-3 pb-1"
            style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
          >
            <button
              type="button"
              aria-label="Valider"
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={(e) => e.preventDefault()}
              onClick={exitFocus}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12.5px] font-semibold transition-opacity active:opacity-70"
              style={{ color: '#A64B27', background: 'rgba(166,75,39,0.08)' }}
            >
              <Check size={13} strokeWidth={2.6} />
              Valider
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="normal-header"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="px-6 pt-5 pb-3"
          >
            <h2 className="text-[22px] font-bold text-neutral-900 leading-tight">
              Vos préférences
            </h2>
            <p className="text-[13px] text-neutral-600 mt-1">
              Quelques nuances pour affiner votre recherche.
            </p>
          </motion.div>
        )}
      </div>

      {/* ─── Scrollable body ─────────────────────────────────────────────
          - Normal mode: categories + (when present) criteria chips. Scrolls
            with shadow indicators when content overflows; CTAs below stay
            reachable since they sit outside the scroll region.
          - Focus mode: just the chips, justified to the bottom so newest
            sit right above the fixed intro+textarea below. */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto shomee-scroll-shadow flex flex-col ${
          isFocused ? 'px-4 justify-end pb-1' : 'px-6 pb-1'
        }`}
      >
        {!isFocused && (
          <>
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="mb-4"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-2">
                Le bien
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PROPERTY_TAGS.map((tag) => {
                  const isSelected = propertyTags.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => togglePropertyTag(tag)}
                      className="shomee-chip"
                      data-selected={isSelected}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </motion.section>

            {showBuilding && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
                className="mb-4"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-2">
                  L&apos;immeuble
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {BUILDING_TAGS.map((tag) => {
                    const isSelected = buildingTags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleBuildingTag(tag)}
                        className="shomee-chip"
                        data-selected={isSelected}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </motion.section>
            )}
          </>
        )}

        {customCriteria.length > 0 && renderCriteriaChips()}
      </div>

      {/* ─── Fixed bottom: intro + textarea ──────────────────────────────
          Always rendered with the same React structure so the textarea DOM
          node persists across mode switches → iOS keyboard stays up. */}
      <div
        className={`flex-shrink-0 pt-2 ${isFocused ? 'px-4' : 'px-6'}`}
        style={
          isFocused
            ? { paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }
            : undefined
        }
      >
        <p className="text-[13px] text-neutral-600 leading-snug mb-1.5">
          Décrivez les détails importants pour vous.
        </p>

        {error && (
          <p className="text-[11.5px] text-[#B23228] mb-1.5">{error}</p>
        )}

        <div
          className="relative rounded-2xl bg-white border transition-colors"
          style={{ borderColor: isFocused ? 'rgba(166,75,39,0.45)' : 'rgba(0,0,0,0.09)' }}
        >
          {/* CRITICAL: 16px font-size — iOS Safari zooms inputs below 16px
              on focus, which destabilises the viewport. Placeholder
              inherits this size so empty state matches typed text. */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); if (error) setError(null) }}
            onFocus={() => setIsFocused(true)}
            placeholder={PLACEHOLDER}
            rows={isFocused ? 3 : 2}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full resize-none rounded-2xl bg-transparent text-[16px] leading-snug text-neutral-900 placeholder:text-neutral-400 outline-none px-3.5 py-2.5 pr-11"
            style={{ minHeight: isFocused ? 82 : 64 }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                handleValidate()
              }
            }}
          />
          <button
            type="button"
            aria-label="Analyser"
            onMouseDown={keepFocus}
            onPointerDown={keepFocus}
            onClick={handleValidate}
            disabled={!canValidate}
            className="absolute right-2 bottom-2 w-8 h-8 rounded-full flex items-center justify-center transition-all"
            style={{
              background: canValidate ? '#A64B27' : 'rgba(0,0,0,0.07)',
              color: canValidate ? '#fff' : 'rgba(0,0,0,0.35)',
              cursor: canValidate ? 'pointer' : 'default',
            }}
          >
            {analyzing ? (
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                className="inline-flex"
              >
                <Loader2 size={14} />
              </motion.span>
            ) : (
              <ArrowUp size={16} />
            )}
          </button>
        </div>
      </div>

      {/* ─── CTAs — normal mode only, always reachable ─────────────────── */}
      {!isFocused && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.08 }}
          className="px-6 pt-3 pb-8 flex flex-col gap-2 flex-shrink-0"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
        >
          <button
            onClick={onNext}
            className="w-full py-3.5 rounded-2xl font-semibold text-[15.5px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
            style={{ backgroundColor: '#A64B27' }}
          >
            {hasAnyCriteria ? 'Voir ma sélection' : 'Continuer'}
            <ChevronRight size={18} />
          </button>
          {hasAnyCriteria && (
            <button
              onClick={onSkip}
              className="w-full py-2 text-[13px] font-medium text-neutral-600 active:text-neutral-800 transition-colors"
            >
              Passer cette étape
            </button>
          )}
        </motion.div>
      )}
    </div>
  )
}
