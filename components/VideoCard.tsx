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
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasVideo = Boolean(property.videoUrl)

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

  /* ── Muted state (React prop unreliable on <video>, must be imperative) ── */
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  return (
    <div className="absolute inset-0">
      {/* Gradient overlay: dark top → transparent → dark bottom */}
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.60) 0%, transparent 28%, transparent 50%, rgba(0,0,0,0.82) 100%)',
        }}
      />

      {/* Video element */}
      {hasVideo && (
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          src={property.videoUrl}
          loop
          muted            // initial muted attr — then controlled imperatively
          playsInline
          preload="metadata"
          onError={(e) => {
            // Hide broken video, image fallback shows through
            ;(e.currentTarget as HTMLVideoElement).style.visibility = 'hidden'
          }}
        />
      )}

      {/* Fallback image — always rendered below the video */}
      <Image
        src={property.imageUrlFallback}
        alt={property.title}
        fill
        className="object-cover"
        style={{ zIndex: -1 }}
        priority={isActive}
        sizes="430px"
      />

      {/* Progress bar with chapter segments */}
      <VideoProgressBar videoRef={videoRef} chapters={property.chapters} />
    </div>
  )
}
