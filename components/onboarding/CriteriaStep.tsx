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
   *  while the textarea is focused — focus mode is meant as a fullscreen
   *  parenthesis without any surrounding UI. */
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
  // The textarea instance stays mounted across mode switches so iOS never
  // sees a focus blip — the keyboard never closes during the layout change.
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

  // ── Shared sub-renders ───────────────────────────────────────────────────
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
          // Minimalist focus mode top bar: a small check + "Valider" pill in
          // the top-right. Communicates "I'm done with my criteria" rather
          // than "I'm cancelling" — the parent chrome is also hidden.
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

      {/* ─── Categories block — normal mode only ────────────────────────── */}
      {!isFocused && (
        <div className="flex-shrink-0 px-6 pb-3">
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
        </div>
      )}

      {/* ─── Section content block ───────────────────────────────────────
          Contains: section label (normal only) → criteria chips (if any,
          scrollable, with shadow indicator when overflowing) → intro
          description → textarea + submit.
          In normal mode: sits right after categories, attached to its
          section label (NOT to the CTAs below — there's a flex spacer).
          In focus mode: takes the remaining vertical space (flex-1) and
          pins to the bottom via justify-end so the textarea hugs the
          keyboard.
          Single React subtree across modes → textarea stays mounted. */}
      <div
        className={`flex flex-col ${
          isFocused
            ? 'flex-1 justify-end px-4 pb-1'
            : 'flex-shrink-0 min-h-0 px-6'
        }`}
      >
        {!isFocused && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-1.5"
          >
            Précisez vos critères
          </motion.p>
        )}

        {/* Criteria chips — scroll-capped so a long list doesn't push the
            textarea off-screen. Scroll-shadows appear only when there's
            actual overflow (CSS background-attachment:local trick). */}
        {customCriteria.length > 0 && (
          <div
            className={`shomee-scroll-shadow overflow-y-auto -mx-1 px-1 ${
              isFocused ? 'pb-1.5 max-h-[35vh]' : 'mb-2 max-h-[26vh]'
            }`}
          >
            {renderCriteriaChips()}
          </div>
        )}

        {/* Intro description — sits right above the textarea in both modes. */}
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
              on focus, which destabilises the viewport. Placeholder inherits
              this size so the empty state looks consistent with typed text
              (no tiny grey ghost text). */}
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

        {/* Focus-mode safe-area padding below the textarea so it never
            hugs the very edge of the visible viewport on iOS. */}
        {isFocused && (
          <div style={{ height: 'max(env(safe-area-inset-bottom), 8px)' }} />
        )}
      </div>

      {/* ─── Flex spacer — normal mode only ─────────────────────────────
          Pushes the CTAs to the bottom while leaving the textarea visually
          attached to its section label above. */}
      {!isFocused && <div className="flex-1 min-h-[12px]" />}

      {/* ─── CTAs — normal mode only ────────────────────────────────────── */}
      {!isFocused && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.08 }}
          className="px-6 pt-2 pb-8 flex flex-col gap-2 flex-shrink-0"
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
