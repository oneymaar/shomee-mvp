'use client'

import { useRef, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { X, MapPin, Check, Heart, Share2, MessageCircle, Phone, CalendarPlus } from 'lucide-react'
import clsx from 'clsx'
import type { Property } from '@/lib/types'

/* ── DPE helpers ─────────────────────────────────────────────────────────── */
const DPE_GRADES = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const DPE_COLORS: Record<string, string> = {
  A: '#00b050', B: '#70ad47', C: '#c5e0b4',
  D: '#ffc000', E: '#ed7d31', F: '#c00000', G: '#7b2929',
}

function DpeMeter({ grade, label }: { grade: string; label: string }) {
  const idx = DPE_GRADES.indexOf(grade)
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/50 text-xs w-7">{label}</span>
      <div className="flex gap-0.5 flex-1">
        {DPE_GRADES.map((g, i) => (
          <div
            key={g}
            className="h-4 flex-1 rounded-sm flex items-center justify-center"
            style={{ backgroundColor: DPE_COLORS[g] + (i <= idx ? 'ff' : '28') }}
          >
            {i === idx && <span className="text-white font-black text-[9px]">{g}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Component ───────────────────────────────────────────────────────────── */
interface PropertyDetailSheetProps {
  property: Property | null
  open: boolean
  onClose: () => void
  isFavorite: boolean
  onToggleFavorite: () => void
}

export default function PropertyDetailSheet({
  property,
  open,
  onClose,
  isFavorite,
  onToggleFavorite,
}: PropertyDetailSheetProps) {
  const miniVideoRef = useRef<HTMLVideoElement>(null)

  // Start / stop mini video with the sheet
  useEffect(() => {
    const v = miniVideoRef.current
    if (!v) return
    if (open) {
      v.currentTime = 0
      v.play().catch(() => {})
    } else {
      v.pause()
    }
  }, [open, property?.id])

  if (!property) return null

  const fmtPrice = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)
  const fmtPpm = property.pricePerSqm
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.pricePerSqm)
    : null

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Dim backdrop — tapping closes */}
          <motion.div
            key="sheet-backdrop"
            className="absolute inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/*
            Sheet: positioned above the bottom nav (bottom-[60px]),
            height 88% of the card area so the video peeks slightly above it.
          */}
          <motion.div
            key="sheet-body"
            className="absolute bottom-[60px] left-0 right-0 z-50 flex flex-col bg-neutral-950 rounded-t-3xl overflow-hidden border-t border-white/10"
            style={{ height: '88%' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
          >
            {/* ── STICKY HEADER: handle + mini video ── */}
            <div className="shrink-0 bg-neutral-950">
              {/* Handle */}
              <div className="flex justify-center pt-2.5 pb-2">
                <div className="w-10 h-1 bg-white/25 rounded-full" />
              </div>

              {/* Mini video — 16:9, sticky at top of sheet */}
              <div className="relative mx-3 rounded-2xl overflow-hidden bg-neutral-900" style={{ aspectRatio: '16/9' }}>
                {property.videoUrl && (
                  <video
                    ref={miniVideoRef}
                    src={property.videoUrl}
                    className="w-full h-full object-cover"
                    loop
                    muted
                    playsInline
                    preload="metadata"
                  />
                )}
                <Image
                  src={property.imageUrlFallback}
                  alt={property.title}
                  fill
                  className={`object-cover ${property.videoUrl ? '-z-10' : ''}`}
                  sizes="400px"
                />

                {/* Close */}
                <button
                  onClick={onClose}
                  className="absolute top-2.5 right-2.5 w-7 h-7 bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center"
                >
                  <X size={13} className="text-white" />
                </button>

                {/* Arrondissement badge */}
                <div className="absolute bottom-2.5 left-2.5 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1">
                  <span className="text-white font-bold text-[11px] tracking-wide">
                    {property.arrondissement}
                  </span>
                </div>
              </div>

              {/* Quick info row */}
              <div className="flex items-center gap-2 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-base leading-tight truncate">{property.subtitle}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <MapPin size={11} className="text-white/40 shrink-0" />
                    <span className="text-white/50 text-xs truncate">{property.location} · {property.district}</span>
                  </div>
                </div>
                <span className="text-white font-black text-lg shrink-0">{fmtPrice} €</span>
              </div>

              {/* Thin separator */}
              <div className="h-px bg-white/10 mx-4" />
            </div>

            {/* ── SCROLLABLE CONTENT ── */}
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              <div className="px-4 py-4 flex flex-col gap-4">

                {/* Agent */}
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
                    <span className="text-white text-[10px] font-bold">{property.agentName.charAt(0)}</span>
                  </div>
                  <span className="text-white/70 text-sm">{property.agentName}</span>
                </div>

                {/* Price + m² */}
                <div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-white font-black text-2xl">{fmtPrice} €</span>
                    {fmtPpm && (
                      <span className="text-white/40 text-sm">soit {fmtPpm} € / m²</span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-2">
                    {[
                      { label: 'Surface', value: `${property.surface} m²` },
                      { label: 'Pièces', value: `${property.rooms}` },
                      ...(property.bedrooms !== undefined ? [{ label: 'Chambres', value: `${property.bedrooms}` }] : []),
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-center">
                        <p className="text-white/40 text-[10px]">{label}</p>
                        <p className="text-white font-bold text-sm mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Features */}
                {property.features && (
                  <div className="flex flex-wrap gap-1.5">
                    {property.features.map((f) => (
                      <span key={f} className="flex items-center gap-1 text-white/70 text-xs bg-white/8 border border-white/12 px-2.5 py-1 rounded-full">
                        <Check size={9} className="text-white/50" />
                        {f}
                      </span>
                    ))}
                  </div>
                )}

                {/* DPE + GES */}
                <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex flex-col gap-2">
                  <DpeMeter grade={property.dpe} label="DPE" />
                  {property.ges && <DpeMeter grade={property.ges} label="GES" />}
                </div>

                {/* Description */}
                <div>
                  <h3 className="text-white font-semibold text-sm mb-1.5">Description</h3>
                  <p className="text-white/60 text-sm leading-relaxed">{property.description}</p>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-2">
                  {property.tags.map((tag) => (
                    <span key={tag} className="text-white/70 text-xs bg-white/8 border border-white/12 px-3 py-1.5 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Padding for action bar */}
                <div className="h-4" />
              </div>
            </div>

            {/* ── STICKY ACTION BAR ── */}
            <div className="shrink-0 bg-neutral-950 border-t border-white/10 px-2 py-2">
              <div className="flex items-center gap-1">
                {[
                  { icon: MessageCircle, label: 'Message' },
                  { icon: Phone, label: 'Appeler' },
                  { icon: CalendarPlus, label: 'Visiter' },
                ].map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    className="flex flex-col items-center gap-0.5 flex-1 py-2 rounded-xl hover:bg-white/5 transition-colors"
                  >
                    <Icon size={19} strokeWidth={1.8} className="text-white" />
                    <span className="text-white/60 text-[10px]">{label}</span>
                  </button>
                ))}
                <div className="w-px h-8 bg-white/10" />
                <button
                  onClick={onToggleFavorite}
                  className="flex flex-col items-center gap-0.5 px-3.5 py-2"
                >
                  <Heart
                    size={19}
                    strokeWidth={1.8}
                    className={clsx(isFavorite ? 'fill-red-500 text-red-500' : 'text-white')}
                  />
                  <span className="text-white/60 text-[10px]">
                    {(property.likeCount ?? 0) + (isFavorite ? 1 : 0)}
                  </span>
                </button>
                <button className="flex flex-col items-center gap-0.5 px-3.5 py-2">
                  <Share2 size={19} strokeWidth={1.8} className="text-white" />
                  <span className="text-white/60 text-[10px]">{property.shareCount}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
