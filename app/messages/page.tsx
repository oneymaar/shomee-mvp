'use client'

import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { MessageCircle, ChevronRight } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'
import ConversationView from '@/components/ConversationView'
import { useShomeeStore } from '@/lib/store'
import { properties } from '@/lib/mockData'
import type { Conversation } from '@/lib/types'

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function ConversationRow({ conv }: { conv: Conversation }) {
  const router = useRouter()
  const property = properties.find(p => p.id === conv.propertyId)
  if (!property) return null

  const lastMsg = conv.messages[conv.messages.length - 1]
  const preview = lastMsg
    ? (lastMsg.from === 'user' ? `Vous : ${lastMsg.text}` : lastMsg.text)
    : ''

  return (
    <button
      onClick={() => router.push(`/messages?bien=${conv.propertyId}`)}
      className="w-full flex items-center gap-3 px-5 py-3.5 active:bg-white/4 transition-colors"
    >
      {/* Avatar */}
      <div className="w-11 h-11 rounded-full bg-white border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
        {property.agentAvatar ? (
          <img src={property.agentAvatar} alt={property.agentName} className="w-full h-full object-contain p-1.5" />
        ) : (
          <span className="text-black font-bold text-sm">{property.agentName.charAt(0)}</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2">
          <p className="text-white font-semibold text-[14px] truncate">{property.agentName}</p>
          {lastMsg && <span className="text-white/35 text-[11px] shrink-0">{formatTime(lastMsg.timestamp)}</span>}
        </div>
        <p className="text-white/50 text-[12px] mt-0.5 truncate">
          {property.arrondissement} · {property.district}
        </p>
        {preview && (
          <p className="text-white/30 text-[12px] truncate mt-0.5">{preview}</p>
        )}
      </div>

      <ChevronRight size={15} className="text-white/20 shrink-0" />
    </button>
  )
}

function MessagesEmpty() {
  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-hide" style={{ bottom: '60px' }}>
      <div
        className="sticky top-0 z-10 bg-black border-b border-white/8 px-5 pb-4"
        style={{ paddingTop: 'max(20px, env(safe-area-inset-top, 20px))' }}
      >
        <h1 className="text-white font-bold text-xl tracking-tight">Messages</h1>
        <p className="text-white/40 text-xs mt-0.5">Vos échanges avec les agents</p>
      </div>
      <div
        className="flex flex-col items-center justify-center gap-4 px-8 text-center"
        style={{ minHeight: 'calc(100dvh - 180px)' }}
      >
        <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <MessageCircle size={28} className="text-white/30" />
        </div>
        <div>
          <p className="text-white/60 text-sm font-medium">Aucun message</p>
          <p className="text-white/30 text-xs mt-1 leading-relaxed">
            Vos échanges avec les agents<br />apparaîtront ici.
          </p>
        </div>
      </div>
    </div>
  )
}

function MessagesList() {
  const conversations = useShomeeStore(s => s.conversations)
  const sorted = [...conversations].sort((a, b) => {
    const ta = a.messages[a.messages.length - 1]?.timestamp ?? 0
    const tb = b.messages[b.messages.length - 1]?.timestamp ?? 0
    return tb - ta
  })

  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-hide" style={{ bottom: '60px' }}>
      <div
        className="sticky top-0 z-10 bg-black border-b border-white/8 px-5 pb-4"
        style={{ paddingTop: 'max(20px, env(safe-area-inset-top, 20px))' }}
      >
        <h1 className="text-white font-bold text-xl tracking-tight">Messages</h1>
        <p className="text-white/40 text-xs mt-0.5">Vos échanges avec les agents</p>
      </div>
      <div className="divide-y divide-white/6">
        {sorted.map(conv => (
          <ConversationRow key={conv.propertyId} conv={conv} />
        ))}
      </div>
    </div>
  )
}

function MessagesContent() {
  const searchParams = useSearchParams()
  const conversations = useShomeeStore(s => s.conversations)
  const bienId = searchParams.get('bien')
  const property = bienId ? properties.find(p => p.id === bienId) : null

  if (property) return <ConversationView property={property} />
  if (conversations.length > 0) return <MessagesList />
  return <MessagesEmpty />
}

export default function MessagesPage() {
  return (
    <MobileFrame>
      <Suspense fallback={<MessagesEmpty />}>
        <MessagesContent />
      </Suspense>
      <BottomNav />
    </MobileFrame>
  )
}
