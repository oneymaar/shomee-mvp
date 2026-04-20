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
  const trackRef  = useRef<HTMLDivElement>(null)
  const labelRef  = useRef<HTMLSpanElement>(null)
  const fillRefs  = useRef<(HTMLDivElement | null)[]>([])
  const rafId     = useRef<number>(0)
  const scrubbing = useRef(false)

  const segs = chapters && chapters.length >= 2 ? chapters : null

  /* ─── Paint fills ─────────────────────────────────────────────────────── */
  const paint = useCallback((f: number) => {
    if (segs) {
      segs.forEach((ch, i) => {
        const el  = fillRefs.current[i]
        if (!el) return
        const end = segs[i + 1]?.fraction ?? 1
        let w = 0
        if      (f >= end)         w = 100
        else if (f >  ch.fraction) w = ((f - ch.fraction) / (end - ch.fraction)) * 100
        el.style.width = `${w}%`
      })
    } else {
      const el = fillRefs.current[0]
      if (el) el.style.width = `${f * 100}%`
    }
  }, [segs])

  /* ─── rAF loop ────────────────────────────────────────────────────────── */
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

  const showLabel = useCallback((f: number) => {
    const ch = chapterAt(f)
    const lb = labelRef.current
    if (!lb || !ch) return
    lb.textContent = ch.label
    lb.style.opacity = '1'
  }, [chapterAt])

  const hideLabel = () => {
    if (labelRef.current) labelRef.current.style.opacity = '0'
  }

  /* Touch */
  const onTouchStart = (e: React.TouchEvent) => {
    scrubbing.current = true
    const f = fractionFromX(e.touches[0].clientX)
    paint(f); showLabel(f)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!scrubbing.current) return
    const f = fractionFromX(e.touches[0].clientX)
    paint(f); showLabel(f)
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!scrubbing.current) return
    scrubbing.current = false
    hideLabel()
    const f = fractionFromX(e.changedTouches[0].clientX)
    paint(f)
    const v = videoRef.current
    if (v && v.duration > 0) v.currentTime = f * v.duration
  }

  /* Mouse */
  const onMouseDown = (e: React.MouseEvent) => {
    scrubbing.current = true
    const f = fractionFromX(e.clientX)
    paint(f); showLabel(f)
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!scrubbing.current) return
    const f = fractionFromX(e.clientX)
    paint(f); showLabel(f)
  }
  const onMouseUp = (e: React.MouseEvent) => {
    if (!scrubbing.current) return
    scrubbing.current = false
    hideLabel()
    const f = fractionFromX(e.clientX)
    paint(f)
    const v = videoRef.current
    if (v && v.duration > 0) v.currentTime = f * v.duration
  }

  /* ─── Render ──────────────────────────────────────────────────────────── */
  return (
    <div
      className="absolute left-3 right-3 z-40 cursor-pointer select-none"
      style={{ top: 0, touchAction: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* Safe-area spacer so bar sits just below the notch */}
      <div style={{ height: 'env(safe-area-inset-top, 8px)' }} />

      {/* Chapter name — appears above bar on scrub */}
      <div style={{ height: 16, display: 'flex', alignItems: 'center', marginBottom: 3 }}>
        <span
          ref={labelRef}
          className="text-white text-[11px] font-semibold"
          style={{ opacity: 0, transition: 'opacity 0.12s', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
        />
      </div>

      {/* Track — segmented or simple */}
      <div ref={trackRef} className="flex gap-[3px]" style={{ height: 3 }}>
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

      {/* Extra invisible touch zone below bar */}
      <div style={{ height: 14 }} />
    </div>
  )
}
