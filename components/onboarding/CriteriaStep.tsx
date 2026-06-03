'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ArrowRight, Check, X, Loader2, Plus } from 'lucide-react'
import { useSearchStore, type ChipState } from '@/lib/searchStore'

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

const PLACEHOLDER = 'Séjour orienté ouest'

// 4-state visual palette.
const CHIP_STYLE: Record<ChipState, React.CSSProperties> = {
  0: {
    background: '#fff',
    color: '#1a1a1a',
    borderColor: 'rgba(0, 0, 0, 0.09)',
  },
  1: {
    background: '#fdf0ed',
    color: '#9b4a2e',
    borderColor: '#e8907a',
  },
  2: {
    background: '#a84632',
    color: '#fff',
    borderColor: '#a84632',
  },
  3: {
    background: '#5C1010',
    color: '#fff',
    borderColor: '#5C1010',
  },
}

const TOOLTIP_DURATION_MS = 3500

interface TooltipState {
  text: string
  x: number
  y: number
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
    cycleChipState,
    customCriteria,
    cycleCustomCriteriaState,
    addCustomCriteria,
    removeCustomCriteria,
  } = useSearchStore()

  const showBuilding = useMemo(() => {
    if (propertyTypes.length === 0) return true
    return propertyTypes.some((t) => t === 'appartement' || t === 'loft' || t === 'atelier')
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

  // ── Tooltip state ───────────────────────────────────────────────────────
  // Each tooltip shows at most once per page mount. `shownTip` tracks which
  // ones have already fired; `activeTip` is the one currently rendered.
  const [shownTip, setShownTip] = useState<{ s1: boolean; s2: boolean; s3: boolean }>({
    s1: false,
    s2: false,
    s3: false,
  })
  const [activeTip, setActiveTip] = useState<TooltipState | null>(null)
  const tipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (tipTimerRef.current) clearTimeout(tipTimerRef.current)
  }, [])

  function maybeShowTooltip(nextState: ChipState, anchor: HTMLElement) {
    if (nextState === 0) return
    if (nextState === 1 && shownTip.s1) return
    if (nextState === 2 && shownTip.s2) return
    if (nextState === 3 && shownTip.s3) return

    const rect = anchor.getBoundingClientRect()
    const tip: TooltipState = {
      text:
        nextState === 1
          ? 'Souhaité — cliquer pour rendre obligatoire'
          : nextState === 2
          ? 'Obligatoire — cliquer pour rendre rédhibitoire'
          : 'Rédhibitoire — exclut les biens qui ne correspondent pas. Cliquer pour désélectionner',
      // Anchor center, the tooltip will translate-x by -50% for centering.
      x: rect.left + rect.width / 2,
      y: rect.top,
    }
    setActiveTip(tip)
    setShownTip((prev) =>
      nextState === 1
        ? { ...prev, s1: true }
        : nextState === 2
        ? { ...prev, s2: true }
        : { ...prev, s3: true },
    )

    if (tipTimerRef.current) clearTimeout(tipTimerRef.current)
    tipTimerRef.current = setTimeout(() => setActiveTip(null), TOOLTIP_DURATION_MS)
  }

  function handleChipClick(label: string, e: React.MouseEvent<HTMLButtonElement>) {
    const current = chipStates[label] ?? 0
    const next = ((current + 1) % 4) as ChipState
    cycleChipState(label)
    maybeShowTooltip(next, e.currentTarget)
  }

  function handleCustomChipClick(id: string, currentState: ChipState, e: React.MouseEvent<HTMLButtonElement>) {
    const next = ((currentState + 1) % 4) as ChipState
    cycleCustomCriteriaState(id)
    maybeShowTooltip(next, e.currentTarget)
  }

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

  const renderChipContent = (label: string, state: ChipState) => (
    <>
      {state === 1 && <Plus size={11} strokeWidth={2.6} />}
      {state === 2 && <Check size={11} strokeWidth={2.6} />}
      {state === 3 && <X size={11} strokeWidth={2.6} />}
      <span style={state === 3 ? { textDecoration: 'line-through' } : undefined}>{label}</span>
    </>
  )

  const chipBaseClass =
    'inline-flex items-center gap-[5px] px-[11px] py-[5px] rounded-full text-[12.5px] font-medium leading-[1.25] border whitespace-nowrap select-none cursor-pointer transition-[background-color,color,border-color] duration-150 ease-out active:scale-[0.96]'

  const customChipsList = (
    <div className="flex flex-wrap gap-1.5">
      <AnimatePresence initial={false}>
        {customCriteria.map((c) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex"
          >
            <button
              type="button"
              onClick={(e) => handleCustomChipClick(c.id, c.state, e)}
              className={chipBaseClass}
              style={{ ...CHIP_STYLE[c.state], paddingRight: 6 }}
            >
              {renderChipContent(c.label, c.state)}
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
        ))}
      </AnimatePresence>
    </div>
  )

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

  // Continue → build the canonical { label, importance } list expected by
  // downstream consumers and persist it into the store before advancing.
  // (Persistence is local — Zustand persist; DB write happens later when
  // an authenticated buyer-profile flow is wired in.)
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
            className="flex gap-2 mb-6"
          >
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border bg-[#fdf0ed] text-[#9b4a2e] border-[#e8907a]"
            >
              <Plus size={9} strokeWidth={2.8} />
              <span>Souhaité</span>
            </div>
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border bg-[#a84632] text-white border-[#a84632]"
            >
              <Check size={9} strokeWidth={2.8} />
              <span>Obligatoire</span>
            </div>
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border bg-[#5C1010] text-white border-[#5C1010]"
            >
              <X size={9} strokeWidth={2.8} />
              <span>Rédhibitoire</span>
            </div>
          </motion.div>
        )}

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
              {PROPERTY_TAGS.map((tag) => {
                const state = (chipStates[tag] ?? 0) as ChipState
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={(e) => handleChipClick(tag, e)}
                    className={chipBaseClass}
                    style={CHIP_STYLE[state]}
                  >
                    {renderChipContent(tag, state)}
                  </button>
                )
              })}
            </div>
          </motion.section>
        )}

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
              {BUILDING_TAGS.map((tag) => {
                const state = (chipStates[tag] ?? 0) as ChipState
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={(e) => handleChipClick(tag, e)}
                    className={chipBaseClass}
                    style={CHIP_STYLE[state]}
                  >
                    {renderChipContent(tag, state)}
                  </button>
                )
              })}
            </div>
          </motion.section>
        )}

        {!isFocused && (
          <motion.p
            key="cat-custom-label"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-2"
          >
            Critères personnalisés
          </motion.p>
        )}

        {customCriteria.length > 0 && (
          <div key="chips" className={isFocused ? 'pb-1.5' : 'mb-2'}>
            {customChipsList}
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
          className="px-6 pt-5 flex-shrink-0"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 28px)' }}
        >
          <button
            onClick={handleContinue}
            className="w-full py-3.5 rounded-2xl font-semibold text-[15.5px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
            style={{ backgroundColor: '#A64B27' }}
          >
            Continuer
            <ChevronRight size={18} />
          </button>
        </motion.div>
      )}

      {/* ─── Tooltip overlay ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {activeTip && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed z-[10000] pointer-events-none"
            style={{
              left: activeTip.x,
              top: activeTip.y,
              transform: 'translate(-50%, calc(-100% - 8px))',
            }}
          >
            <div
              className="px-2.5 py-1.5 rounded-md text-white text-[11px] leading-snug text-center"
              style={{
                background: 'rgba(15,15,15,0.9)',
                maxWidth: 240,
              }}
            >
              {activeTip.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// `buildSelectedCriteria` lives in `lib/searchStore.ts` — re-exported there
// so the matching brief glue can derive `{ label, importance, polarity }`
// from the chip-state map + custom criteria.
