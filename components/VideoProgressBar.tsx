'use client'

import { useRef, useEffect, useCallback, forwardRef } from 'react'

export interface Chapter {
  label: string
  fraction: number
}

/** Empty handle kept for backwards compatibility with existing refs. */
export type VideoProgressBarHandle = Record<string, never>

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
  chapters?: Chapter[]
  /**
   * CSS `bottom` value for the bar wrapper — defaults to the feed offset
   * above the buyer bottom nav. Override when embedding the bar elsewhere
   * (editor video, modal, …) so it clears the surrounding chrome.
   */
  bottom?: string
  /**
   * CSS value applied to both `left` and `right` so the bar can be inset
   * from the edges of its container (e.g. to clear the rounded corners of
   * the editor video). Defaults to 0 — feed-style edge-to-edge.
   */
  inset?: string
}

const VideoProgressBar = forwardRef<VideoProgressBarHandle, Props>(function VideoProgressBar({ videoRef, chapters, bottom, inset }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const fillRefs = useRef<(HTMLDivElement | null)[]>([])
  const rafId    = useRef<number>(0)
  const scrubbing = useRef(false)

  const segs = chapters && chapters.length >= 2 ? chapters : null

  /* ─── Paint fills from 0-1 fraction (pure DOM, no re-renders) ─────────── */
  const paint = useCallback((f: number) => {
    if (segs) {
      segs.forEach((ch, i) => {
        const el  = fillRefs.current[i]
        if (!el) return
        const end = segs[i + 1]?.fraction ?? 1
        let w = 0
        if      (f >= end)        w = 100
        else if (f >  ch.fraction) w = ((f - ch.fraction) / (end - ch.fraction)) * 100
        el.style.width = `${w}%`
      })
    } else {
      const el = fillRefs.current[0]
      if (el) el.style.width = `${f * 100}%`
    }
  }, [segs])

  /* ─── rAF loop — runs continuously while component is mounted ─────────── */
  useEffect(() => {
    const loop = () => {
      if (!scrubbing.current) {
        const v = videoRef.current
        if (v && v.duration > 0) paint(v.currentTime / v.duration)
      }
      rafId.current = requestAnimationFrame(loop)
    }
    rafId.current = requestAnimationFrame(loop)
    return () => { if (rafId.current) cancelAnimationFrame(rafId.current) }
  }, [videoRef, paint])

  /* ─── Scrub helpers ───────────────────────────────────────────────────── */
  const fractionFromX = useCallback((clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }, [])

  /* Touch */
  const onTouchStart = (e: React.TouchEvent) => {
    scrubbing.current = true
    paint(fractionFromX(e.touches[0].clientX))
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!scrubbing.current) return
    paint(fractionFromX(e.touches[0].clientX))
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!scrubbing.current) return
    scrubbing.current = false
    const f = fractionFromX(e.changedTouches[0].clientX)
    paint(f)
    const v = videoRef.current
    if (v && v.duration > 0) v.currentTime = f * v.duration
  }

  /* Mouse (desktop preview) */
  const onMouseDown = (e: React.MouseEvent) => {
    scrubbing.current = true
    paint(fractionFromX(e.clientX))
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!scrubbing.current) return
    paint(fractionFromX(e.clientX))
  }
  const onMouseUp = (e: React.MouseEvent) => {
    if (!scrubbing.current) return
    scrubbing.current = false
    const f = fractionFromX(e.clientX)
    paint(f)
    const v = videoRef.current
    if (v && v.duration > 0) v.currentTime = f * v.duration
  }

  /* ─── Render ──────────────────────────────────────────────────────────── */
  return (
    <div
      className="absolute z-40 flex flex-col justify-end cursor-pointer select-none"
      style={{
        bottom: bottom ?? 'calc(var(--nav-h) + 8px)',
        left: inset ?? 0,
        right: inset ?? 0,
        height: 28,
        touchAction: 'none',
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* Track: segmented if chapters, simple otherwise */}
      <div ref={trackRef} className="flex gap-[3px]" style={{ height: 4 }}>
        {segs ? (
          segs.map((ch, i) => {
            const end = segs[i + 1]?.fraction ?? 1
            return (
              <div
                key={i}
                className="relative rounded-full overflow-hidden"
                style={{ flex: end - ch.fraction, height: '100%', backgroundColor: 'rgba(255,255,255,0.35)' }}
              >
                <div
                  ref={el => { fillRefs.current[i] = el }}
                  className="absolute inset-y-0 left-0 rounded-full bg-white"
                  style={{ width: '0%' }}
                />
              </div>
            )
          })
        ) : (
          <div
            className="relative flex-1 rounded-full overflow-hidden"
            style={{ height: '100%', backgroundColor: 'rgba(255,255,255,0.35)' }}
          >
            <div
              ref={el => { fillRefs.current[0] = el }}
              className="absolute inset-y-0 left-0 bg-white"
              style={{ width: '0%' }}
            />
          </div>
        )}
      </div>
    </div>
  )
})

export default VideoProgressBar
