'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
import { Send } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'

interface Message {
  id: string
  text: string
  from: 'user' | 'baia'
}

const BAIA_REPLIES = [
  "D'après vos critères, je trouve plusieurs biens intéressants dans ce secteur. Souhaitez-vous que je vous en présente quelques-uns ?",
  'Je prends note ! Avez-vous une préférence pour l\'orientation ou l\'étage ?',
  'Très bien. Avec ce budget, vous pouvez viser un T3 lumineux dans le 11e ou le 18e. Je peux affiner la recherche si vous le souhaitez.',
  'Bonne question. Je vais analyser les biens disponibles et vous proposer une sélection adaptée.',
  "Je vous prépare une sélection personnalisée. N'hésitez pas à préciser d'autres critères importants pour vous.",
]

const SUGGESTIONS = [
  '🏠 Appartement 3 pièces',
  '💰 Budget < 500 k€',
  '📍 Paris intra-muros',
  '☀️ Bien lumineux',
]

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const replyIdxRef = useRef(0)
  const hasMessages = messages.length > 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  useEffect(() => {
    if (!text && textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [text])

  const send = useCallback((input: string) => {
    const trimmed = input.trim()
    if (!trimmed) return

    setMessages(prev => [...prev, { id: `u-${Date.now()}`, text: trimmed, from: 'user' }])
    setText('')

    const delay = 800 + Math.random() * 700
    setTimeout(() => setIsTyping(true), delay * 0.4)

    setTimeout(() => {
      setIsTyping(false)
      const idx = replyIdxRef.current % BAIA_REPLIES.length
      replyIdxRef.current += 1
      setMessages(prev => [...prev, { id: `b-${Date.now()}`, text: BAIA_REPLIES[idx], from: 'baia' }])
    }, delay + 1800)
  }, [])

  const sendText = useCallback(() => send(text), [send, text])

  return (
    <MobileFrame>
      <div className="absolute inset-0 flex flex-col bg-neutral-900" style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}>

        {/* ── Header ── */}
        <div
          className="shrink-0 flex flex-col items-center gap-1 px-5 pb-4 border-b border-white/8"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
        >
          <img src="/Baia couleur 2.png" alt="BAIA" className="w-14 h-14 object-contain" />
          <p className="text-white/45 text-[11px] italic -mt-0.5">Buyer's AI Agent</p>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-3 scrollbar-hide">

          {/* Greeting + suggestions */}
          {!hasMessages && (
            <>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22 }}
                className="flex items-start gap-2.5"
              >
                <img src="/Baia couleur 2.png" alt="BAIA" className="w-6 h-6 object-contain shrink-0 mt-0.5" />
                <div className="bg-neutral-800 rounded-[20px] rounded-bl-[5px] px-4 py-3 max-w-[82%]">
                  <p className="text-white text-[14px] leading-snug">
                    Bonjour Olivier, en quoi puis-je vous être utile ?
                  </p>
                </div>
              </motion.div>

              <div className="flex flex-wrap gap-2 pl-[34px]">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-[12px] font-medium bg-white/6 border border-white/12 text-white/75 px-3 py-1.5 rounded-full active:opacity-60 transition-opacity"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Bubbles */}
          {messages.map((msg) => {
            const isUser = msg.from === 'user'
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className={`flex items-end gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {!isUser && (
                  <img src="/Baia couleur 2.png" alt="BAIA" className="w-6 h-6 object-contain shrink-0 mb-0.5" />
                )}
                <div
                  className={`max-w-[78%] px-4 py-3 text-[14px] leading-snug ${
                    isUser
                      ? 'bg-white text-black rounded-[20px] rounded-br-[5px]'
                      : 'bg-neutral-800 text-white rounded-[20px] rounded-bl-[5px]'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                </div>
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
                className="flex items-end gap-2.5"
              >
                <img src="/Baia couleur 2.png" alt="BAIA" className="w-6 h-6 object-contain shrink-0 mb-0.5" />
                <div className="bg-neutral-800 rounded-[20px] rounded-bl-[5px] px-4 py-3.5 flex gap-1.5 items-center">
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

        {/* ── Input bar ── */}
        <div className="shrink-0 flex items-end gap-2.5 px-4 py-3 border-t border-white/8 bg-neutral-950">
          <div className="flex-1 bg-white/8 rounded-[20px] px-4 py-2.5">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() }
              }}
              rows={1}
              placeholder="Posez votre question..."
              style={{ resize: 'none', overflowY: 'auto', maxHeight: '120px' }}
              className="w-full bg-transparent text-white text-[14px] placeholder:text-white/30 outline-none leading-snug block"
            />
          </div>
          <button
            onClick={sendText}
            className={`w-9 h-9 mb-0.5 rounded-full flex items-center justify-center transition-all duration-150 shrink-0 ${
              text.trim() ? 'bg-white' : 'bg-white/10'
            }`}
          >
            <Send size={14} strokeWidth={2.2} className={text.trim() ? 'text-black' : 'text-white/55'} />
          </button>
        </div>
      </div>

      <BottomNav />
    </MobileFrame>
  )
}
