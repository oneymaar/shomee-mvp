'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Send } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useShomeeStore } from '@/lib/store'
import type { Property, ChatMessage } from '@/lib/types'

const AGENT_REPLIES = [
  (name: string) => `Bonjour ! Je suis ${name}. Comment puis-je vous aider concernant ce bien ?`,
  () => 'Avec plaisir ! Quand souhaitez-vous organiser une visite ?',
  () => 'Bien sûr, je peux vous donner plus de détails. Avez-vous des questions spécifiques ?',
  () => 'Je reviens vers vous très rapidement avec toutes les informations.',
  () => "N'hésitez pas si vous avez d'autres questions !",
]

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export default function ConversationView({ property }: { property: Property }) {
  const router = useRouter()
  const { conversations, addMessage, markUserMessagesRead, markConversationSeen } = useShomeeStore()
  const conv = conversations.find(c => c.propertyId === property.id)
  const messages: ChatMessage[] = conv?.messages ?? []

  const [text, setText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const replyIdxRef = useRef(messages.length > 0 ? AGENT_REPLIES.length - 1 : 0)

  const formatted = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)

  /* Mark conversation as seen whenever user is viewing it (on mount + on new messages) */
  useEffect(() => {
    markConversationSeen(property.id)
  }, [property.id, messages.length, markConversationSeen])

  /* Auto-scroll to bottom */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  /* Auto-resize textarea */
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  useEffect(() => {
    if (!text && textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [text])

  const sendMessage = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      text: trimmed,
      from: 'user',
      timestamp: Date.now(),
      read: false,
    }
    addMessage(property.id, userMsg)
    setText('')

    const delay = 900 + Math.random() * 600
    setTimeout(() => setIsTyping(true), delay)

    setTimeout(() => {
      setIsTyping(false)
      const idx = Math.min(replyIdxRef.current, AGENT_REPLIES.length - 1)
      replyIdxRef.current = Math.min(replyIdxRef.current + 1, AGENT_REPLIES.length - 1)

      addMessage(property.id, {
        id: `a-${Date.now()}`,
        text: AGENT_REPLIES[idx](property.agentName),
        from: 'agent',
        timestamp: Date.now(),
        read: false,
      })
      markUserMessagesRead(property.id)
    }, delay + 2000)
  }, [text, property.id, property.agentName, addMessage, markUserMessagesRead])

  const lastReadIdx = messages.reduceRight(
    (found, msg, i) => found !== -1 ? found : (msg.from === 'user' && msg.read ? i : -1),
    -1,
  )
  // "Lu" only if agent hasn't replied yet after the last read user message
  const lastMsgIsFromAgent = messages[messages.length - 1]?.from === 'agent'

  const hasMessages = messages.length > 0

  return (
    <div className="absolute inset-0 flex flex-col bg-black" style={{ bottom: '60px' }}>

      {/* ── Header ── */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 border-b border-white/8 bg-neutral-950"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)', paddingBottom: '10px' }}
      >
        <button onClick={() => router.push('/messages')} className="text-white/60 -ml-1 p-1">
          <ChevronLeft size={22} />
        </button>
        <div className="w-8 h-8 rounded-full bg-white border border-white/20 overflow-hidden flex items-center justify-center shrink-0">
          {property.agentAvatar ? (
            <img src={property.agentAvatar} alt={property.agentName} className="w-full h-full object-contain p-1" />
          ) : (
            <span className="text-black text-xs font-bold">{property.agentName.charAt(0)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-[14px] leading-tight">{property.agentName}</p>
          <p className="text-white/35 text-[11px]">Agence immobilière</p>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-3 scrollbar-hide">

        {/* Empty state */}
        {!hasMessages && (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 pt-4 pb-2">
            <div className="w-[80px] h-[80px] rounded-full bg-white border border-white/20 overflow-hidden flex items-center justify-center">
              {property.agentAvatar ? (
                <img src={property.agentAvatar} alt={property.agentName} className="w-full h-full object-contain p-2.5" />
              ) : (
                <span className="text-black text-2xl font-bold">{property.agentName.charAt(0)}</span>
              )}
            </div>
            <div className="text-center">
              <p className="text-white font-bold text-[17px]">{property.agentName}</p>
              <p className="text-white/35 text-[13px] mt-1">Agence immobilière · Paris</p>
            </div>
            <button
              onClick={() => router.back()}
              className="w-full flex items-center gap-3 bg-white/5 border border-white/8 rounded-2xl px-3.5 py-3 active:opacity-70 transition-opacity"
            >
              <div className="w-[46px] h-[46px] rounded-xl overflow-hidden shrink-0">
                <img src={property.imageUrlFallback} alt={property.title} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-white text-[13px] font-semibold leading-tight truncate">{property.title}</p>
                <p className="text-white/40 text-[12px] mt-0.5">{property.surface} m² · {formatted} €</p>
              </div>
              <ChevronRight size={15} className="text-white/25 shrink-0" />
            </button>
            <p className="text-white/40 text-[13px] text-center leading-relaxed">
              Envoyez un message pour démarrer<br />votre échange avec {property.agentName}.
            </p>
          </div>
        )}

        {/* Bubbles */}
        {messages.map((msg, i) => {
          const isUser = msg.from === 'user'
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
            >
              {/* Bubble — timestamp is INSIDE, bottom-right */}
              <div
                className={`max-w-[78%] px-4 py-3 text-[14px] leading-snug ${
                  isUser
                    ? 'bg-white text-black rounded-[20px] rounded-br-[5px]'
                    : 'bg-neutral-800 text-white rounded-[20px] rounded-bl-[5px]'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                <p className={`text-[10px] text-right mt-1 ${isUser ? 'text-black/60' : 'text-white/50'}`}>
                  {formatTime(msg.timestamp)}
                </p>
              </div>

              {/* "Lu" only when message read but no agent reply yet */}
              {isUser && i === lastReadIdx && !lastMsgIsFromAgent && (
                <span className="text-white/50 text-[11px] px-1">Lu</span>
              )}
            </motion.div>
          )
        })}

        {/* Typing indicator */}
        <AnimatePresence>
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
            >
              <div className="bg-neutral-800 rounded-[20px] rounded-bl-[5px] px-4 py-3.5 flex gap-1.5 items-center w-fit">
                {[0, 0.22, 0.44].map((delay, i) => (
                  <motion.div
                    key={i}
                    className="w-[6px] h-[6px] rounded-full bg-white/50"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.1, delay, ease: 'easeInOut' }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>

      {/* ── Input bar — Enter creates newline, only Send button sends ── */}
      <div className="shrink-0 flex items-end gap-2.5 px-4 py-3 border-t border-white/8 bg-neutral-950">
        <div className="flex-1 bg-white/8 rounded-[20px] px-4 py-2.5">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            rows={1}
            placeholder="Message..."
            style={{ resize: 'none', overflowY: 'auto', maxHeight: '120px' }}
            className="w-full bg-transparent text-white text-[14px] placeholder:text-white/30 outline-none leading-snug block"
          />
        </div>
        <button
          onClick={sendMessage}
          className={`w-9 h-9 mb-0.5 rounded-full flex items-center justify-center transition-all duration-150 shrink-0 ${
            text.trim() ? 'bg-white' : 'bg-white/10'
          }`}
        >
          <Send size={14} strokeWidth={2.2} className={text.trim() ? 'text-black' : 'text-white/30'} />
        </button>
      </div>
    </div>
  )
}
