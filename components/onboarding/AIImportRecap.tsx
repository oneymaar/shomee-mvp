'use client'

import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check,
  ChevronRight,
  MapPin,
  Home,
  Wallet,
  Sparkles,
  Pencil,
  AlertTriangle,
  Plus,
  X as XIcon,
} from 'lucide-react'
import { useSearchStore, type ChipState } from '@/lib/searchStore'
import { SURFACE_UNLIMITED } from './BienStep'
import { BUDGET_UNLIMITED } from './BudgetStep'

interface AIImportRecapProps {
  /** Hint shown when the geo resolver couldn't narrow to any IRIS. */
  geoResolved: boolean
  /** Navigate to onboarding step (1=Quartiers, 2=Bien, 3=Budget, 4=Critères),
   *  with a flag telling the page to return here on next/back. */
  onEditBlock: (step: 1 | 2 | 3 | 4) => void
  /** Standard "Modifier manuellement" — drops the user into the normal flow. */
  onEditManual: () => void
  /** "Lancer ma recherche" — completes onboarding + goes to /feed. */
  onLaunch: () => void
}

// ─── Formatters ────────────────────────────────────────────────────────────

function formatSurface(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'Surface non renseignée'
  const fmt = (v: number) => (v >= SURFACE_UNLIMITED ? '500 m²+' : `${v} m²`)
  if (min == null) return `Jusqu'à ${fmt(max!)}`
  if (max == null) return `À partir de ${fmt(min)}`
  return `${fmt(min)} – ${fmt(max)}`
}

function formatBudget(min: number | null, max: number | null): string {
  const fmt = (v: number) => {
    if (v >= BUDGET_UNLIMITED) return '5 M€+'
    if (v >= 1_000_000) {
      const m = v / 1_000_000
      return Number.isInteger(m) ? `${m} M€` : `${m.toFixed(1).replace('.', ',')} M€`
    }
    return `${(v / 1_000).toLocaleString('fr-FR')} K€`
  }
  if (min == null && max == null) return 'Budget non renseigné'
  if (min == null) return `Jusqu'à ${fmt(max!)}`
  if (max == null) return `À partir de ${fmt(min)}`
  return `${fmt(min)} – ${fmt(max)}`
}

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  appartement: 'Appartement',
  maison: 'Maison',
  loft: 'Loft',
  atelier: 'Atelier',
}

function formatBien(propertyTypes: string[], minRooms: number | null, minSurface: number | null, maxSurface: number | null): string {
  const parts: string[] = []
  if (propertyTypes.length > 0) {
    parts.push(propertyTypes.map((t) => PROPERTY_TYPE_LABELS[t] ?? t).join(', '))
  } else {
    parts.push('Tous types')
  }
  if (minRooms != null) {
    parts.push(minRooms === 1 ? 'Studio' : minRooms >= 4 ? '4 pièces +' : `${minRooms} pièces`)
  }
  parts.push(formatSurface(minSurface, maxSurface))
  return parts.join(' · ')
}

// ─── Chip visual — mirrors CriteriaStep for visual continuity ─────────────

const CHIP_STYLE: Record<ChipState, React.CSSProperties> = {
  0: { background: '#fff', color: '#1a1a1a', borderColor: 'rgba(0,0,0,0.09)' },
  1: { background: '#fdf0ed', color: '#9b4a2e', borderColor: '#e8907a' },
  2: { background: '#a84632', color: '#fff', borderColor: '#a84632' },
  3: { background: '#1a1a1a', color: '#fff', borderColor: '#1a1a1a' },
}

function ChipBadge({ label, state }: { label: string; state: ChipState }) {
  return (
    <span
      className="inline-flex items-center gap-[5px] px-[10px] py-[4px] rounded-full text-[12px] font-medium leading-[1.2] border whitespace-nowrap"
      style={CHIP_STYLE[state]}
    >
      {state === 1 && <Plus size={10} strokeWidth={2.6} />}
      {state === 2 && <Check size={10} strokeWidth={2.6} />}
      {state === 3 && <XIcon size={10} strokeWidth={2.6} />}
      <span style={state === 3 ? { textDecoration: 'line-through' } : undefined}>
        {label}
      </span>
    </span>
  )
}

// ─── Block card ────────────────────────────────────────────────────────────

interface BlockCardProps {
  icon: React.ReactNode
  title: string
  delay: number
  onEdit: () => void
  children: React.ReactNode
}

function BlockCard({ icon, title, delay, onEdit, children }: BlockCardProps) {
  return (
    <motion.button
      type="button"
      onClick={onEdit}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className="w-full text-left bg-white border border-black/8 rounded-2xl px-4 py-3.5 active:bg-black/4 transition-colors flex items-start gap-3"
    >
      <div
        className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(166,75,39,0.10)', color: '#A64B27' }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-1">
          {title}
        </p>
        {children}
      </div>
      <Pencil size={14} className="flex-shrink-0 mt-1.5 text-neutral-400" aria-hidden />
    </motion.button>
  )
}

// ─── Recap ─────────────────────────────────────────────────────────────────

export default function AIImportRecap({ geoResolved, onEditBlock, onEditManual, onLaunch }: AIImportRecapProps) {
  const {
    locationLabel,
    locationQuery,
    propertyTypes,
    minRooms,
    minSurface,
    maxSurface,
    budgetMin,
    budgetMax,
    chipStates,
    customCriteria,
  } = useSearchStore()

  const bienText = useMemo(
    () => formatBien(propertyTypes, minRooms, minSurface, maxSurface),
    [propertyTypes, minRooms, minSurface, maxSurface],
  )
  const budgetText = useMemo(() => formatBudget(budgetMin, budgetMax), [budgetMin, budgetMax])

  const chipEntries = useMemo(
    () =>
      (Object.entries(chipStates) as Array<[string, ChipState]>).filter(
        ([, state]) => state > 0,
      ),
    [chipStates],
  )
  const customEntries = useMemo(
    () => customCriteria.filter((c) => c.state > 0),
    [customCriteria],
  )
  const hasAnyCriteria = chipEntries.length > 0 || customEntries.length > 0

  const locationText = locationLabel || locationQuery || 'Localisation non renseignée'

  return (
    <div className="flex flex-col h-full" style={{ background: '#FDF5F2' }}>
      {/* Header */}
      <motion.div
        className="flex-none px-6 pt-6 pb-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 24px)' }}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <p
          className="text-[11px] font-bold uppercase tracking-widest mb-2"
          style={{ color: '#A64B27' }}
        >
          Brief importé
        </p>
        <h2 className="text-[22px] font-bold text-neutral-900 leading-tight tracking-tight">
          Voici votre recherche.
        </h2>
        <p className="text-[13px] text-neutral-600 mt-1.5">
          Vérifiez et ajustez avant de lancer.
        </p>
      </motion.div>

      {/* Warning when geo couldn't resolve */}
      <AnimatePresence>
        {!geoResolved && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="flex-none mx-6 mb-3 rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 border"
            style={{
              background: 'rgba(255,237,213,0.6)',
              borderColor: 'rgba(234,179,8,0.35)',
            }}
          >
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#a16207' }} />
            <p className="text-[12px] leading-snug" style={{ color: '#854d0e' }}>
              Impossible de résoudre la localisation automatiquement.
              Touchez le bloc <strong>Quartiers</strong> pour préciser la zone.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Blocks */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
        <div className="flex flex-col gap-2.5">
          <BlockCard
            icon={<MapPin size={16} />}
            title="Quartiers"
            delay={0.05}
            onEdit={() => onEditBlock(1)}
          >
            <p className="text-[14.5px] font-semibold text-neutral-900 leading-snug">
              {locationText}
            </p>
          </BlockCard>

          <BlockCard
            icon={<Home size={16} />}
            title="Bien"
            delay={0.10}
            onEdit={() => onEditBlock(2)}
          >
            <p className="text-[14.5px] font-semibold text-neutral-900 leading-snug">
              {bienText}
            </p>
          </BlockCard>

          <BlockCard
            icon={<Wallet size={16} />}
            title="Budget"
            delay={0.15}
            onEdit={() => onEditBlock(3)}
          >
            <p className="text-[14.5px] font-semibold text-neutral-900 leading-snug">
              {budgetText}
            </p>
          </BlockCard>

          <BlockCard
            icon={<Sparkles size={16} />}
            title="Critères"
            delay={0.20}
            onEdit={() => onEditBlock(4)}
          >
            {hasAnyCriteria ? (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {chipEntries.map(([label, state]) => (
                  <ChipBadge key={`chip-${label}`} label={label} state={state} />
                ))}
                {customEntries.map((c) => (
                  <ChipBadge key={`custom-${c.id}`} label={c.label} state={c.state} />
                ))}
              </div>
            ) : (
              <p className="text-[14px] text-neutral-500 leading-snug italic">
                Aucun critère sélectionné
              </p>
            )}
          </BlockCard>
        </div>
      </div>

      {/* CTAs */}
      <motion.div
        className="flex-none px-6 pt-3 flex flex-col gap-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <button
          type="button"
          onClick={onLaunch}
          className="w-full py-3.5 rounded-2xl font-semibold text-[15.5px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
          style={{ backgroundColor: '#A64B27' }}
        >
          Lancer ma recherche
          <ChevronRight size={18} />
        </button>
        <button
          type="button"
          onClick={onEditManual}
          className="w-full py-3 text-[13.5px] font-medium transition-colors active:opacity-70"
          style={{ color: '#A64B27' }}
        >
          Modifier manuellement
        </button>
      </motion.div>
    </div>
  )
}
