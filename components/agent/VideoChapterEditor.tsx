'use client'

import { useRef } from 'react'
import { Plus, X } from 'lucide-react'

export type Chapter = { id: string; label: string; startSec: number }

interface VideoChapterEditorProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  duration: number
  chapters: Chapter[]
  onChange: (chapters: Chapter[]) => void
}

function fmtTime(sec: number): string {
  const safe = Math.max(0, sec)
  const m = Math.floor(safe / 60)
  const s = Math.round(safe % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function VideoChapterEditor({
  videoRef,
  duration,
  chapters,
  onChange,
}: VideoChapterEditorProps) {
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null)
  const movedRef = useRef(false)

  const updateChapter = (id: string, patch: Partial<Chapter>) => {
    onChange(chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const removeChapter = (id: string) => {
    onChange(chapters.filter((c) => c.id !== id))
  }

  const addChapter = () => {
    if (duration <= 0) return
    const startSec = Math.max(0, Math.min(duration, videoRef.current?.currentTime ?? 0))
    onChange([
      ...chapters,
      { id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: 'Nouveau', startSec },
    ])
  }

  // ── Pointer drag ─────────────────────────────────────────────────────────

  const startDrag = (id: string, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId) } catch {}
    dragRef.current = { id, pointerId: e.pointerId }
    movedRef.current = false
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !timelineRef.current || duration <= 0) return
    const rect = timelineRef.current.getBoundingClientRect()
    const cursorPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const newSec = cursorPct * duration
    updateChapter(dragRef.current.id, { startSec: newSec })
    if (videoRef.current) videoRef.current.currentTime = newSec
    movedRef.current = true
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const pointerId = dragRef.current.pointerId
    const id = dragRef.current.id
    if (!movedRef.current) {
      // click — jump to chapter start + play
      const chapter = chapters.find((c) => c.id === id)
      if (chapter && videoRef.current) {
        videoRef.current.currentTime = chapter.startSec
        videoRef.current.play().catch(() => {})
      }
    }
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(pointerId) } catch {}
    dragRef.current = null
    movedRef.current = false
  }

  if (duration <= 0) {
    return (
      <div className="text-[11px] text-gray-400 text-center py-4">
        En attente du chargement de la vidéo…
      </div>
    )
  }

  return (
    <div className="w-full select-none">
      {/* Timeline rail with draggable markers */}
      <div
        ref={timelineRef}
        className="relative h-9 w-full"
        style={{ touchAction: 'none' }}
      >
        <div className="absolute top-1/2 left-0 right-0 h-[3px] bg-gray-200 rounded-full -translate-y-1/2" />
        {chapters.map((c) => {
          const pct = Math.min(100, Math.max(0, (c.startSec / duration) * 100))
          return (
            <div
              key={c.id}
              onPointerDown={(e) => startDrag(c.id, e)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{ left: `${pct}%`, touchAction: 'none' }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-9 flex items-center justify-center cursor-ew-resize"
              role="slider"
              aria-label={`Temps fort ${c.label}`}
              aria-valuenow={Math.round(c.startSec)}
            >
              <div className="w-[2px] h-[20px] bg-violet-500 rounded-sm pointer-events-none" />
            </div>
          )
        })}
      </div>

      {/* Labels under the rail */}
      <div className="relative mt-2 min-h-[44px]">
        {chapters.map((c) => {
          const pct = Math.min(100, Math.max(0, (c.startSec / duration) * 100))
          return (
            <div
              key={c.id}
              className="absolute top-0 flex flex-col items-center"
              style={{ left: `${pct}%`, transform: 'translateX(-50%)', width: 80 }}
            >
              <button
                type="button"
                onClick={() => removeChapter(c.id)}
                aria-label="Supprimer ce temps fort"
                className="absolute -top-1.5 -right-0.5 w-4 h-4 rounded-full bg-white border border-gray-200 text-gray-500 flex items-center justify-center shadow-sm active:bg-gray-100"
              >
                <X size={9} />
              </button>
              <input
                type="text"
                value={c.label}
                onChange={(e) => updateChapter(c.id, { label: e.target.value })}
                className="w-full text-[11px] text-center bg-transparent text-[#0a0a0a] border-b border-transparent focus:border-violet-400 focus:outline-none px-1 leading-tight"
              />
              <span className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
                {fmtTime(c.startSec)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Add */}
      <div className="flex justify-center mt-3">
        <button
          type="button"
          onClick={addChapter}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] font-medium text-[#0a0a0a] active:bg-gray-50"
        >
          <Plus size={13} />
          Ajouter un temps fort
        </button>
      </div>
    </div>
  )
}
