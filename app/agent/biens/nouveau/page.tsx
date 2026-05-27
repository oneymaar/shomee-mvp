'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  Video,
  UploadCloud,
  Loader2,
  Check,
  Pencil,
  X,
  Plus,
} from 'lucide-react'
import clsx from 'clsx'

type Step = 1 | 2 | 3
type UploadPhase = 'idle' | 'uploading' | 'analyzing'
type TagStatus = 'pending' | 'validated' | 'deleted'
type TagItem = { id: string; label: string; status: TagStatus }

const INITIAL_TAGS: TagItem[] = [
  { id: 't1',  label: 'Séjour orienté sud',         status: 'pending' },
  { id: 't2',  label: 'Pas de vis-à-vis',           status: 'pending' },
  { id: 't3',  label: 'Parquet ancien',             status: 'pending' },
  { id: 't4',  label: 'Hauteur sous plafond > 3m',  status: 'pending' },
  { id: 't5',  label: 'Cuisine ouverte',            status: 'pending' },
  { id: 't6',  label: 'Chambres sur cour',          status: 'pending' },
  { id: 't7',  label: 'Double vitrage',             status: 'pending' },
  { id: 't8',  label: 'Luminosité excellente',      status: 'pending' },
  { id: 't9',  label: 'Immeuble haussmannien',      status: 'pending' },
  { id: 't10', label: 'Cave',                       status: 'pending' },
]

const stepVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -80 : 80, opacity: 0 }),
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

export default function NouveauBienPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [direction, setDirection] = useState(1)

  const goToStep = (next: Step) => {
    setDirection(next > step ? 1 : -1)
    setStep(next)
  }

  const handleBack = () => {
    if (step === 1) router.push('/agent/dashboard')
    else if (step === 2) goToStep(1)
  }

  return (
    <main className="px-5 pt-4 overflow-x-hidden">
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={step}
          custom={direction}
          variants={stepVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
        >
          {step === 1 && <Step1 onBack={handleBack} onAddVideo={() => goToStep(2)} onSkip={() => router.push('/agent/biens/draft-001/editer')} />}
          {step === 2 && <Step2 onBack={handleBack} onDone={() => goToStep(3)} />}
          {step === 3 && <Step3 onContinue={() => router.push('/agent/biens/draft-001/editer')} />}
        </motion.div>
      </AnimatePresence>
    </main>
  )
}

// ─── Step 1 ────────────────────────────────────────────────────────────────

function StepHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="flex items-center gap-2 mb-6 -ml-2">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Retour"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#0a0a0a] active:bg-black/5"
        >
          <ArrowLeft size={22} />
        </button>
      )}
      <h1 className="text-[17px] font-semibold text-[#0a0a0a]">{title}</h1>
    </header>
  )
}

function Step1({
  onBack,
  onAddVideo,
  onSkip,
}: {
  onBack: () => void
  onAddVideo: () => void
  onSkip: () => void
}) {
  return (
    <section>
      <StepHeader title="Nouveau bien" onBack={onBack} />

      <div className="flex flex-col items-center text-center pt-8 pb-6">
        <div className="w-16 h-16 rounded-full bg-[#0a0a0a]/5 flex items-center justify-center mb-5">
          <span className="text-[22px] font-bold text-[#0a0a0a]">52%</span>
        </div>
        <h2 className="text-[20px] font-bold text-[#0a0a0a] leading-tight max-w-[280px]">
          Votre annonce a été pré-remplie à 52&nbsp;% automatiquement
        </h2>
        <p className="text-[13px] text-gray-500 mt-2 max-w-[300px]">
          Les informations ont été extraites depuis vos documents.
        </p>
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={onAddVideo}
          className="w-full bg-[#0a0a0a] text-white py-4 rounded-2xl font-semibold text-[15px] flex items-center justify-center gap-2 active:bg-[#222] transition-colors"
        >
          <Video size={18} />
          Ajouter la vidéo du bien
        </button>

        <button
          type="button"
          onClick={onSkip}
          className="w-full mt-3 py-3 text-[13px] text-gray-600 active:text-gray-900"
        >
          Compléter manuellement sans vidéo →
        </button>
      </div>
    </section>
  )
}

// ─── Step 2 ────────────────────────────────────────────────────────────────

function Step2({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<UploadPhase>('idle')

  useEffect(() => {
    if (!file || phase !== 'idle') return

    setPhase('uploading')
    const start = Date.now()
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, (elapsed / 2000) * 100)
      setProgress(pct)
      if (pct >= 100) {
        window.clearInterval(tick)
        setPhase('analyzing')
        window.setTimeout(onDone, 2000)
      }
    }, 40)

    return () => window.clearInterval(tick)
  }, [file, phase, onDone])

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('video/')) setFile(f)
  }

  return (
    <section>
      <StepHeader title="Vidéo du bien" onBack={onBack} />

      {!file && (
        <>
          <div
            onClick={() => inputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-gray-300 rounded-2xl bg-white py-12 px-6 flex flex-col items-center text-center active:bg-gray-50 transition-colors cursor-pointer"
          >
            <div className="w-14 h-14 rounded-full bg-[#0a0a0a]/5 flex items-center justify-center mb-4">
              <UploadCloud size={26} className="text-[#0a0a0a]" />
            </div>
            <p className="text-[15px] font-semibold text-[#0a0a0a]">Déposez votre vidéo ici</p>
            <p className="text-[12px] text-gray-500 mt-1">MP4, MOV, WEBM · max 500 Mo</p>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full mt-4 py-3.5 rounded-xl border border-[#0a0a0a] text-[#0a0a0a] font-semibold text-[14px] active:bg-[#0a0a0a]/[0.03] transition-colors"
          >
            Parcourir mes fichiers
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setFile(f)
            }}
          />
        </>
      )}

      {file && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#0a0a0a]/5 flex items-center justify-center flex-shrink-0">
              <Video size={18} className="text-[#0a0a0a]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-[#0a0a0a] truncate">{file.name}</p>
              <p className="text-[12px] text-gray-500 mt-0.5">{formatBytes(file.size)}</p>
            </div>
          </div>

          {phase === 'uploading' && (
            <div className="mt-5">
              <div className="flex justify-between items-baseline mb-1.5">
                <span className="text-[11px] text-gray-500">Téléchargement…</span>
                <span className="text-[11px] font-medium text-[#0a0a0a]">{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0a0a0a] rounded-full transition-[width] duration-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'analyzing' && (
            <div className="mt-5 flex items-center gap-2 text-gray-600">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-[13px]">Analyse en cours…</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ─── Step 3 ────────────────────────────────────────────────────────────────

function Step3({ onContinue }: { onContinue: () => void }) {
  const [tags, setTags] = useState<TagItem[]>(INITIAL_TAGS)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const setStatus = (id: string, status: TagStatus) =>
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)))

  const startEdit = (tag: TagItem) => {
    setEditingId(tag.id)
    setDraftLabel(tag.label)
  }

  const commitEdit = () => {
    if (!editingId) return
    const trimmed = draftLabel.trim()
    if (trimmed.length > 0) {
      setTags((prev) =>
        prev.map((t) => (t.id === editingId ? { ...t, label: trimmed, status: 'pending' } : t)),
      )
    }
    setEditingId(null)
    setDraftLabel('')
  }

  const handleAdd = () => {
    const trimmed = newLabel.trim()
    if (trimmed.length === 0) return
    setTags((prev) => [
      ...prev,
      { id: `t-${Date.now()}`, label: trimmed, status: 'pending' },
    ])
    setNewLabel('')
  }

  return (
    <section className="pb-6">
      <header className="mb-2">
        <h1 className="text-[20px] font-bold text-[#0a0a0a]">Caractéristiques détectées</h1>
        <p className="text-[13px] text-gray-500 mt-1">
          Vérifiez et ajustez les informations extraites automatiquement.
        </p>
      </header>

      <ul className="mt-5 divide-y divide-gray-200 bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {tags.map((tag) => (
          <li key={tag.id} className="px-4 py-3 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              {editingId === tag.id ? (
                <input
                  type="text"
                  value={draftLabel}
                  autoFocus
                  onChange={(e) => setDraftLabel(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') {
                      setEditingId(null)
                      setDraftLabel('')
                    }
                  }}
                  className="w-full bg-transparent text-[14px] text-[#0a0a0a] border-b border-[#0a0a0a]/30 focus:outline-none focus:border-[#0a0a0a] py-0.5"
                />
              ) : (
                <span
                  className={clsx(
                    'text-[14px] block truncate',
                    tag.status === 'deleted'
                      ? 'line-through text-gray-400'
                      : tag.status === 'validated'
                      ? 'text-[#0a0a0a] font-medium'
                      : 'text-[#0a0a0a]',
                  )}
                >
                  {tag.label}
                </span>
              )}
            </div>

            {editingId !== tag.id && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <TagAction
                  onClick={() => setStatus(tag.id, tag.status === 'validated' ? 'pending' : 'validated')}
                  active={tag.status === 'validated'}
                  ariaLabel="Valider"
                  variant="validate"
                >
                  <Check size={15} strokeWidth={2.4} />
                </TagAction>
                <TagAction
                  onClick={() => startEdit(tag)}
                  active={false}
                  ariaLabel="Éditer"
                  variant="edit"
                >
                  <Pencil size={14} />
                </TagAction>
                <TagAction
                  onClick={() => setStatus(tag.id, tag.status === 'deleted' ? 'pending' : 'deleted')}
                  active={tag.status === 'deleted'}
                  ariaLabel="Supprimer"
                  variant="delete"
                >
                  <X size={15} strokeWidth={2.2} />
                </TagAction>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Add new */}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
          placeholder="Ajouter une caractéristique…"
          className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-[#0a0a0a] placeholder-gray-400 focus:outline-none focus:border-[#0a0a0a]/40"
        />
        <button
          type="button"
          onClick={handleAdd}
          aria-label="Ajouter"
          className="w-12 h-12 rounded-xl bg-[#0a0a0a] text-white flex items-center justify-center active:bg-[#222] transition-colors flex-shrink-0"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Continue */}
      <button
        type="button"
        onClick={onContinue}
        className="w-full mt-6 bg-[#0a0a0a] text-white py-4 rounded-2xl font-semibold text-[15px] active:bg-[#222] transition-colors"
      >
        Continuer vers la fiche complète
      </button>
    </section>
  )
}

function TagAction({
  children,
  onClick,
  active,
  ariaLabel,
  variant,
}: {
  children: React.ReactNode
  onClick: () => void
  active: boolean
  ariaLabel: string
  variant: 'validate' | 'edit' | 'delete'
}) {
  const colorActive =
    variant === 'validate'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
      : variant === 'delete'
      ? 'bg-red-50 text-red-600 border-red-200'
      : 'bg-gray-100 text-gray-700 border-gray-200'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={clsx(
        'w-8 h-8 rounded-full border flex items-center justify-center transition-colors',
        active ? colorActive : 'bg-white border-gray-200 text-gray-500 active:bg-gray-50',
      )}
    >
      {children}
    </button>
  )
}
