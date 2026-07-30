'use client'

/**
 * Barre de progression du feed.
 *
 * Jumelle web de `apps/mobile/src/components/VideoProgressBar.tsx` :
 * - **segmentée** dès deux chapitres (un segment = un chapitre, largeur
 *   proportionnelle à sa durée), continue sinon ;
 * - **peinte en direct dans le DOM** (aucun re-render pendant la lecture) ;
 * - **navigable au doigt** : la piste grossit (3,5 → 6 px), une pastille
 *   blanche apparaît sous le doigt et une étiquette « chapitre · minutage »
 *   suit le curseur.
 *
 * Les gouttières sont prélevées DANS chaque segment (marge à gauche) et non
 * par un `gap` sur la piste : sinon la largeur utile diminuerait de 3 px par
 * gouttière et la pastille (posée à `progression × largeur`) dériverait de la
 * frontière de remplissage — jusqu'à 12 px sur cinq chapitres.
 */

import { useRef, useEffect, useCallback, useState, forwardRef } from 'react'

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
  /** Remonte l'état de scrub pour estomper l'habillage du feed. */
  onScrubbingChange?: (scrubbing: boolean) => void
}

const TRACK_IDLE = 3.5
const TRACK_ACTIVE = 6
const GAP = 3
const THUMB = 14

/** Minutage court : 1:07, 12:04. */
function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const VideoProgressBar = forwardRef<VideoProgressBarHandle, Props>(function VideoProgressBar({
  videoRef,
  chapters,
  bottom,
  inset,
  onScrubbingChange,
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const fillRefs = useRef<(HTMLDivElement | null)[]>([])
  const thumbRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const rafId = useRef<number>(0)
  const scrubbing = useRef(false)
  const lastHintSecRef = useRef(-1)

  const [active, setActive] = useState(false)
  const [trackWidth, setTrackWidth] = useState(0)
  const [hint, setHint] = useState<{ label: string | null; time: string } | null>(null)

  const segs = chapters && chapters.length >= 2 ? chapters : null

  /* ── Largeur mesurée — sert au calcul des segments en pixels ─────────── */
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const apply = () => setTrackWidth(el.getBoundingClientRect().width)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ── Peinture (DOM direct, zéro re-render) ──────────────────────────── */
  const paint = useCallback(
    (f: number) => {
      if (segs) {
        segs.forEach((ch, i) => {
          const el = fillRefs.current[i]
          if (!el) return
          const end = segs[i + 1]?.fraction ?? 1
          let w = 0
          if (f >= end) w = 100
          else if (f > ch.fraction) w = ((f - ch.fraction) / (end - ch.fraction)) * 100
          el.style.width = `${w}%`
        })
      } else {
        const el = fillRefs.current[0]
        if (el) el.style.width = `${f * 100}%`
      }

      const w = trackRef.current?.getBoundingClientRect().width ?? 0
      if (thumbRef.current) {
        thumbRef.current.style.transform = `translateX(${f * w}px) scale(${scrubbing.current ? 1 : 0.3})`
      }
      // L'étiquette suit le curseur, bornée à 8 px des deux bords.
      const pill = hintRef.current
      if (pill) {
        const pw = pill.offsetWidth
        const max = Math.max(8, w - pw - 8)
        pill.style.transform = `translateX(${Math.min(max, Math.max(8, f * w - pw / 2))}px)`
        // Affichée seulement une fois placée : sinon elle clignote au bord
        // gauche le temps d'une image.
        pill.style.opacity = pw > 0 ? '1' : '0'
      }
    },
    [segs],
  )

  /* ── Boucle rAF — tourne tant que le composant est monté ─────────────── */
  useEffect(() => {
    const loop = () => {
      if (!scrubbing.current) {
        const v = videoRef.current
        if (v && v.duration > 0) paint(v.currentTime / v.duration)
      }
      rafId.current = requestAnimationFrame(loop)
    }
    rafId.current = requestAnimationFrame(loop)
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current)
    }
  }, [videoRef, paint])

  /* ── Scrub ───────────────────────────────────────────────────────────── */
  const fractionFromX = useCallback((clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }, [])

  // Rafraîchi seulement quand la seconde affichée change : le doigt émet à
  // 60 Hz, le re-render React reste à quelques images par glissement.
  const updateHint = useCallback(
    (f: number) => {
      const v = videoRef.current
      const dur = v?.duration ?? 0
      if (!(dur > 0)) return
      const t = f * dur
      const sec = Math.floor(t)
      if (sec === lastHintSecRef.current) return
      lastHintSecRef.current = sec
      let label: string | null = null
      if (segs) {
        for (const c of segs) if (c.fraction <= f) label = c.label
      }
      setHint({ label, time: formatClock(t) })
    },
    [segs, videoRef],
  )

  const startScrub = useCallback(
    (clientX: number) => {
      scrubbing.current = true
      setActive(true)
      onScrubbingChange?.(true)
      const f = fractionFromX(clientX)
      updateHint(f)
      paint(f)
    },
    [fractionFromX, onScrubbingChange, paint, updateHint],
  )

  const moveScrub = useCallback(
    (clientX: number) => {
      if (!scrubbing.current) return
      const f = fractionFromX(clientX)
      updateHint(f)
      paint(f)
    },
    [fractionFromX, paint, updateHint],
  )

  const endScrub = useCallback(
    (clientX: number) => {
      if (!scrubbing.current) return
      const f = fractionFromX(clientX)
      scrubbing.current = false
      setActive(false)
      onScrubbingChange?.(false)
      setHint(null)
      lastHintSecRef.current = -1
      paint(f)
      const v = videoRef.current
      if (v && v.duration > 0) v.currentTime = f * v.duration
    },
    [fractionFromX, onScrubbingChange, paint, videoRef],
  )

  /* ── Géométrie des segments (pixels exacts, comme le natif) ──────────── */
  const segBoxes = segs
    ? segs.map((ch, i) => {
        const end = segs[i + 1]?.fraction ?? 1
        const span = end - ch.fraction
        return {
          span,
          gap: i > 0 ? GAP : 0,
          px: trackWidth > 0 ? Math.max(1, span * trackWidth - (i > 0 ? GAP : 0)) : null,
        }
      })
    : null

  /* ── Rendu ───────────────────────────────────────────────────────────── */
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
      onTouchStart={(e) => startScrub(e.touches[0].clientX)}
      onTouchMove={(e) => moveScrub(e.touches[0].clientX)}
      onTouchEnd={(e) => endScrub(e.changedTouches[0].clientX)}
      onMouseDown={(e) => startScrub(e.clientX)}
      onMouseMove={(e) => moveScrub(e.clientX)}
      onMouseUp={(e) => endScrub(e.clientX)}
      onMouseLeave={(e) => endScrub(e.clientX)}
    >
      {/* Étiquette « chapitre · minutage » — au ras de la pastille. */}
      {hint && (
        <div
          ref={hintRef}
          className="absolute left-0 pointer-events-none rounded-full whitespace-nowrap overflow-hidden text-ellipsis"
          style={{
            bottom: 14,
            opacity: 0,
            maxWidth: '80%',
            padding: '6px 11px',
            background: 'rgba(0,0,0,0.72)',
            border: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <span className="text-white text-[12px] font-semibold">
            {hint.label ? `${hint.label} · ` : ''}
            <span style={{ color: '#d6d3d1', fontWeight: 500 }}>{hint.time}</span>
          </span>
        </div>
      )}

      {/* Piste : segmentée s'il y a des chapitres, continue sinon. */}
      <div
        ref={trackRef}
        className="flex"
        style={{ height: active ? TRACK_ACTIVE : TRACK_IDLE, transition: 'height 140ms' }}
      >
        {segBoxes ? (
          segBoxes.map((s, i) => (
            <div
              key={i}
              className="relative rounded-[3px] overflow-hidden"
              style={{
                marginLeft: s.gap,
                height: '100%',
                backgroundColor: 'rgba(255,255,255,0.35)',
                ...(s.px != null ? { width: s.px } : { flex: s.span }),
              }}
            >
              <div
                ref={(el) => {
                  fillRefs.current[i] = el
                }}
                className="absolute inset-y-0 left-0 bg-white"
                style={{ width: '0%' }}
              />
            </div>
          ))
        ) : (
          <div
            className="relative flex-1 rounded-[3px] overflow-hidden"
            style={{ height: '100%', backgroundColor: 'rgba(255,255,255,0.35)' }}
          >
            <div
              ref={(el) => {
                fillRefs.current[0] = el
              }}
              className="absolute inset-y-0 left-0 bg-white"
              style={{ width: '0%' }}
            />
          </div>
        )}
      </div>

      {/* Pastille — visible seulement pendant le glissement. */}
      <div
        ref={thumbRef}
        className="absolute rounded-full bg-white pointer-events-none"
        style={{
          left: -THUMB / 2,
          bottom: TRACK_ACTIVE / 2 - THUMB / 2,
          width: THUMB,
          height: THUMB,
          opacity: active ? 1 : 0,
          boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
          transition: 'opacity 120ms',
        }}
      />
    </div>
  )
})

export default VideoProgressBar
