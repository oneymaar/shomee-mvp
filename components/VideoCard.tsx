'use client'

import { useRef, useEffect } from 'react'
import Image from 'next/image'
import type { Property } from '@/lib/types'
import VideoProgressBar, { type VideoProgressBarHandle } from './VideoProgressBar'

interface VideoCardProps {
  property: Property
  isActive: boolean
  muted: boolean
}

export default function VideoCard({ property, isActive, muted }: VideoCardProps) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const tapStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const progressRef = useRef<VideoProgressBarHandle>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isHeldRef   = useRef(false)
  const hasVideo    = Boolean(property.videoUrl)

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

  /* ── Hold to pause + chapter tap navigation ── */
  const onTapStart = (e: React.TouchEvent) => {
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

  const onTapEnd = (e: React.TouchEvent) => {
    if (releaseHold()) return

    const start = tapStartRef.current
    tapStartRef.current = null
    if (!start) return

    const touch = e.changedTouches[0]
    const dx = Math.abs(touch.clientX - start.x)
    const dy = Math.abs(touch.clientY - start.y)
    const dt = Date.now() - start.t

    if (dx > 12 || dy > 20 || dt > 280) return

    const video = videoRef.current
    if (!video || !video.duration) return

    const rect    = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const isRight = touch.clientX > rect.left + rect.width / 2
    const chapters = property.chapters
    const f = video.currentTime / video.duration

    if (chapters && chapters.length >= 2) {
      let idx = 0
      for (let i = 0; i < chapters.length; i++) {
        if (f >= chapters[i].fraction) idx = i
      }

      const seek = (t: number) => {
        if ('fastSeek' in video) video.fastSeek(t)
        else video.currentTime = t
      }

      if (isRight) {
        const next = chapters[idx + 1]
        if (next) {
          seek(next.fraction * video.duration)
          progressRef.current?.flashLabel(next.label, next.fraction)
        }
      } else {
        const chapterStart = chapters[idx].fraction * video.duration
        if (video.currentTime - chapterStart > 2) {
          seek(chapterStart)
          progressRef.current?.flashLabel(chapters[idx].label, chapters[idx].fraction)
        } else {
          const prev = chapters[idx - 1]
          const target = prev ?? chapters[0]
          seek(target.fraction * video.duration)
          progressRef.current?.flashLabel(target.label, target.fraction)
        }
      }
    } else {
      const t = isRight
        ? Math.min(video.duration, video.currentTime + 10)
        : Math.max(0, video.currentTime - 10)
      if ('fastSeek' in video) video.fastSeek(t)
      else video.currentTime = t
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

      {/* Tap zones */}
      <div
        className="absolute inset-0 z-[15] select-none"
        style={{ touchAction: 'pan-y', WebkitTapHighlightColor: 'transparent', userSelect: 'none' }}
        onTouchStart={onTapStart}
        onTouchEnd={onTapEnd}
        onTouchCancel={releaseHold}
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

      {/* Progress bar */}
      <VideoProgressBar ref={progressRef} videoRef={videoRef} chapters={property.chapters} />
    </div>
  )
}
