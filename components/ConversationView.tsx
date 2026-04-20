'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Send } from 'lucide-react'
import type { Property } from '@/lib/types'

interface Props {
  property: Property
}

export default function ConversationView({ property }: Props) {
  const router = useRouter()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const formatted = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)

  return (
    <div className="absolute inset-0 flex flex-col bg-black" style={{ bottom: '60px' }}>

      {/* Header */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 border-b border-white/8 bg-neutral-950"
        style={{ paddingTop: 'max(20px, env(safe-area-inset-top, 20px))', paddingBottom: '12px' }}
      >
        <button onClick={() => router.push('/messages')} className="text-white/60 -ml-1 p-1">
          <ChevronLeft size={22} />
        </button>
        <div className="w-8 h-8 rounded-full bg-neutral-800 border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
          {property.agentAvatar ? (
            <img src={property.agentAvatar} alt={property.agentName} className="w-full h-full object-contain p-0.5" />
          ) : (
            <span className="text-white text-xs font-bold">{property.agentName.charAt(0)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-[14px] leading-tight">{property.agentName}</p>
          <p className="text-white/35 text-[11px]">Agence immobilière</p>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center gap-6 px-6 py-8">

        {/* Large avatar */}
        <div className="w-[76px] h-[76px] rounded-full bg-neutral-900 border border-white/12 overflow-hidden flex items-center justify-center">
          {property.agentAvatar ? (
            <img src={property.agentAvatar} alt={property.agentName} className="w-full h-full object-contain p-2" />
          ) : (
            <span className="text-white text-2xl font-bold">{property.agentName.charAt(0)}</span>
          )}
        </div>

        <div className="text-center -mt-1">
          <p className="text-white font-bold text-[17px]">{property.agentName}</p>
          <p className="text-white/35 text-[12px] mt-1">Agence immobilière · Paris</p>
        </div>

        {/* Property mini-card */}
        <button
          onClick={() => router.back()}
          className="w-full flex items-center gap-3 bg-white/5 border border-white/8 rounded-2xl px-3.5 py-3 active:opacity-70 transition-opacity"
        >
          <div className="w-[46px] h-[46px] rounded-xl overflow-hidden shrink-0">
            <img
              src={property.imageUrlFallback}
              alt={property.title}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-white text-[13px] font-semibold leading-tight truncate">{property.title}</p>
            <p className="text-white/40 text-[12px] mt-0.5">{property.surface} m² · {formatted} €</p>
          </div>
          <ChevronRight size={15} className="text-white/25 shrink-0" />
        </button>

        {/* Hint */}
        <p className="text-white/25 text-[12px] text-center leading-relaxed">
          Envoyez un message pour démarrer<br />votre échange avec {property.agentName}.
        </p>
      </div>

      {/* Input bar */}
      <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-t border-white/8 bg-neutral-950">
        <div className="flex-1 flex items-center bg-white/8 rounded-full px-4 py-2.5">
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Message..."
            className="flex-1 bg-transparent text-white text-[14px] placeholder:text-white/30 outline-none"
          />
        </div>
        <button
          onClick={() => setText('')}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150 ${
            text.trim() ? 'bg-white' : 'bg-white/10'
          }`}
        >
          <Send
            size={14}
            strokeWidth={2.2}
            className={text.trim() ? 'text-black' : 'text-white/30'}
          />
        </button>
      </div>
    </div>
  )
}
