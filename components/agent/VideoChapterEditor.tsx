'use client'

import { useRef, useEffect, useState, useCallback } from 'react'

export type Chapter = { id: string; label: string; startSec: number }

interface VideoChapterEditorProps {
  videoUrl?: string
  duration: number
  chapters: Chapter[]
  onChange: (chapters: Chapter[]) => void
  videoRef?: React.RefObject<HTMLVideoElement | null>
}

const WINDOW_SEC = 13
const DEL_Y = 10
const TRACK_Y = 26
const TRACK_H = 44
const ROW_OFFSET = 26
const LABEL_Y1 = TRACK_Y + TRACK_H + 16
const LABEL_Y2 = LABEL_Y1 + ROW_OFFSET
const TS_Y1 = TRACK_Y + TRACK_H + 27
const TS_Y2 = TS_Y1 + ROW_OFFSET
const CANVAS_H = 135
const LABEL_GAP = 6

export default function VideoChapterEditor({
  duration,
  chapters,
  onChange,
  videoRef,
}: VideoChapterEditorProps) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLInputElement>(null)
  const [curSec, setCurSec] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editorPos, setEditorPos] = useState({ x: 0, y: 0 })
  const [editorVal, setEditorVal] = useState('')
  const [nextId, setNextId] = useState(100)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)

  const pxPerSec = useRef(28)
  const W = useRef(0)
  const isDrag = useRef(false)
  const dStartX = useRef(0)
  const dStartSec = useRef(0)
  const dragMarkerId = useRef<string | null>(null)
  const dmStartX = useRef(0)
  const dmStartSec = useRef(0)
  const curSecRef = useRef(0)

  const fmtF = (s: number) => {
    s = Math.max(0, Math.min(duration || 1, s))
    const m = Math.floor(s / 60)
    const sec = (s % 60).toFixed(1)
    return m + ':' + (parseFloat(sec) < 10 ? '0' : '') + sec
  }
  const fmtS = (s: number) => {
    s = Math.max(0, Math.min(duration || 1, s))
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
  }

  const getRoom = useCallback((sec: number) => {
    const sorted = [...chapters].sort((a, b) => a.startSec - b.startSec)
    let r = sorted[0]?.label ?? ''
    for (const c of sorted) if (c.startSec <= sec) r = c.label
    return r
  }, [chapters])

  const fadeAlpha = (x: number, cx: number) => {
    const dist = Math.abs(x - cx)
    if (dist < 14) return 0
    if (dist < 36) return (dist - 14) / 22
    return 1
  }

  const measureLabel = (ctx: CanvasRenderingContext2D, text: string) => {
    ctx.font = '11px system-ui, sans-serif'
    return ctx.measureText(text).width
  }

  const computeLabelRows = (
    ctx: CanvasRenderingContext2D,
    sorted: Chapter[],
    secToX: (s: number) => number
  ): Record<string, number> => {
    const rows: Record<string, number> = {}
    const rightEdge = [-9999, -9999]
    sorted.forEach(ch => {
      const x = secToX(ch.startSec)
      const w = measureLabel(ctx, ch.label)
      const left = x - w / 2
      const right = x + w / 2
      if (left - rightEdge[0] >= LABEL_GAP) {
        rows[ch.id] = 0; rightEdge[0] = right
      } else if (left - rightEdge[1] >= LABEL_GAP) {
        rows[ch.id] = 1; rightEdge[1] = right
      } else {
        const row = left - rightEdge[0] >= left - rightEdge[1] ? 0 : 1
        rows[ch.id] = row; rightEdge[row] = right
      }
    })
    return rows
  }

  const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    if (w <= 0 || h <= 0) return
    r = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h)
    ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r); ctx.closePath()
  }

  const draw = useCallback((sec: number) => {
    const cv = cvRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.save()
    ctx.scale(dpr, dpr)

    const cxPx = W.current / 2
    const pps = pxPerSec.current
    const secToX = (s: number) => cxPx + (s - sec) * pps

    const trackBg = '#f4f3f0'
    const borderCol = 'rgba(0,0,0,0.1)'
    const mutedColor = 'rgba(0,0,0,0.3)'
    const textColor = 'rgba(0,0,0,0.85)'
    const bgSolid = 'rgba(255,255,255,1)'
    const bgTrans = 'rgba(255,255,255,0)'

    const trackLeft = secToX(0)
    const trackRight = secToX(duration)
    const clampedLeft = Math.max(0, trackLeft)
    const clampedRight = Math.min(W.current, trackRight)
    const trackWidth = clampedRight - clampedLeft
    if (trackWidth <= 0) { ctx.restore(); return }

    // Track
    ctx.fillStyle = trackBg
    roundRect(ctx, clampedLeft, TRACK_Y, trackWidth, TRACK_H, 8); ctx.fill()
    ctx.strokeStyle = borderCol; ctx.lineWidth = 0.5
    roundRect(ctx, clampedLeft, TRACK_Y, trackWidth, TRACK_H, 8); ctx.stroke()

    // Ticks clipped
    ctx.save()
    roundRect(ctx, clampedLeft, TRACK_Y, trackWidth, TRACK_H, 8); ctx.clip()
    for (let s = 0; s <= duration; s += 0.5) {
      const x = secToX(s)
      if (x < clampedLeft || x > clampedRight) continue
      const isMajor = Number.isInteger(s) && s % 5 === 0
      ctx.strokeStyle = isMajor ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.07)'
      ctx.lineWidth = isMajor ? 1.5 : 0.5
      ctx.beginPath(); ctx.moveTo(x, TRACK_Y); ctx.lineTo(x, TRACK_Y + TRACK_H); ctx.stroke()
    }
    ctx.restore()

    // Chapters
    const sorted = [...chapters].sort((a, b) => a.startSec - b.startSec)
    const labelRows = computeLabelRows(ctx, sorted, secToX)
    const chapterXs = chapters.map(ch => secToX(ch.startSec))

    sorted.forEach(ch => {
      const x = secToX(ch.startSec)
      if (x < clampedLeft - 40 || x > clampedRight + 40) return

      ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x, TRACK_Y); ctx.lineTo(x, TRACK_Y + TRACK_H); ctx.stroke()
      ctx.fillStyle = '#7c3aed'
      ctx.beginPath(); ctx.arc(x, TRACK_Y + 5, 4, 0, Math.PI * 2); ctx.fill()

      const delA = fadeAlpha(x, cxPx)
      if (delA > 0) {
        ctx.globalAlpha = delA
        ctx.fillStyle = '#e8e8e8'
        ctx.beginPath(); ctx.arc(x, DEL_Y, 8, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.5
        ctx.beginPath(); ctx.arc(x, DEL_Y, 8, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = mutedColor; ctx.font = '11px system-ui'; ctx.textAlign = 'center'
        ctx.fillText('×', x, DEL_Y + 4)
        ctx.globalAlpha = 1
      }

      if (editingId !== ch.id) {
        const row = labelRows[ch.id] ?? 0
        ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = textColor; ctx.textAlign = 'center'
        ctx.fillText(ch.label, x, row === 0 ? LABEL_Y1 : LABEL_Y2)
        ctx.font = '10px system-ui'; ctx.fillStyle = '#7c3aed'
        ctx.fillText(fmtS(ch.startSec), x, row === 0 ? TS_Y1 : TS_Y2)
      }
    })

    // Tick labels every 5s
    for (let s = 0; s <= duration; s += 5) {
      const x = secToX(s)
      if (x < clampedLeft + 8 || x > clampedRight - 8) continue
      if (chapterXs.some(cx2 => Math.abs(x - cx2) < 22)) continue
      const alpha = fadeAlpha(x, cxPx)
      if (alpha > 0) {
        ctx.globalAlpha = alpha
        ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = mutedColor; ctx.textAlign = 'center'
        ctx.fillText(fmtS(s), x, DEL_Y + 4)
        ctx.globalAlpha = 1
      }
    }

    // Playhead
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(cxPx, TRACK_Y); ctx.lineTo(cxPx, TRACK_Y + TRACK_H); ctx.stroke()
    ctx.font = '500 11px system-ui, sans-serif'; ctx.fillStyle = '#ef4444'; ctx.textAlign = 'center'
    ctx.fillText(fmtF(sec), cxPx, DEL_Y + 4)

    // Fades
    const fadeW = 44
    if (sec > 0.05) {
      const gl = ctx.createLinearGradient(0, 0, fadeW, 0)
      gl.addColorStop(0, bgSolid); gl.addColorStop(1, bgTrans)
      ctx.fillStyle = gl; ctx.fillRect(0, TRACK_Y, fadeW, TRACK_H)
    }
    if (sec < duration - 0.05) {
      const gr = ctx.createLinearGradient(W.current - fadeW, 0, W.current, 0)
      gr.addColorStop(0, bgTrans); gr.addColorStop(1, bgSolid)
      ctx.fillStyle = gr; ctx.fillRect(W.current - fadeW, TRACK_Y, fadeW, TRACK_H)
    }

    // Arrows
    ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'
    if (sec > 0.05) { ctx.fillStyle = mutedColor; ctx.fillText('‹', 16, TRACK_Y + TRACK_H / 2 + 7) }
    if (sec < duration - 0.05) { ctx.fillStyle = mutedColor; ctx.fillText('›', W.current - 16, TRACK_Y + TRACK_H / 2 + 7) }

    ctx.restore()
  }, [chapters, duration, editingId])

  const setup = useCallback(() => {
    const cv = cvRef.current
    if (!cv) return
    W.current = cv.parentElement?.clientWidth ?? 380
    pxPerSec.current = W.current / WINDOW_SEC
    const dpr = window.devicePixelRatio || 1
    cv.width = W.current * dpr
    cv.height = CANVAS_H * dpr
    cv.style.height = CANVAS_H + 'px'
  }, [])

  useEffect(() => {
    setup()
    draw(curSecRef.current)
    const handleResize = () => { setup(); draw(curSecRef.current) }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [setup, draw])

  useEffect(() => {
    draw(curSecRef.current)
  }, [chapters, draw])

  // Video → timeline : drive the playhead with requestAnimationFrame while
  // the video is playing. `timeupdate` only fires ~4×/sec which makes the
  // canvas jerk; rAF gives us 60fps smoothness, matching the native video
  // progress bar.
  useEffect(() => {
    const video = videoRef?.current
    if (!video) return

    let rafId: number | null = null
    let lastT = -1

    const applyTime = (t: number) => {
      curSecRef.current = t
      setCurSec(t)
      draw(t)
    }

    const tick = () => {
      const t = video.currentTime
      if (Math.abs(t - lastT) > 0.0005) {
        lastT = t
        applyTime(t)
      }
      rafId = requestAnimationFrame(tick)
    }

    const startLoop = () => {
      if (rafId === null) rafId = requestAnimationFrame(tick)
    }
    const stopLoop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      // Final sync to capture the resting position.
      applyTime(video.currentTime)
    }
    const onSeeked = () => {
      if (rafId === null) applyTime(video.currentTime)
    }

    video.addEventListener('play', startLoop)
    video.addEventListener('playing', startLoop)
    video.addEventListener('pause', stopLoop)
    video.addEventListener('ended', stopLoop)
    video.addEventListener('seeked', onSeeked)

    if (!video.paused) startLoop()

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      video.removeEventListener('play', startLoop)
      video.removeEventListener('playing', startLoop)
      video.removeEventListener('pause', stopLoop)
      video.removeEventListener('ended', stopLoop)
      video.removeEventListener('seeked', onSeeked)
    }
  }, [videoRef, draw])

  const updateCurSec = (s: number) => {
    const clamped = Math.max(0, Math.min(duration, s))
    curSecRef.current = clamped
    setCurSec(clamped)
    if (videoRef?.current) videoRef.current.currentTime = clamped
    draw(clamped)
  }

  const hitTest = (ex: number, ey: number) => {
    const cxPx = W.current / 2
    for (const ch of chapters) {
      const x = cxPx + (ch.startSec - curSecRef.current) * pxPerSec.current
      if (Math.abs(ex - x) < 10 && ey >= DEL_Y - 10 && ey <= DEL_Y + 10) return { ch, zone: 'delete' }
      if (Math.abs(ex - x) < 12 && ey >= TRACK_Y && ey <= TRACK_Y + TRACK_H) return { ch, zone: 'marker' }
      if (Math.abs(ex - x) < 44 && ey >= TRACK_Y + TRACK_H + 2 && ey <= TRACK_Y + TRACK_H + 60) return { ch, zone: 'label' }
    }
    return null
  }

  const openEditor = (ch: Chapter) => {
    const cv = cvRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const cxPx = W.current / 2
    const x = cxPx + (ch.startSec - curSecRef.current) * pxPerSec.current
    const sorted = [...chapters].sort((a, b) => a.startSec - b.startSec)
    const rows = computeLabelRows(ctx, sorted, s => cxPx + (s - curSecRef.current) * pxPerSec.current)
    const row = rows[ch.id] ?? 0
    setEditorPos({ x, y: TRACK_Y + TRACK_H + 2 + (row === 0 ? 0 : ROW_OFFSET) })
    setEditorVal(ch.label)
    setEditingId(ch.id)
    setTimeout(() => {
      const el = editorRef.current
      if (!el) return
      el.focus()
      el.select()
      // Make sure the input stays visible above the on-screen keyboard.
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch {}
    }, 50)
  }

  // After adding a chapter, the new chapter only exists in `chapters` once
  // the parent re-renders. This effect picks up that re-render and opens the
  // editor on the freshly added marker.
  useEffect(() => {
    if (!pendingFocusId) return
    const ch = chapters.find((c) => c.id === pendingFocusId)
    if (ch) {
      openEditor(ch)
      setPendingFocusId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, pendingFocusId])

  const commitEdit = () => {
    if (editingId) {
      const updated = chapters.map(c => c.id === editingId && editorVal.trim() ? { ...c, label: editorVal.trim() } : c)
      onChange(updated)
    }
    setEditingId(null)
  }

  // Mouse events
  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return

    const onMouseDown = (e: MouseEvent) => {
      if (editingId) return
      const rect = cv.getBoundingClientRect()
      const ex = e.clientX - rect.left, ey = e.clientY - rect.top
      const hit = hitTest(ex, ey)
      if (hit) {
        if (hit.zone === 'delete') {
          onChange(chapters.filter(c => c.id !== hit.ch.id))
        } else if (hit.zone === 'label') {
          openEditor(hit.ch)
        } else {
          dragMarkerId.current = hit.ch.id
          dmStartX.current = e.clientX
          dmStartSec.current = hit.ch.startSec
          e.preventDefault()
        }
      } else {
        isDrag.current = true
        dStartX.current = e.clientX
        dStartSec.current = curSecRef.current
        e.preventDefault()
      }
    }
    const onMouseMove = (e: MouseEvent) => {
      if (dragMarkerId.current) {
        const ch = chapters.find(c => c.id === dragMarkerId.current)
        if (ch) {
          const newSec = parseFloat(Math.max(0, Math.min(duration, dmStartSec.current + (e.clientX - dmStartX.current) / pxPerSec.current)).toFixed(2))
          onChange(chapters.map(c => c.id === dragMarkerId.current ? { ...c, startSec: newSec } : c))
        }
      } else if (isDrag.current) {
        updateCurSec(dStartSec.current - (e.clientX - dStartX.current) / pxPerSec.current)
      }
    }
    const onMouseUp = () => { dragMarkerId.current = null; isDrag.current = false }

    const onTouchStart = (e: TouchEvent) => {
      if (editingId) return
      const rect = cv.getBoundingClientRect()
      const ex = e.touches[0].clientX - rect.left, ey = e.touches[0].clientY - rect.top
      const hit = hitTest(ex, ey)
      if (hit) {
        if (hit.zone === 'delete') onChange(chapters.filter(c => c.id !== hit.ch.id))
        else if (hit.zone === 'label') openEditor(hit.ch)
        else { dragMarkerId.current = hit.ch.id; dmStartX.current = e.touches[0].clientX; dmStartSec.current = hit.ch.startSec }
      } else { dStartX.current = e.touches[0].clientX; dStartSec.current = curSecRef.current }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (dragMarkerId.current) {
        const ch = chapters.find(c => c.id === dragMarkerId.current)
        if (ch) {
          const newSec = parseFloat(Math.max(0, Math.min(duration, dmStartSec.current + (e.touches[0].clientX - dmStartX.current) / pxPerSec.current)).toFixed(2))
          onChange(chapters.map(c => c.id === dragMarkerId.current ? { ...c, startSec: newSec } : c))
        }
      } else {
        updateCurSec(dStartSec.current - (e.touches[0].clientX - dStartX.current) / pxPerSec.current)
      }
    }
    const onTouchEnd = () => { dragMarkerId.current = null }

    cv.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    cv.addEventListener('touchstart', onTouchStart, { passive: true })
    cv.addEventListener('touchmove', onTouchMove, { passive: true })
    cv.addEventListener('touchend', onTouchEnd)

    return () => {
      cv.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      cv.removeEventListener('touchstart', onTouchStart)
      cv.removeEventListener('touchmove', onTouchMove)
      cv.removeEventListener('touchend', onTouchEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, duration, editingId, onChange])

  const addChapter = () => {
    const id = String(nextId)
    const newChapter: Chapter = {
      id,
      label: 'Nouvelle pièce',
      startSec: parseFloat(curSecRef.current.toFixed(2))
    }
    setNextId(n => n + 1)
    onChange([...chapters, newChapter])
    setPendingFocusId(id)
  }

  return (
    <div className="w-full">
      <div ref={containerRef} className="relative w-full">
        <canvas ref={cvRef} className="block w-full cursor-grab active:cursor-grabbing touch-pan-y" />
        {editingId && (
          <input
            ref={editorRef}
            value={editorVal}
            onChange={e => setEditorVal(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null) }}
            style={{ left: editorPos.x, top: editorPos.y }}
            className="absolute -translate-x-1/2 w-[90px] text-center text-[11px] bg-white border border-violet-500 rounded-md px-1.5 py-0.5 outline-none shadow-md z-10"
          />
        )}
      </div>
      <div className="flex justify-center mt-2.5">
        <button
          onClick={addChapter}
          className="flex items-center gap-1.5 text-[13px] text-gray-500 border border-dashed border-gray-300 rounded-lg px-4 py-1.5 hover:bg-gray-50"
        >
          <span className="text-base">+</span> Ajouter une pièce
        </button>
      </div>
      <p className="text-[11px] text-gray-400 text-center mt-2 leading-relaxed px-2">
        Les marqueurs de pièces aident les acquéreurs à se repérer dans votre vidéo.<br />
        Déplacez-les, renommez-les, ajoutez-en ou supprimez-en selon vos besoins.
      </p>
    </div>
  )
}
