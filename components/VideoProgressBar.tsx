'use client'

import { useRef, useEffect, useCallback } from 'react'

export interface Chapter {
  label: string
  fraction: number
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
  chapters?: Chapter[]
}

export default function VideoProgressBar({ videoRef, chapters }: Props) {
  const trackRef   = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const labelRef   = useRef<HTMLSpanElement>(null)
  const fillRefs   = useRef<(HTMLDivElement | null)[]>([])
  const rafId      = useRef<number>(0)
  const scrubbing  = useRef(false)

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

  const chapterAt = useCallback((f: number): Chapter | null => {
    if (!segs) return null
    let cur = segs[0]
    for (const ch of segs) if (f >= ch.fraction) cur = ch
    return cur
  }, [segs])

  const moveTooltip = useCallback((f: number) => {
    const ch = chapterAt(f)
    const el = tooltipRef.current
    const lb = labelRef.current
    if (!el || !lb || !ch) return
    el.style.left    = `${Math.max(5, Math.min(90, f * 100))}%`
    el.style.opacity = '1'
    lb.textContent   = ch.label
  }, [chapterAt])

  const hideTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = '0' }

  /* Touch */
  const onTouchStart = (e: React.TouchEvent) => {
    scrubbing.current = true
    const f = fractionFromX(e.touches[0].clientX)
    paint(f); moveTooltip(f)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!scrubbing.current) return
    const f = fractionFromX(e.touches[0].clientX)
    paint(f); moveTooltip(f)
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!scrubbing.current) return
    scrubbing.current = false
    hideTooltip()
    const f = fractionFromX(e.changedTouches[0].clientX)
    paint(f)
    const v = videoRef.current
    if (v && v.duration > 0) v.currentTime = f * v.duration
  }

  /* Mouse (desktop preview) */
  const onMouseDown = (e: React.MouseEvent) => {
    scrubbing.current = true
    const f = fractionFromX(e.clientX)
    paint(f); moveTooltip(f)
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!scrubbing.current) return
    const f = fractionFromX(e.clientX)
    paint(f); moveTooltip(f)
  }
  const onMouseUp = (e: React.MouseEvent) => {
    if (!scrubbing.current) return
    scrubbing.current = false
    hideTooltip()
    const f = fractionFromX(e.clientX)
    paint(f)
    const v = videoRef.current
    if (v && v.duration > 0) v.currentTime = f * v.duration
  }

  /* ─── Render ──────────────────────────────────────────────────────────── */
  return (
    /*
      Outer wrapper: 28px tall touch target anchored at bottom-10 (40px above
      the card's bottom edge so it clears the BottomNav border and is easy to tap).
      The 4px visual bar sits at the very bottom of this wrapper.
    */
    <div
      className="absolute left-0 right-0 z-40 flex flex-col justify-end cursor-pointer select-none"
      style={{ bottom: 8, height: 28, touchAction: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* Chapter-name tooltip */}
      <div
        ref={tooltipRef}
        className="absolute -translate-x-1/2 bg-black/85 backdrop-blur-sm text-white text-[11px] font-semibold px-3 py-1 rounded-full whitespace-nowrap border border-white/20 pointer-events-none"
        style={{ opacity: 0, bottom: 10, transition: 'opacity 0.12s' }}
      >
        <span ref={labelRef} />
      </div>

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
}
