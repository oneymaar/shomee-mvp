'use client'

import { useMemo, useState } from 'react'
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
    }
  }

  const hasAnyCriteria =
    propertyTags.length > 0 || buildingTags.length > 0 || customCriteria.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex-shrink-0">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="text-[22px] font-bold text-neutral-900 leading-tight">
            Vos préférences
          </h2>
          <p className="text-[13px] text-neutral-600 mt-1">
            Quelques nuances pour affiner votre recherche.
          </p>
        </motion.div>
      </div>

      {/* Scrollable body */}
      <div className="px-6 flex-1 overflow-y-auto pb-3">
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

        {/* Catégorie 3 — IA */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-2">
            Précisez vos critères
          </p>

          {/* Textarea + inline submit button */}
          <div
            className="relative rounded-2xl bg-white border transition-colors"
            style={{ borderColor: 'rgba(0,0,0,0.09)' }}
          >
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); if (error) setError(null) }}
              placeholder="Décrivez les détails importants pour vous…"
              rows={2}
              className="w-full resize-none rounded-2xl bg-transparent text-[13.5px] leading-snug text-neutral-900 placeholder:text-neutral-400 outline-none px-3.5 py-2.5 pr-11"
              style={{ minHeight: 58 }}
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

          {/* Hints — masked once user starts typing to free vertical space */}
          {text.length === 0 && customCriteria.length === 0 && (
            <p className="text-[11px] text-neutral-500 mt-1.5 px-1 leading-snug">
              Ex&nbsp;: «&nbsp;ascenseur indispensable à partir du 3e&nbsp;»,
              «&nbsp;terrasse orientée sud&nbsp;», «&nbsp;pas de chambre sur rue&nbsp;».
            </p>
          )}

          {/* Error */}
          {error && (
            <p className="text-[11.5px] text-[#B23228] mt-1.5 px-1">{error}</p>
          )}

          {/* Parsed criteria — positive + negative inlined */}
          {customCriteria.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
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
                      onClick={() => removeCustomCriteria(c.id)}
                      className="shomee-chip-close"
                    >
                      <X size={11} strokeWidth={2.6} />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          )}
        </motion.section>
      </div>

      {/* CTAs */}
      <div
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
      </div>
    </div>
  )
}
