'use client'

import { use, useState } from 'react'
import { notFound, useRouter } from 'next/navigation'
import Image from 'next/image'
import { ArrowLeft, Heart, Share2, MessageCircle, Phone, CalendarPlus, MapPin, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import MobileFrame from '@/components/MobileFrame'
import { properties } from '@/lib/mockData'
import { useShomeeStore } from '@/lib/store'
import clsx from 'clsx'

const DPE_LABELS: Record<string, string> = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G' }
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
            className="h-4 flex-1 rounded-sm relative flex items-center justify-center"
            style={{ backgroundColor: DPE_COLORS[g] + (i <= idx ? 'ff' : '30') }}
          >
            {i === idx && (
              <span className="text-white font-black text-[9px]">{g}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const MEDIA_TABS = ['Photos', 'Plan', 'Visite virtuelle'] as const

interface Props {
  params: Promise<{ id: string }>
}

export default function PropertyDetailPage({ params }: Props) {
  const { id } = use(params)
  const router = useRouter()
  const { favorites, toggleFavorite } = useShomeeStore()
  const [activeTab, setActiveTab] = useState<typeof MEDIA_TABS[number]>('Photos')

  const property = properties.find((p) => p.id === id)
  if (!property) notFound()

  const isFavorite = favorites.includes(property.id)

  const formattedPrice = new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(property.price)

  const formattedPpm = property.pricePerSqm
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.pricePerSqm)
    : null

  return (
    <MobileFrame>
      <div className="h-full overflow-y-auto scrollbar-hide">
        {/* Gallery */}
        <div className="relative bg-neutral-900" style={{ height: '52vw', maxHeight: 280, minHeight: 200 }}>
          <div className="flex h-full overflow-x-auto scrollbar-hide snap-x snap-mandatory">
            {property.gallery.map((img, i) => (
              <div key={i} className="relative shrink-0 w-full h-full snap-center">
                <Image
                  src={img}
                  alt={`${property.title} - ${i + 1}`}
                  fill
                  className="object-cover"
                  sizes="430px"
                  priority={i === 0}
                />
              </div>
            ))}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black to-transparent pointer-events-none" />
        </div>

        {/* Media tabs */}
        <div className="flex border-b border-white/10 bg-black">
          {MEDIA_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'flex-1 py-2.5 text-xs font-medium transition-all',
                activeTab === tab
                  ? 'text-white border-b-2 border-white -mb-px'
                  : 'text-white/65',
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="bg-black px-4 pt-4 pb-28">
          {/* Agency / agent */}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
              <span className="text-white text-[10px] font-bold">{property.agentName.charAt(0)}</span>
            </div>
            <span className="text-white font-semibold text-sm">{property.agentName}</span>
          </div>

          {/* Price */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-white font-black text-3xl">{formattedPrice} €</span>
            {formattedPpm && (
              <span className="text-white/65 text-sm">soit {formattedPpm} € / m²</span>
            )}
          </div>

          {/* Location */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <MapPin size={12} className="text-white/65 shrink-0" />
            <span className="text-white/50 text-sm">{property.location} · {property.district}</span>
          </div>

          {/* Feature chips */}
          {property.features && property.features.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {property.features.map((f) => (
                <span key={f} className="flex items-center gap-1 text-white/70 text-xs bg-white/8 border border-white/12 px-2.5 py-1 rounded-full">
                  <Check size={10} className="text-white/50" />
                  {f}
                </span>
              ))}
            </div>
          )}

          {/* DPE + GES */}
          <div className="mt-4 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex flex-col gap-2">
            <DpeMeter grade={property.dpe} label="DPE" />
            {property.ges && <DpeMeter grade={property.ges} label="GES" />}
          </div>

          {/* Divider */}
          <div className="h-px bg-white/10 my-4" />

          {/* Description */}
          <h2 className="text-white font-semibold text-base mb-2">Description</h2>
          <p className="text-white/65 text-sm leading-relaxed">{property.description}</p>

          {/* Divider */}
          <div className="h-px bg-white/10 my-4" />

          {/* Characteristics */}
          <h2 className="text-white font-semibold text-base mb-3">Caractéristiques</h2>
          <div className="divide-y divide-white/8">
            {[
              { label: "Type de bien", value: "Appartement" },
              { label: "Surface carrez", value: `${property.surface} m²` },
              { label: "Pièces", value: `${property.rooms}` },
              { label: "Chambres", value: `${property.bedrooms ?? '-'}` },
              { label: "DPE", value: property.dpe },
              ...(property.ges ? [{ label: "GES", value: property.ges }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2.5">
                <span className="text-white/50 text-sm">{label}</span>
                <span className="text-white text-sm font-medium">{value}</span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="h-px bg-white/10 my-4" />

          {/* Market */}
          <h2 className="text-white font-semibold text-base mb-3">Marché</h2>
          <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
            <div className="text-white font-black text-2xl">{formattedPrice} €</div>
            {formattedPpm && (
              <div className="text-white/65 text-xs mt-0.5">{formattedPpm} € / m²</div>
            )}
            <div className="h-px bg-white/10 my-3" />
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between">
                <span className="text-white/50 text-xs">Prix moyen secteur</span>
                <span className="text-white text-xs font-medium">
                  {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format((property.pricePerSqm ?? 12000) * 1.15)} € / m²
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50 text-xs">Évolution 10 ans</span>
                <span className="text-emerald-400 text-xs font-medium">+27%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Back button */}
      <motion.button
        onClick={() => router.back()}
        className="absolute top-4 left-4 z-30 w-9 h-9 rounded-full bg-black/70 backdrop-blur-sm flex items-center justify-center border border-white/20"
        whileTap={{ scale: 0.9 }}
      >
        <ArrowLeft size={18} className="text-white" />
      </motion.button>

      {/* Top right: share + favorite */}
      <div className="absolute top-4 right-4 z-30 flex gap-2">
        <motion.button
          className="w-9 h-9 rounded-full bg-black/70 backdrop-blur-sm flex items-center justify-center border border-white/20"
          whileTap={{ scale: 0.9 }}
        >
          <Share2 size={16} className="text-white" />
        </motion.button>
        <motion.button
          onClick={() => toggleFavorite(property.id)}
          className={clsx(
            'w-9 h-9 rounded-full backdrop-blur-sm flex items-center justify-center border',
            isFavorite ? 'bg-red-500 border-red-400' : 'bg-black/70 border-white/20',
          )}
          whileTap={{ scale: 0.9 }}
        >
          <Heart size={16} className={clsx(isFavorite ? 'fill-white text-white' : 'text-white')} />
        </motion.button>
      </div>

      {/* Sticky action bar */}
      <div className="absolute bottom-0 left-0 right-0 z-30 bg-black border-t border-white/10 px-2 py-2">
        <div className="flex items-center gap-1">
          {[
            { icon: MessageCircle, label: 'Message', size: 18 },
            { icon: Phone, label: 'Appeler', size: 18 },
            { icon: CalendarPlus, label: 'Visiter', size: 18 },
          ].map(({ icon: Icon, label }) => (
            <button
              key={label}
              className="flex flex-col items-center gap-0.5 flex-1 py-2 rounded-xl hover:bg-white/5 transition-colors"
            >
              <Icon size={19} strokeWidth={1.8} className="text-white" />
              <span className="text-white/70 text-[10px]">{label}</span>
            </button>
          ))}
          <div className="w-px h-8 bg-white/10" />
          <button className="flex flex-col items-center gap-0.5 px-3 py-2">
            <Heart size={19} strokeWidth={1.8} className={clsx(isFavorite ? 'fill-white text-white' : 'text-white')} />
            <span className="text-white/70 text-[10px]">{(property.likeCount ?? 0) + (isFavorite ? 1 : 0)}</span>
          </button>
          <button className="flex flex-col items-center gap-0.5 px-3 py-2">
            <Share2 size={19} strokeWidth={1.8} className="text-white" />
            <span className="text-white/70 text-[10px]">{property.shareCount}</span>
          </button>
        </div>
      </div>
    </MobileFrame>
  )
}
