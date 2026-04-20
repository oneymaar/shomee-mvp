'use client'

import { useRef, useEffect } from 'react'
import Image from 'next/image'
import type { Property } from '@/lib/types'
import VideoProgressBar from './VideoProgressBar'

interface VideoCardProps {
  property: Property
  isActive: boolean
  muted: boolean
}

export default function VideoCard({ property, isActive, muted }: VideoCardProps) {
  const videoRef      = useRef<HTMLVideoElement>(null)
  const tapStartRef   = useRef<{ x: number; y: number; t: number } | null>(null)
  const flashLabelRef = useRef<HTMLDivElement>(null)
  const flashTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasVideo      = Boolean(property.videoUrl)

  const flashChapter = (label: string) => {
    const el = flashLabelRef.current
    if (!el) return
    el.textContent = label
    el.style.opacity = '1'
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => {
      if (flashLabelRef.current) flashLabelRef.current.style.opacity = '0'
    }, 1000)
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
    }
  }, [isActive])

  /* ── Muted state ── */
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  /* ── Chapter tap navigation ── */
  const onTapStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    tapStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }

  const onTapEnd = (e: React.TouchEvent) => {
    const start = tapStartRef.current
    tapStartRef.current = null
    if (!start) return

    const touch = e.changedTouches[0]
    const dx = Math.abs(touch.clientX - start.x)
    const dy = Math.abs(touch.clientY - start.y)
    const dt = Date.now() - start.t

    // Ignore swipes (scroll, drag) — only process short taps
    if (dx > 12 || dy > 20 || dt > 280) return

    const video = videoRef.current
    if (!video || !video.duration) return

    const rect   = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const isRight = touch.clientX > rect.left + rect.width / 2
    const chapters = property.chapters
    const f = video.currentTime / video.duration

    if (chapters && chapters.length >= 2) {
      let idx = 0
      for (let i = 0; i < chapters.length; i++) {
        if (f >= chapters[i].fraction) idx = i
      }

      if (isRight) {
        const next = chapters[idx + 1]
        if (next) {
          video.currentTime = next.fraction * video.duration
          flashChapter(next.label)
        }
      } else {
        const chapterStart = chapters[idx].fraction * video.duration
        if (video.currentTime - chapterStart > 2) {
          video.currentTime = chapterStart
          flashChapter(chapters[idx].label)
        } else {
          const prev = chapters[idx - 1]
          video.currentTime = prev ? prev.fraction * video.duration : 0
          flashChapter(prev ? prev.label : chapters[0].label)
        }
      }
    } else {
      video.currentTime = isRight
        ? Math.min(video.duration, video.currentTime + 10)
        : Math.max(0, video.currentTime - 10)
    }
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

      {/* Tap zones — below UI overlays (z-[15]), above gradient (z-10) */}
      <div
        className="absolute inset-0 z-[15]"
        style={{ touchAction: 'pan-y' }}
        onTouchStart={onTapStart}
        onTouchEnd={onTapEnd}
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

      {/* Chapter flash label — appears on tap, fades out */}
      <div
        ref={flashLabelRef}
        className="absolute left-1/2 -translate-x-1/2 z-40 bg-black/85 backdrop-blur-sm text-white text-[11px] font-semibold px-3 py-1 rounded-full whitespace-nowrap border border-white/20 pointer-events-none"
        style={{ opacity: 0, bottom: 44, transition: 'opacity 0.2s' }}
      />

      {/* Progress bar */}
      <VideoProgressBar videoRef={videoRef} chapters={property.chapters} />
    </div>
  )
}
