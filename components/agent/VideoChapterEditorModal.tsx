'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Poppins } from 'next/font/google'
import { ChevronLeft, Plus, Check, Loader2, RefreshCw, Play, Pause, RotateCcw } from 'lucide-react'
import VideoChapterEditor, { type Chapter } from './VideoChapterEditor'
import VideoProgressBar from '@/components/VideoProgressBar'
import type { AutoSaveStatus } from '@/lib/hooks/useAutoSave'

const poppinsBlack = Poppins({ subsets: ['latin'], weight: '900', display: 'swap' })

interface VideoChapterEditorModalProps {
  isOpen: boolean
  videoUrl: string
  duration: number
  chapters: Chapter[]
  onChange: (chapters: Chapter[]) => void
  onClose: () => void
  autoSaveStatus: AutoSaveStatus
  autoSaveIsDirty: boolean
  autoSaveError?: string | null
  onSaveNow: () => void
}

export default function VideoChapterEditorModal(props: VideoChapterEditorModalProps) {
  return (
    <AnimatePresence>
      {props.isOpen && <ModalContent {...props} />}
    </AnimatePresence>
  )
}

function ModalContent({
  videoUrl,
  duration,
  chapters,
  onChange,
  onClose,
  autoSaveStatus,
  autoSaveIsDirty,
  autoSaveError,
  onSaveNow,
}: VideoChapterEditorModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const [internalDuration, setInternalDuration] = useState(duration)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  // Big centered label that flashes briefly each time the playhead enters a
  // new chapter — replaces the old violet pill at the top.
  const [flashLabel, setFlashLabel] = useState<string | null>(null)
  const [videoPaused, setVideoPaused] = useState(true)
  // Mirror behaviour of the inline editor: centered play/pause button stays
  // on while paused, lingers 2s after resuming, then fades out.
  const [controlVisible, setControlVisible] = useState(true)
  const lastChapterIdRef = useRef<string | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controlFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Snapshot of the chapters at modal open — used to decide whether any
  // modification has been made and to power the Réinitialiser action.
  const [chaptersSnapshot] = useState<Chapter[]>(() => chapters)
  const hasModifs = useMemo(
    () => JSON.stringify(chaptersSnapshot) !== JSON.stringify(chapters),
    [chaptersSnapshot, chapters],
  )

  useEffect(() => {
    if (controlFadeTimerRef.current) {
      clearTimeout(controlFadeTimerRef.current)
      controlFadeTimerRef.current = null
    }
    if (videoPaused) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setControlVisible(true)
      return
    }
    setControlVisible(true)
    controlFadeTimerRef.current = setTimeout(() => setControlVisible(false), 2000)
    return () => {
      if (controlFadeTimerRef.current) {
        clearTimeout(controlFadeTimerRef.current)
        controlFadeTimerRef.current = null
      }
    }
  }, [videoPaused])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setCurrentTime(v.currentTime)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('seeked', onTime)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('seeked', onTime)
    }
  }, [])

  useEffect(() => {
    if (renameId !== null) {
      const el = renameInputRef.current
      if (el) {
        el.focus()
        try { el.select() } catch {}
      }
    }
  }, [renameId])

  const sorted = [...chapters].sort((a, b) => a.startSec - b.startSec)
  let currentChapter: Chapter | undefined = sorted[0]
  for (const c of sorted) if (c.startSec <= currentTime) currentChapter = c

  // Flash the centered label whenever the playhead crosses into a new chapter.
  useEffect(() => {
    if (!currentChapter) return
    if (currentChapter.id === lastChapterIdRef.current) return
    lastChapterIdRef.current = currentChapter.id
    setFlashLabel(currentChapter.label)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashLabel(null), 1700)
  }, [currentChapter])

  // Chapters projected to {label, fraction} for the Stories-style progress
  // bar — recomputed live as the agent reorders / adds / removes chapters.
  const fractionalChapters = useMemo(() => {
    if (chapters.length === 0 || !internalDuration) return undefined
    return [...chapters]
      .sort((a, b) => a.startSec - b.startSec)
      .map((c) => ({
        label: c.label,
        fraction: Math.min(1, Math.max(0, c.startSec / internalDuration)),
      }))
  }, [chapters, internalDuration])

  // Label tap on the canvas opens the rename bar. Pausing here keeps the
  // playhead still while the agent types.
  const handleLabelClick = (ch: Chapter) => {
    videoRef.current?.pause()
    setRenameId(ch.id)
    setRenameValue(ch.label)
  }

  const commitRename = () => {
    if (renameId && renameValue.trim()) {
      onChange(chapters.map((c) => (c.id === renameId ? { ...c, label: renameValue.trim() } : c)))
    }
    setRenameId(null)
    setRenameValue('')
  }

  const cancelRename = () => {
    setRenameId(null)
    setRenameValue('')
  }

  const handleAddChapter = () => {
    const v = videoRef.current
    v?.pause()
    const t = v ? v.currentTime : 0
    const id = `mod-${Date.now()}`
    const newCh: Chapter = {
      id,
      label: 'Nouvelle pièce',
      startSec: parseFloat(t.toFixed(2)),
    }
    onChange([...chapters, newCh])
    setRenameId(id)
    setRenameValue('Nouvelle pièce')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      {/* Video area */}
      <div
        className="relative w-full overflow-hidden transition-all duration-300"
        style={
          renameId !== null
            ? { flex: '0 0 220px' }
            : { flex: '1 1 0%', minHeight: 0 }
        }
      >
        <video
          ref={videoRef}
          src={videoUrl}
          preload="metadata"
          playsInline
          onLoadedMetadata={() => {
            const d = videoRef.current?.duration
            if (d && Number.isFinite(d)) setInternalDuration(d)
          }}
          onPlay={() => setVideoPaused(false)}
          onPause={() => setVideoPaused(true)}
          onClick={() => {
            const v = videoRef.current
            if (!v) return
            if (v.paused) v.play().catch(() => {})
            else v.pause()
          }}
          className="absolute inset-0 w-full h-full object-contain cursor-pointer"
        />

        {/* Centered play/pause control — replaces the native one. Stays put
            while paused, lingers 2s and fades out once playback resumes. */}
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current
            if (!v) return
            if (v.paused) v.play().catch(() => {})
            else v.pause()
          }}
          aria-label={videoPaused ? 'Lecture' : 'Pause'}
          className={`absolute inset-0 m-auto w-16 h-16 z-30 bg-black/55 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20 transition-opacity duration-500 ${
            controlVisible
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          {videoPaused
            ? <Play size={26} className="text-white translate-x-0.5" />
            : <Pause size={26} className="text-white" />}
        </button>

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center gap-2 px-3 py-3 bg-gradient-to-b from-black/70 to-transparent z-10">
          <button
            type="button"
            onClick={onClose}
            aria-label="Retour"
            className="w-9 h-9 rounded-full flex items-center justify-center bg-black/40 text-white active:bg-black/60"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 flex justify-center">
            {hasModifs && (
              <button
                type="button"
                onClick={() => onChange(chaptersSnapshot)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 text-white text-[11px] font-medium active:bg-black/60"
              >
                <RotateCcw size={12} />
                Réinitialiser
              </button>
            )}
          </div>
          <CompactAutoSaveBadge
            status={autoSaveStatus}
            isDirty={autoSaveIsDirty}
            error={autoSaveError}
            onRetry={onSaveNow}
          />
        </div>

        {/* Big centered chapter label — flashes on each new chapter the
            playhead enters (no continuous pill, no auto-loop trigger). */}
        {flashLabel && (
          <div
            // eslint-disable-next-line react-hooks/purity
            key={flashLabel + Date.now()}
            className={`absolute inset-0 z-[18] flex items-center justify-center pointer-events-none animate-fade-in-out px-6 ${poppinsBlack.className}`}
          >
            <span
              className="text-center uppercase tracking-wider text-white/75 drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
              style={{ fontSize: 'clamp(2.25rem, 11vw, 4rem)', lineHeight: 1 }}
            >
              {flashLabel}
            </span>
          </div>
        )}

        {/* Stories-style progress bar — REPLACES the native progress bar.
            Updates live as the agent reorders / adds / removes chapters,
            falls back to a single fill segment when none are defined. */}
        <VideoProgressBar
          videoRef={videoRef}
          chapters={fractionalChapters}
          bottom="12px"
          inset="12px"
        />
      </div>

      {/* Editor panel */}
      <div className="flex-shrink-0 bg-black">
        {/* Header: left-aligned hint + add button */}
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
          <p className="text-[11px] text-gray-400 leading-snug">
            Déplacez-les, renommez-les, ajoutez ou supprimez-en selon vos besoins.
          </p>
          <button
            type="button"
            onClick={handleAddChapter}
            className="flex-shrink-0 flex items-center gap-1 py-1.5 px-3 rounded-full bg-violet-900/30 border border-violet-500/40 text-violet-400 text-[11px] font-medium active:bg-violet-900/50"
          >
            <Plus size={11} />
            Ajouter une pièce
          </button>
        </div>

        {/* Rename bar (conditional) */}
        <AnimatePresence initial={false}>
          {renameId !== null && (
            <motion.div
              key="rename-bar"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="px-4 overflow-hidden"
            >
              <div className="py-2">
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                    if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                  }}
                  onBlur={commitRename}
                  autoFocus
                  placeholder="Nom de la pièce…"
                  className="w-full bg-transparent border border-violet-500 rounded-xl px-3 py-2 text-[14px] text-white placeholder-gray-500 focus:outline-none focus:border-violet-400"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Timeline editor — dark theme so labels render white */}
        <div className="px-3 pt-2 pb-4">
          <VideoChapterEditor
            videoRef={videoRef}
            duration={internalDuration}
            chapters={chapters}
            onChange={onChange}
            onLabelClick={handleLabelClick}
            hideAddButton
            theme="dark"
          />
        </div>
      </div>
    </motion.div>
  )
}

function CompactAutoSaveBadge({
  status,
  isDirty,
  error,
  onRetry,
}: {
  status: AutoSaveStatus
  isDirty: boolean
  error?: string | null
  onRetry: () => void
}) {
  // Show "Sauvegardé" for 5 s after a save lands, then fade out. The agent
  // never sees an explicit "Sauvegarder" CTA here — auto-save handles every
  // persistence and idle/dirty states stay quiet.
  const [savedVisible, setSavedVisible] = useState(false)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = null
    }
    if (status === 'saved' && !isDirty) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedVisible(true)
      fadeTimerRef.current = setTimeout(() => setSavedVisible(false), 5000)
    } else {
      setSavedVisible(false)
    }
    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current)
        fadeTimerRef.current = null
      }
    }
  }, [status, isDirty])

  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/40 text-white text-[11px] font-medium">
        <Loader2 size={12} className="animate-spin" />
        Sauvegarde…
      </span>
    )
  }
  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={error ?? undefined}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/80 text-white text-[11px] font-semibold active:bg-red-500"
      >
        <RefreshCw size={12} />
        Réessayer
      </button>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/40 text-white text-[11px] font-medium transition-opacity duration-500 ${
        savedVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-hidden={!savedVisible}
    >
      <Check size={12} className="text-emerald-400" />
      Sauvegardé
    </span>
  )
}
