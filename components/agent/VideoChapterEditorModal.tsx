'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Plus } from 'lucide-react'
import VideoChapterEditor, { type Chapter } from './VideoChapterEditor'

interface VideoChapterEditorModalProps {
  isOpen: boolean
  videoUrl: string
  duration: number
  chapters: Chapter[]
  onSave: (chapters: Chapter[]) => void
  onClose: () => void
}

export default function VideoChapterEditorModal({
  isOpen,
  videoUrl,
  duration,
  chapters: initialChapters,
  onSave,
  onClose,
}: VideoChapterEditorModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <ModalContent
          videoUrl={videoUrl}
          duration={duration}
          initialChapters={initialChapters}
          onSave={onSave}
          onClose={onClose}
        />
      )}
    </AnimatePresence>
  )
}

function ModalContent({
  videoUrl,
  duration,
  initialChapters,
  onSave,
  onClose,
}: {
  videoUrl: string
  duration: number
  initialChapters: Chapter[]
  onSave: (chapters: Chapter[]) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>(initialChapters)
  const [internalDuration, setInternalDuration] = useState(duration)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [currentTime, setCurrentTime] = useState(0)

  // Follow the video clock so the "current chapter" pill updates live.
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

  const handleLabelClick = (ch: Chapter) => {
    videoRef.current?.pause()
    setRenameId(ch.id)
    setRenameValue(ch.label)
  }

  const commitRename = () => {
    if (renameId && renameValue.trim()) {
      setChapters((prev) =>
        prev.map((c) => (c.id === renameId ? { ...c, label: renameValue.trim() } : c)),
      )
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
    setChapters((prev) => [...prev, newCh])
    setRenameId(id)
    setRenameValue('Nouvelle pièce')
  }

  const handleSave = () => {
    onSave(chapters)
    onClose()
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
          controls
          playsInline
          onLoadedMetadata={() => {
            const d = videoRef.current?.duration
            if (d && Number.isFinite(d)) setInternalDuration(d)
          }}
          className="absolute inset-0 w-full h-full object-contain"
        />

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center gap-2 px-3 py-3 bg-gradient-to-b from-black/70 to-transparent z-10">
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="w-9 h-9 rounded-full flex items-center justify-center bg-black/40 text-white active:bg-black/60"
          >
            <X size={18} />
          </button>
          <h2 className="flex-1 text-[14px] font-semibold text-white">Marqueurs de pièces</h2>
          <button
            type="button"
            onClick={handleSave}
            className="px-3 py-1.5 rounded-full bg-white text-[#0a0a0a] text-[12px] font-semibold active:bg-white/80"
          >
            Enregistrer
          </button>
        </div>

        {/* Pill: chapter actuel */}
        <AnimatePresence mode="wait">
          {currentChapter && (
            <motion.div
              key={currentChapter.id}
              layoutId="current-chapter-pill"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="absolute top-14 left-1/2 -translate-x-1/2 z-10"
            >
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-violet-500/90 text-white text-[12px] font-medium shadow-md backdrop-blur-sm">
                {currentChapter.label}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Editor panel */}
      <div className="flex-shrink-0 bg-[#0a0a0a]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Pièces
          </span>
          <button
            type="button"
            onClick={handleAddChapter}
            className="flex items-center gap-1 py-1.5 px-3 rounded-full bg-violet-900/30 border border-violet-500/40 text-violet-400 text-[11px] font-medium active:bg-violet-900/50"
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

        {/* Timeline editor (light surface inside the dark panel) */}
        <div className="bg-white mx-3 mt-2 mb-3 rounded-xl px-2 py-2">
          <VideoChapterEditor
            videoRef={videoRef}
            duration={internalDuration}
            chapters={chapters}
            onChange={setChapters}
            onLabelClick={handleLabelClick}
            hideAddButton
          />
        </div>

        <p className="text-[11px] text-gray-500 text-center px-4 pb-4 leading-relaxed">
          Déplacez les marqueurs pour ajuster les temps. Touchez un nom pour le renommer.
        </p>
      </div>
    </motion.div>
  )
}
