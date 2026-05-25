'use client'

import { useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ArrowUp, Check, X, Loader2 } from 'lucide-react'
import { useSearchStore } from '@/lib/searchStore'

// Static taxonomies — kept small (~10 per category) so the step stays
// scannable. Labels are simple French phrases, no jargon.
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

interface CriteriaStepProps {
  onNext: () => void
  onSkip: () => void
}

export default function CriteriaStep({ onNext, onSkip }: CriteriaStepProps) {
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

  // Show the building category whenever the user hasn't restricted to maison-only.
  // Empty propertyTypes (= Indifférent) → assume copro-relevant.
  const showBuilding = useMemo(() => {
    if (propertyTypes.length === 0) return true
    return propertyTypes.some((t) => t === 'appartement' || t === 'loft' || t === 'atelier')
  }, [propertyTypes])

  // Focus mode — when the user taps the textarea, the rest of the screen
  // collapses out so the keyboard never fights for vertical space. The
  // textarea stays mounted across the switch (single React element, single
  // DOM node) so iOS never sees a focus blip → the keyboard never closes.
  const [isFocused, setIsFocused] = useState(false)
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
      // Keep keyboard open across submissions — refocus inside the same
      // gesture chain (rAF instead of timeout) so iOS doesn't dismiss it.
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }

  // Prevent the textarea from losing focus when the user taps the send
  // button or a chip close button. preventDefault on pointer/mouse down
  // stops the focus-stealing behaviour before the click fires — keeps the
  // keyboard up so the flow stays conversational.
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
            className="flex items-center justify-between px-4 pt-2 pb-2"
          >
            <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
              Vos critères
            </span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={(e) => e.preventDefault()}
              onClick={exitFocus}
              className="px-3 py-1 rounded-full text-[12.5px] font-semibold transition-colors active:opacity-70"
              style={{ color: '#A64B27' }}
            >
              Terminer
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

      {/* ─── Middle scrollable area ─────────────────────────────────────────
          - Normal mode: categories at top, hints/criteria below.
          - Focus mode : just criteria chips, pinned to the bottom of this
            region so they sit right above the textarea (which is in the
            next flex slot). */}
      <div
        className={`flex-1 overflow-y-auto flex flex-col ${
          isFocused ? 'px-4 pb-2 justify-end' : 'px-6 pb-3'
        }`}
      >
        {!isFocused && (
          <>
            {/* Catégorie 1 — Le bien */}
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

            {/* Catégorie 2 — L'immeuble (conditionnel) */}
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

            {/* Catégorie 3 — section label only. The textarea itself sits
                in the bottom flex slot below so it's pinned to the visible
                viewport bottom (just above the CTAs in normal mode, and
                just above the keyboard in focus mode). */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-2">
                Précisez vos critères
              </p>
              {/* Hints — only when no input and no parsed criteria. */}
              {text.length === 0 && customCriteria.length === 0 && (
                <p className="text-[11.5px] text-neutral-500 px-1 leading-snug">
                  Ex&nbsp;: «&nbsp;ascenseur indispensable à partir du 3e&nbsp;»,
                  «&nbsp;terrasse orientée sud&nbsp;», «&nbsp;pas de chambre sur rue&nbsp;».
                </p>
              )}
            </motion.div>
          </>
        )}

        {/* Focus-mode hint when empty. */}
        {isFocused && customCriteria.length === 0 && (
          <p className="text-[12px] text-neutral-500 leading-snug pb-2">
            Ex&nbsp;: «&nbsp;ascenseur indispensable à partir du 3e&nbsp;»,
            «&nbsp;terrasse orientée sud&nbsp;», «&nbsp;pas de chambre sur rue&nbsp;».
          </p>
        )}

        {/* Parsed criteria — visible in both modes, sits just above the
            textarea (last child in this flex column). */}
        {customCriteria.length > 0 && (
          <div className={isFocused ? '' : 'mt-3'}>
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
          </div>
        )}
      </div>

      {/* ─── Input (always mounted) ─────────────────────────────────────────
          Single React element across both modes so the textarea DOM node
          never unmounts → iOS keyboard stays open during the layout switch. */}
      <div
        className={`flex-shrink-0 ${isFocused ? 'px-4 pt-1' : 'px-6 pt-1'}`}
        style={
          isFocused
            ? { paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }
            : undefined
        }
      >
        {error && (
          <p className="text-[11.5px] text-[#B23228] mb-1.5 px-1">{error}</p>
        )}
        <div
          className="relative rounded-2xl bg-white border transition-colors"
          style={{ borderColor: isFocused ? 'rgba(166,75,39,0.45)' : 'rgba(0,0,0,0.09)' }}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); if (error) setError(null) }}
            onFocus={() => setIsFocused(true)}
            // We don't auto-exit on blur — exit only via the explicit
            // "Terminer" button. This prevents tap-outside accidents on
            // mobile from collapsing the flow mid-edit. The user can also
            // dismiss the keyboard via the OS-native keyboard-down button,
            // which fires blur — handled by the global tap-outside below
            // would re-open it; we keep isFocused true so the layout stays
            // collapsed until they explicitly say "Terminer".
            placeholder="Décrivez les détails importants pour vous…"
            rows={isFocused ? 3 : 2}
            className="w-full resize-none rounded-2xl bg-transparent text-[13.5px] leading-snug text-neutral-900 placeholder:text-neutral-400 outline-none px-3.5 py-2.5 pr-11"
            style={{ minHeight: isFocused ? 76 : 58 }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                handleValidate()
              }
            }}
          />
          <button
            type="button"
            aria-label="Valider"
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
