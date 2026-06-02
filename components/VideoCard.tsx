'use client'

import { useRef, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import type { Property } from '@/lib/types'
import VideoProgressBar, { type VideoProgressBarHandle } from './VideoProgressBar'

interface VideoCardProps {
  property: Property
  isActive: boolean
  muted: boolean
}

type FeedChapter = { label: string; startSec: number }
type RawChapter = { label: string; startSec?: number; fraction?: number }

export default function VideoCard({ property, isActive, muted }: VideoCardProps) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const progressRef = useRef<VideoProgressBarHandle>(null)
  const holdTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isHeldRef      = useRef(false)
  const tapStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastChapterIdxRef = useRef<number>(-1)
  const chapterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [chapterLabel, setChapterLabel] = useState<string | null>(null)
  const hasVideo = Boolean(property.videoUrl)

  /** Normalise property.chapters into { label, startSec } regardless of which
   *  shape was stored (legacy fraction-based or AI startSec-based). */
  const normalizedChapters = useMemo<FeedChapter[]>(() => {
    if (!property.chapters || property.chapters.length === 0) return []
    const raw = property.chapters as unknown as RawChapter[]
    return raw
      .map((c) => ({
        label: c.label,
        startSec:
          typeof c.startSec === 'number'
            ? c.startSec
            : typeof c.fraction === 'number'
              ? c.fraction * (videoDuration || 1)
              : 0,
      }))
      .sort((a, b) => a.startSec - b.startSec)
  }, [property.chapters, videoDuration])

  /** Chapters projected to the {label, fraction} shape VideoProgressBar
   *  expects. Returns undefined until videoDuration is known so the bar
   *  falls back to a single segment in the meantime. */
  const fractionalChapters = useMemo(() => {
    if (!property.chapters || property.chapters.length === 0) return undefined
    const raw = property.chapters as unknown as RawChapter[]
    // Native fraction shape (mock data) — keep as-is.
    if (raw.every((c) => typeof c.fraction === 'number')) {
      return raw.map((c) => ({ label: c.label, fraction: c.fraction as number }))
    }
    // startSec-based — needs the video duration to compute a fraction.
    if (!videoDuration) return undefined
    return raw
      .map((c) => ({
        label: c.label,
        fraction:
          typeof c.fraction === 'number'
            ? c.fraction
            : typeof c.startSec === 'number'
              ? Math.min(1, Math.max(0, c.startSec / videoDuration))
              : 0,
      }))
      .sort((a, b) => a.fraction - b.fraction)
  }, [property.chapters, videoDuration])

  const showChapterLabel = (label: string) => {
    setChapterLabel(label)
    if (chapterTimerRef.current) clearTimeout(chapterTimerRef.current)
    chapterTimerRef.current = setTimeout(() => setChapterLabel(null), 2000)
  }

  /* ── Play / pause on active state ── */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isActive) {
      video.play().catch(() => {})
    } else {
      video.pause()
      video.currentTime = 0
      lastChapterIdxRef.current = -1
    }
  }, [isActive])

  /* ── Muted state ── */
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  /* ── Detect chapter transitions during playback ── */
  const onTimeUpdate = () => {
    if (!videoRef.current || normalizedChapters.length === 0) return
    const t = videoRef.current.currentTime
    let idx = 0
    for (let i = 0; i < normalizedChapters.length; i++) {
      if (normalizedChapters[i].startSec <= t) idx = i
    }
    if (idx !== lastChapterIdxRef.current) {
      lastChapterIdxRef.current = idx
      // Don't flash the label automatically on the very first chapter at t=0
      // — only on subsequent transitions.
      if (t > 0.5) showChapterLabel(normalizedChapters[idx].label)
    }
  }

  /* ── Hold-to-pause + chapter tap navigation ── */
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    tapStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
    holdTimerRef.current = setTimeout(() => {
      isHeldRef.current = true
      videoRef.current?.pause()
    }, 300)
  }

  const releaseHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (isHeldRef.current) {
      isHeldRef.current = false
      if (isActive) videoRef.current?.play().catch(() => {})
      return true
    }
    return false
  }

  const handleTap = (clientX: number, rect: DOMRect) => {
    const video = videoRef.current
    if (!video) return

    const ratio = (clientX - rect.left) / rect.width

    if (ratio < 0.3 && normalizedChapters.length > 0) {
      // Tap left — previous chapter (or restart current if > 1.5s in)
      const t = video.currentTime
      let curIdx = 0
      for (let i = 0; i < normalizedChapters.length; i++) {
        if (normalizedChapters[i].startSec <= t) curIdx = i
      }
      const inChapterFor = t - normalizedChapters[curIdx].startSec
      let target: FeedChapter | null = null
      if (inChapterFor > 1.5) {
        target = normalizedChapters[curIdx]
      } else if (curIdx > 0) {
        target = normalizedChapters[curIdx - 1]
      }
      if (target) {
        video.currentTime = target.startSec
        showChapterLabel(target.label)
        progressRef.current?.flashLabel(target.label, video.duration ? target.startSec / video.duration : 0)
      }
    } else if (ratio > 0.7 && normalizedChapters.length > 0) {
      // Tap right — next chapter
      const t = video.currentTime
      const next = normalizedChapters.find((c) => c.startSec > t + 0.5)
      if (next) {
        video.currentTime = next.startSec
        showChapterLabel(next.label)
        progressRef.current?.flashLabel(next.label, video.duration ? next.startSec / video.duration : 0)
      }
    } else {
      // Center zone — play / pause
      if (video.paused) video.play().catch(() => {})
      else video.pause()
    }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (releaseHold()) return

    const start = tapStartRef.current
    tapStartRef.current = null
    if (!start) return

    const touch = e.changedTouches[0]
    const dx = Math.abs(touch.clientX - start.x)
    const dy = Math.abs(touch.clientY - start.y)
    const dt = Date.now() - start.t
    if (dx > 12 || dy > 20 || dt > 280) return

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    handleTap(touch.clientX, rect)
  }

  const onMouseClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    handleTap(e.clientX, rect)
  }

  return (
    <div className="absolute inset-0">
      {/* Gradient overlay */}
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.60) 0%, transparent 28%, transparent 50%, rgba(0,0,0,0.82) 100%)',
        }}
      />

      {/* Tap zones */}
      <div
        className="absolute inset-0 z-[15] select-none"
        style={{ touchAction: 'pan-y', WebkitTapHighlightColor: 'transparent', userSelect: 'none' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={releaseHold}
        onClick={onMouseClick}
      />

      {/* Video */}
      {hasVideo && (
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          src={property.videoUrl}
          loop
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={onTimeUpdate}
          onError={(e) => {
            ;(e.currentTarget as HTMLVideoElement).style.visibility = 'hidden'
          }}
        />
      )}

      {/* Fallback image */}
      <Image
        src={property.imageUrlFallback}
        alt={property.title}
        fill
        className="object-cover"
        style={{ zIndex: -1 }}
        priority={isActive}
        sizes="430px"
      />

      {/* Chapter badge overlay (top, fades in/out) */}
      {chapterLabel && (
        <div
          // eslint-disable-next-line react-hooks/purity
          key={chapterLabel + Date.now()}
          className="absolute top-3 left-0 right-0 z-[16] flex justify-center pointer-events-none animate-fade-in-out"
        >
          <div className="bg-black/65 text-white text-[13px] font-medium px-3.5 py-1 rounded-full">
            {chapterLabel}
          </div>
        </div>
      )}

      {/* Progress bar */}
      <VideoProgressBar ref={progressRef} videoRef={videoRef} chapters={fractionalChapters} />
    </div>
  )
}
