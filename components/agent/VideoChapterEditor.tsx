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

const CONTAINER_MIN_HEIGHT = 180
const MARKER_GAP_PX = 4

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

  // ── Sorted view + segments ───────────────────────────────────────────────
  // Alternate label position by SORTED order so adjacent labels don't collide.
  const sortedChapters = useMemo(
    () => [...chapters].sort((a, b) => a.startSec - b.startSec),
    [chapters],
  )

  const segments = useMemo(() => {
    if (duration <= 0) return []
    const pcts = sortedChapters.map((c) =>
      Math.min(100, Math.max(0, (c.startSec / duration) * 100)),
    )
    const out: Array<{ leftPct: number; rightPct: number; leftHasMarker: boolean; rightHasMarker: boolean }> = []
    let lastEnd = 0
    let lastHasMarker = false
    for (const m of pcts) {
      if (m > lastEnd) {
        out.push({
          leftPct: lastEnd,
          rightPct: 100 - m,
          leftHasMarker: lastHasMarker,
          rightHasMarker: true,
        })
      }
      lastEnd = m
      lastHasMarker = true
    }
    if (lastEnd < 100) {
      out.push({
        leftPct: lastEnd,
        rightPct: 0,
        leftHasMarker: lastHasMarker,
        rightHasMarker: false,
      })
    }
    return out
  }, [sortedChapters, duration])

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
    <div
      ref={timelineRef}
      className="relative w-full select-none"
      style={{ minHeight: CONTAINER_MIN_HEIGHT, touchAction: 'none' }}
    >
      {/* ── Segmented rail (gray, stories-style with 4px gaps around markers) ── */}
      <div
        className="absolute left-0 right-0 h-[3px] pointer-events-none"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      >
        {segments.map((s, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 bg-gray-200 rounded-full"
            style={{
              left:  `calc(${s.leftPct}%${s.leftHasMarker ? ` + ${MARKER_GAP_PX}px` : ''})`,
              right: `calc(${s.rightPct}%${s.rightHasMarker ? ` + ${MARKER_GAP_PX}px` : ''})`,
            }}
          />
        ))}
      </div>

      {/* ── Per-chapter stack (× → timestamp → marker → alternated label) ── */}
      {sortedChapters.map((c, sortedIdx) => {
        const pct = Math.min(100, Math.max(0, (c.startSec / duration) * 100))
        const isEven = sortedIdx % 2 === 0

        return (
          <Fragment key={c.id}>
            {/* × — always above the marker */}
            <button
              type="button"
              onClick={() => removeChapter(c.id)}
              aria-label="Supprimer ce temps fort"
              style={{
                left: `${pct}%`,
                top: 'calc(50% - 46px)',
                transform: 'translateX(-50%)',
              }}
              className="absolute w-4 h-4 rounded-full bg-white border border-gray-200 text-gray-500 flex items-center justify-center shadow-sm active:bg-gray-100"
            >
              <X size={9} />
            </button>

            {/* Timestamp — just above the marker */}
            <span
              style={{
                left: `${pct}%`,
                top: 'calc(50% - 26px)',
                transform: 'translateX(-50%)',
              }}
              className="absolute text-[10px] text-gray-400 tabular-nums pointer-events-none"
            >
              {fmtTime(c.startSec)}
            </span>

            {/* Marker — draggable, on the rail */}
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

            {/* Label — alternating: even index above, odd index below */}
            <input
              type="text"
              value={c.label}
              onChange={(e) => updateChapter(c.id, { label: e.target.value })}
              className="absolute text-[11px] text-center bg-transparent text-[#0a0a0a] border-b border-transparent focus:border-violet-400 focus:outline-none px-1 leading-tight"
              style={{
                left: `${pct}%`,
                transform: 'translateX(-50%)',
                width: 72,
                ...(isEven
                  ? { top: 'calc(50% - 70px)' }
                  : { top: 'calc(50% + 20px)' }
                ),
              }}
            />
          </Fragment>
        )
      })}
    </div>
  )
}
