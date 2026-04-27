'use client'

import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'
import ConversationView from '@/components/ConversationView'
import { useShomeeStore, hasUnread } from '@/lib/store'
import { properties } from '@/lib/mockData'
import type { Conversation } from '@/lib/types'
import { formatLocation } from '@/lib/format'

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function ConversationRow({ conv }: { conv: Conversation }) {
  const router = useRouter()
  const property = properties.find(p => p.id === conv.propertyId)
  if (!property) return null

  const lastMsg = conv.messages[conv.messages.length - 1]
  const unread = hasUnread(conv)
  const preview = lastMsg
    ? (lastMsg.from === 'user' ? `Vous : ${lastMsg.text}` : lastMsg.text)
    : ''

  const formattedPrice = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)

  return (
    <button
      onClick={() => router.push(`/messages?bien=${conv.propertyId}`)}
      className="w-full flex items-center gap-3 px-5 py-3.5 active:bg-white/4 transition-colors"
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div className="w-12 h-12 rounded-full bg-neutral-900 border border-white/15 overflow-hidden flex items-center justify-center">
          {property.agentAvatar ? (
            <img src={property.agentAvatar} alt={property.agentName} className="w-full h-full object-contain" />
          ) : (
            <span className="text-black font-bold text-sm">{property.agentName.charAt(0)}</span>
          )}
        </div>
        {unread && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-2 border-black" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-[14px] truncate ${unread ? 'text-white font-bold' : 'text-white font-semibold'}`}>
            {property.agentName}
          </p>
          {lastMsg && (
            <span className={`text-[11px] shrink-0 ${unread ? 'text-white font-bold' : 'text-white/65'}`}>
              {formatTime(lastMsg.timestamp)}
            </span>
          )}
        </div>
        {/* Property description: white, includes surface + price */}
        <p className="text-white text-[12px] truncate">
          {formatLocation(property.arrondissement, property.district)} · {property.surface}m² · {formattedPrice} €
        </p>
        {/* Last message preview */}
        {preview && (
          <p className={`text-[13px] truncate mt-0.5 ${unread ? 'text-white font-semibold' : 'text-white/50 font-normal'}`}>
            {preview}
          </p>
        )}
      </div>
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
        <p className="text-white/65 text-xs mt-0.5">Vos échanges avec les agents</p>
      </div>
      <div
        className="flex flex-col items-center justify-center gap-4 px-8 text-center"
        style={{ minHeight: 'calc(100dvh - 180px)' }}
      >
        <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <MessageCircle size={28} className="text-white/55" />
        </div>
        <div>
          <p className="text-white/60 text-sm font-medium">Aucun message</p>
          <p className="text-white/55 text-xs mt-1 leading-relaxed">
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
        <p className="text-white/65 text-xs mt-0.5">Vos échanges avec les agents</p>
      </div>
      <div>
        {sorted.map((conv, i) => (
          <div key={conv.propertyId}>
            <ConversationRow conv={conv} />
            {i < sorted.length - 1 && <div className="mx-5 h-px bg-white/6" />}
          </div>
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
