'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, ArrowRight, Check, X, Loader2, Plus } from 'lucide-react'
import { useSearchStore, type ChipState } from '@/lib/searchStore'
import { apiFetch } from '@/lib/apiFetch'

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

const PLACEHOLDER = 'Autre critère ? Décrivez-le...'

// Catalogue (neutral) chip — white with subtle border.
const CATALOGUE_STYLE: React.CSSProperties = {
  background: '#fff',
  color: '#1a1a1a',
  borderColor: 'rgba(0, 0, 0, 0.09)',
}

// Selected chip palette — states 1/2/3 only.
const SELECTED_STYLE: Record<1 | 2 | 3, React.CSSProperties> = {
  1: {
    background: '#fdf0ed',
    color: '#9b4a2e',
    borderColor: '#e8907a',
  },
  2: {
    background: '#C1533A',
    color: '#fff',
    borderColor: '#C1533A',
  },
  3: {
    background: '#f3f0ee',
    color: '#9a9a9a',
    borderColor: 'rgba(0, 0, 0, 0.10)',
  },
}

function nextSelectionState(s: ChipState): ChipState {
  return s === 1 ? 2 : s === 2 ? 3 : 1
}

interface CriteriaStepProps {
  onNext: () => void
  /** Bubbled up so the parent onboarding chrome (back + progress) can hide
   *  while the textarea is focused. */
  onFocusChange?: (focused: boolean) => void
}

export default function CriteriaStep({ onNext, onFocusChange }: CriteriaStepProps) {
  const {
    propertyTypes,
    chipStates,
    setChipState,
    customCriteria,
    setCustomCriteriaState,
    addCustomCriteria,
    removeCustomCriteria,
  } = useSearchStore()

  // Hide "L'immeuble" only when the user explicitly picked maison and nothing
  // else — any apartment-shaped type, or no type at all, keeps it visible.
  const showBuilding = useMemo(() => {
    if (propertyTypes.length === 0) return true
    return !(propertyTypes.length === 1 && propertyTypes[0] === 'maison')
  }, [propertyTypes])

  const [isFocused, setIsFocused] = useState(false)
  useEffect(() => {
    onFocusChange?.(isFocused)
  }, [isFocused, onFocusChange])
  useEffect(() => () => onFocusChange?.(false), [onFocusChange])

  const inputRef = useRef<HTMLInputElement | null>(null)

  const [text, setText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Derive catalogue vs selection ──────────────────────────────────────
  const cataloguePropertyTags = useMemo(
    () => PROPERTY_TAGS.filter((t) => (chipStates[t] ?? 0) === 0),
    [chipStates],
  )
  const catalogueBuildingTags = useMemo(
    () => BUILDING_TAGS.filter((t) => (chipStates[t] ?? 0) === 0),
    [chipStates],
  )

  const selectedCatalogueChips = useMemo(
    () =>
      [...PROPERTY_TAGS, ...BUILDING_TAGS]
        .map((label) => ({ label, state: (chipStates[label] ?? 0) as ChipState }))
        .filter((c) => c.state > 0),
    [chipStates],
  )

  const hasAnySelected = selectedCatalogueChips.length > 0 || customCriteria.length > 0

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleCatalogueAdd = (label: string) => {
    setChipState(label, 1)
  }

  const handleSelectedChipCycle = (label: string, current: ChipState) => {
    setChipState(label, nextSelectionState(current))
  }

  const handleSelectedChipRemove = (label: string) => {
    setChipState(label, 0)
  }

  const handleCustomChipCycle = (id: string, current: ChipState) => {
    setCustomCriteriaState(id, nextSelectionState(current))
  }

  const canValidate = text.trim().length >= 3 && !analyzing

  const handleValidate = async () => {
    if (!canValidate) return
    const input = text.trim()
    setAnalyzing(true)
    setError(null)
    try {
      const res = await apiFetch('/api/criteria/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'analyze failed')
      // The analyze API tags each item as 'positive' | 'negative' and
      // already strips the negation prefix server-side. We propagate
      // `type` into an explicit { state, polarity } override so
      // "Pas de vis-à-vis" → chip "Vis-à-vis" en état 3 (rédhibitoire).
      const items: Array<{ label: string; state?: ChipState; polarity?: 'positive' | 'negative' }> =
        Array.isArray(data?.criteria)
          ? (data.criteria as Array<{ label?: unknown; type?: unknown }>)
              .filter(
                (c): c is { label: string; type: 'positive' | 'negative' } =>
                  typeof c.label === 'string' &&
                  c.label.trim().length > 0 &&
                  (c.type === 'positive' || c.type === 'negative'),
              )
              .map((c) =>
                c.type === 'negative'
                  ? { label: c.label, state: 3 as ChipState, polarity: 'negative' as const }
                  : { label: c.label, state: 1 as ChipState, polarity: 'positive' as const },
              )
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
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const keepFocus = (e: React.PointerEvent | React.MouseEvent) => {
    if (document.activeElement === inputRef.current) {
      e.preventDefault()
    }
  }

  const exitFocus = () => {
    inputRef.current?.blur()
    setIsFocused(false)
  }

  // ── Sub-renders ─────────────────────────────────────────────────────────

  const chipBaseClass =
    'inline-flex items-center gap-[5px] px-[11px] py-[5px] rounded-full text-[12.5px] font-medium leading-[1.25] border whitespace-nowrap select-none cursor-pointer transition-[background-color,color,border-color] duration-150 ease-out active:scale-[0.96]'

  const renderSelectedChipContent = (label: string, state: 1 | 2 | 3) => (
    <>
      {state === 1 && <Plus size={11} strokeWidth={2.6} />}
      {state === 2 && <Check size={11} strokeWidth={2.6} />}
      {state === 3 && <X size={11} strokeWidth={2.6} />}
      <span style={state === 3 ? { textDecoration: 'line-through' } : undefined}>{label}</span>
    </>
  )

  const renderCatalogueChip = (label: string) => (
    <motion.button
      key={`cat-${label}`}
      type="button"
      layout
      layoutId={`chip-${label}`}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => handleCatalogueAdd(label)}
      className={chipBaseClass}
      style={CATALOGUE_STYLE}
    >
      <span>{label}</span>
    </motion.button>
  )

  const renderSelectedCatalogueChip = (label: string, state: 1 | 2 | 3) => (
    <motion.div
      key={`sel-${label}`}
      layout
      layoutId={`chip-${label}`}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="inline-flex"
    >
      <button
        type="button"
        onClick={() => handleSelectedChipCycle(label, state)}
        className={chipBaseClass}
        style={{ ...SELECTED_STYLE[state], paddingRight: 6 }}
      >
        {renderSelectedChipContent(label, state)}
        <button
          type="button"
          aria-label="Retirer"
          onMouseDown={keepFocus}
          onPointerDown={keepFocus}
          onClick={(e) => { e.stopPropagation(); handleSelectedChipRemove(label) }}
          className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full ml-[2px] -mr-[1px] opacity-60 hover:opacity-100"
        >
          <X size={11} strokeWidth={2.6} />
        </button>
      </button>
    </motion.div>
  )

  const renderCustomChip = (c: { id: string; label: string; state: ChipState }) => {
    const state = (c.state > 0 ? c.state : 1) as 1 | 2 | 3
    return (
      <motion.div
        key={`custom-${c.id}`}
        layout
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="inline-flex"
      >
        <button
          type="button"
          onClick={() => handleCustomChipCycle(c.id, c.state)}
          className={chipBaseClass}
          style={{ ...SELECTED_STYLE[state], paddingRight: 6 }}
        >
          {renderSelectedChipContent(c.label, state)}
          <button
            type="button"
            aria-label="Supprimer"
            onMouseDown={keepFocus}
            onPointerDown={keepFocus}
            onClick={(e) => { e.stopPropagation(); removeCustomCriteria(c.id) }}
            className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full ml-[2px] -mr-[1px] opacity-60 hover:opacity-100"
          >
            <X size={11} strokeWidth={2.6} />
          </button>
        </button>
      </motion.div>
    )
  }

  const textareaBlock = (
    <div
      className="relative rounded-full bg-white border transition-colors"
      style={{ borderColor: isFocused ? 'rgba(166,75,39,0.45)' : 'rgba(0,0,0,0.09)' }}
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => { setText(e.target.value); if (error) setError(null) }}
        onFocus={() => setIsFocused(true)}
        placeholder={PLACEHOLDER}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        className="w-full rounded-full bg-transparent text-[16px] leading-none text-neutral-900 placeholder:text-neutral-400 outline-none pl-4 pr-11 py-3"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleValidate()
          }
        }}
      />
      <button
        type="button"
        aria-label="Ajouter"
        onMouseDown={keepFocus}
        onPointerDown={keepFocus}
        onClick={handleValidate}
        disabled={!canValidate}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-all"
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
          <ArrowRight size={16} />
        )}
      </button>
    </div>
  )

  const handleContinue = () => {
    onNext()
  }

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

      {/* ─── Scrollable body ─────────────────────────────────────────────── */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto shomee-scroll-shadow flex flex-col px-6 pb-2 ${
          isFocused ? 'justify-end' : ''
        }`}
      >
        {!isFocused && (
          <motion.div
            key="legend"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-wrap gap-1.5 mb-5"
          >
            <span
              className="inline-flex items-center gap-[4px] px-[9px] py-[3px] rounded-full text-[11px] font-medium leading-[1.2] border"
              style={SELECTED_STYLE[1]}
            >
              <Plus size={10} strokeWidth={2.8} />
              <span>Souhaité</span>
            </span>
            <span
              className="inline-flex items-center gap-[4px] px-[9px] py-[3px] rounded-full text-[11px] font-medium leading-[1.2] border"
              style={SELECTED_STYLE[2]}
            >
              <Check size={10} strokeWidth={2.8} />
              <span>Obligatoire</span>
            </span>
            <span
              className="inline-flex items-center gap-[4px] px-[9px] py-[3px] rounded-full text-[11px] font-medium leading-[1.2] border"
              style={SELECTED_STYLE[3]}
            >
              <X size={10} strokeWidth={2.8} />
              <span style={{ textDecoration: 'line-through' }}>Rédhibitoire</span>
            </span>
          </motion.div>
        )}

        {/* ─── Catalogue: Le bien ──────────────────────────────────────── */}
        {!isFocused && (
          <motion.section
            key="cat-bien"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
            className="mb-4"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-2">
              Le bien
            </p>
            <div className="flex flex-wrap gap-1.5">
              <AnimatePresence initial={false}>
                {cataloguePropertyTags.map((tag) => renderCatalogueChip(tag))}
              </AnimatePresence>
            </div>
          </motion.section>
        )}

        {/* ─── Catalogue: L'immeuble ───────────────────────────────────── */}
        {!isFocused && showBuilding && (
          <motion.section
            key="cat-immeuble"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="mb-4"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-2">
              L&apos;immeuble
            </p>
            <div className="flex flex-wrap gap-1.5">
              <AnimatePresence initial={false}>
                {catalogueBuildingTags.map((tag) => renderCatalogueChip(tag))}
              </AnimatePresence>
            </div>
          </motion.section>
        )}

        {/* ─── Selection: Vos critères ─────────────────────────────────── */}
        <AnimatePresence initial={false}>
          {!isFocused && hasAnySelected && (
            <motion.section
              key="selection"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="mb-4"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-2">
                Vos critères
              </p>
              <div className="flex flex-wrap gap-1.5">
                <AnimatePresence initial={false}>
                  {selectedCatalogueChips.map((c) =>
                    renderSelectedCatalogueChip(c.label, c.state as 1 | 2 | 3),
                  )}
                  {customCriteria.map((c) => renderCustomChip(c))}
                </AnimatePresence>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* ─── In-focus: only show selected chips above the input ───────── */}
        {isFocused && hasAnySelected && (
          <div key="chips-focus" className="pb-1.5">
            <div className="flex flex-wrap gap-1.5">
              <AnimatePresence initial={false}>
                {selectedCatalogueChips.map((c) =>
                  renderSelectedCatalogueChip(c.label, c.state as 1 | 2 | 3),
                )}
                {customCriteria.map((c) => renderCustomChip(c))}
              </AnimatePresence>
            </div>
          </div>
        )}

        {error && (
          <p key="error" className="text-[11.5px] text-[#B23228] mb-1.5">{error}</p>
        )}

        <div
          key="textarea"
          style={isFocused ? { paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' } : undefined}
        >
          {textareaBlock}
        </div>
      </div>

      {/* ─── CTAs — normal mode only, always reachable below scroll ─────── */}
      {!isFocused && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.08 }}
          className="px-6 pt-4 flex-shrink-0"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
        >
          <button
            onClick={handleContinue}
            className="w-full py-3.5 rounded-2xl font-semibold text-[15px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
            style={{ backgroundColor: '#A64B27' }}
          >
            Lancer ma recherche
            <CheckCircle size={18} />
          </button>
        </motion.div>
      )}
    </div>
  )
}

// `buildSelectedCriteria` lives in `lib/searchStore.ts` — re-exported there
// so the matching brief glue can derive `{ label, importance, polarity }`
// from the chip-state map + custom criteria.
