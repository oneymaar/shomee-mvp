'use client'

import { Fragment, useMemo, useRef } from 'react'
import { X } from 'lucide-react'

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

const AFTER_MARKER_PX  = 1 // half of the 2px marker width — segment starts right after the marker
const BEFORE_MARKER_PX = 5 // half marker (1px) + 4px gap before the next marker

export default function VideoChapterEditor({
  videoRef,
  duration,
  chapters,
  onChange,
}: VideoChapterEditorProps) {
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null)
  const movedRef = useRef(false)

  // Sort markers by startSec so segments and label alternation follow the
  // visual order, independent of the user's add order.
  const sortedChapters = useMemo(
    () => [...chapters].sort((a, b) => a.startSec - b.startSec),
    [chapters],
  )

  const segments = useMemo(() => {
    if (duration <= 0) return []
    const pcts = sortedChapters.map((c) =>
      Math.min(100, Math.max(0, (c.startSec / duration) * 100)),
    )
    if (pcts.length === 0) {
      return [{ leftPct: 0, rightPct: 0, leftHasMarker: false, rightHasMarker: false }]
    }
    const out: Array<{ leftPct: number; rightPct: number; leftHasMarker: boolean; rightHasMarker: boolean }> = []
    // Leading segment — only if the first marker is not at 0%
    if (pcts[0] > 0) {
      out.push({ leftPct: 0, rightPct: 100 - pcts[0], leftHasMarker: false, rightHasMarker: true })
    }
    // Inter-marker segments
    for (let i = 0; i < pcts.length - 1; i++) {
      out.push({
        leftPct: pcts[i],
        rightPct: 100 - pcts[i + 1],
        leftHasMarker: true,
        rightHasMarker: true,
      })
    }
    // Trailing segment — only if the last marker is not at 100%
    if (pcts[pcts.length - 1] < 100) {
      out.push({
        leftPct: pcts[pcts.length - 1],
        rightPct: 0,
        leftHasMarker: true,
        rightHasMarker: false,
      })
    }
    return out
  }, [sortedChapters, duration])

  const updateChapter = (id: string, patch: Partial<Chapter>) => {
    onChange(chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const removeChapter = (id: string) => {
    onChange(chapters.filter((c) => c.id !== id))
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
    <div className="pt-8 pb-20">
      {/* 3px line — all chapter satellites position from here */}
      <div ref={timelineRef} className="relative h-[3px]" style={{ touchAction: 'none' }}>
        {/* Stories-style segmented rail */}
        {segments.map((s, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 bg-gray-200 rounded-full"
            style={{
              left:  `calc(${s.leftPct}%${s.leftHasMarker ? ` + ${AFTER_MARKER_PX}px` : ''})`,
              right: `calc(${s.rightPct}%${s.rightHasMarker ? ` + ${BEFORE_MARKER_PX}px` : ''})`,
            }}
          />
        ))}

        {sortedChapters.map((c, sortedIdx) => {
          const pct = Math.min(100, Math.max(0, (c.startSec / duration) * 100))
          const isEven = sortedIdx % 2 === 0

          return (
            <Fragment key={c.id}>
              {/* × — always 6px above the line, centered on the marker */}
              <button
                type="button"
                onClick={() => removeChapter(c.id)}
                aria-label="Supprimer ce temps fort"
                style={{
                  left: `${pct}%`,
                  bottom: 'calc(100% + 10px)',
                  transform: 'translateX(-50%)',
                }}
                className="absolute w-4 h-4 rounded-full bg-white border border-gray-200 text-gray-500 flex items-center justify-center shadow-sm active:bg-gray-100"
              >
                <X size={9} />
              </button>

              {/* Marker — draggable, on the line */}
              <div
                onPointerDown={(e) => startDrag(c.id, e)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{
                  left: `${pct}%`,
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  touchAction: 'none',
                }}
                className="absolute w-4 h-9 flex items-center justify-center cursor-ew-resize"
                role="slider"
                aria-label={`Temps fort ${c.label}`}
                aria-valuenow={Math.round(c.startSec)}
              >
                <div className="w-[2px] h-[24px] bg-violet-500 rounded-sm pointer-events-none" />
              </div>

              {/* Timestamp — 4px below the line, centered on the marker */}
              <span
                style={{
                  left: `${pct}%`,
                  top: 'calc(100% + 10px)',
                  transform: 'translateX(-50%)',
                }}
                className="absolute text-[10px] text-gray-400 tabular-nums pointer-events-none"
              >
                {fmtTime(c.startSec)}
              </span>

              {/* Label — staggered: even index at +20px, odd index at +36px */}
              <input
                type="text"
                value={c.label}
                onChange={(e) => updateChapter(c.id, { label: e.target.value })}
                style={{
                  left: `${pct}%`,
                  top: `calc(100% + ${isEven ? 26 : 42}px)`,
                  transform: 'translateX(-50%)',
                  minWidth: 80,
                  maxWidth: 100,
                }}
                className="absolute text-[11px] text-center bg-transparent text-[#0a0a0a] border-b border-transparent focus:border-violet-400 focus:outline-none px-1 leading-tight"
              />
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
