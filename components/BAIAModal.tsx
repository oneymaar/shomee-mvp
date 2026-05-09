'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Send, ChevronLeft } from 'lucide-react'

interface BAIAModalProps {
  open: boolean
  onClose: () => void
}

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

const EXAMPLE_QUESTIONS = [
  'Appartement 3 pièces lumineux dans le 18e…',
  'Budget maximum 800 000 €, terrasse obligatoire…',
  'Quelle est la tendance des prix dans ce secteur ?',
]

export default function BAIAModal({ open, onClose }: BAIAModalProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const replyIdxRef = useRef(0)

  useEffect(() => {
    if (!open) {
      setMessages([])
      setText('')
      setIsTyping(false)
      replyIdxRef.current = 0
    } else {
      setTimeout(() => textareaRef.current?.focus(), 350)
    }
  }, [open])

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
  const hasMessages = messages.length > 0

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="baia-modal"
          className="absolute inset-0 z-50 flex flex-col"
          style={{ backgroundColor: '#f5f0e8' }}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {/* ── Header ── */}
          <div
            className="shrink-0 flex items-center justify-between px-4 border-b border-black/8"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', paddingBottom: 12 }}
          >
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center text-neutral-500"
            >
              <ChevronLeft size={22} />
            </button>
            <div className="flex items-center gap-2">
              <img src="/Baia couleur 2.png" alt="BAIA" className="w-5 h-5 object-contain" />
              <span className="text-neutral-800 font-semibold text-[15px]">BAIA</span>
            </div>
            <div className="w-9" />
          </div>

          {/* ── Messages ── */}
          <div className="flex-1 overflow-y-auto px-5 flex flex-col scrollbar-hide">

            {/* Empty state — logo + greeting + examples */}
            {!hasMessages && (
              <div className="flex-1 flex flex-col items-center justify-center pb-8 gap-5">
                <motion.div
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: 0.05 }}
                  className="flex flex-col items-center gap-3"
                >
                  <img src="/Baia couleur 2.png" alt="BAIA" className="w-16 h-16 object-contain" />
                  <p className="text-neutral-800 font-semibold text-[18px] text-center leading-snug max-w-[260px]">
                    Bonjour Olivier, comment puis-je vous aider ?
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.18 }}
                  className="flex flex-col gap-2 w-full"
                >
                  {EXAMPLE_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="text-left text-neutral-400 text-[14px] leading-snug active:text-neutral-600 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </motion.div>
              </div>
            )}

            {/* Bubbles */}
            {hasMessages && (
              <div className="flex flex-col gap-3 pt-4">
                {messages.map((msg) => {
                  const isUser = msg.from === 'user'
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                      className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      {!isUser && (
                        <img src="/Baia couleur 2.png" alt="BAIA" className="w-6 h-6 object-contain shrink-0 mb-0.5" />
                      )}
                      <div
                        className={`max-w-[78%] px-4 py-3 text-[14px] leading-snug rounded-[20px] ${
                          isUser
                            ? 'bg-neutral-800 text-white rounded-br-[5px]'
                            : 'bg-white text-neutral-900 rounded-bl-[5px] shadow-sm'
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
                      className="flex items-end gap-2"
                    >
                      <img src="/Baia couleur 2.png" alt="BAIA" className="w-6 h-6 object-contain shrink-0 mb-0.5" />
                      <div className="bg-white rounded-[20px] rounded-bl-[5px] px-4 py-3.5 flex gap-1.5 items-center shadow-sm">
                        {[0, 0.22, 0.44].map((delay, i) => (
                          <motion.div
                            key={i}
                            className="w-[6px] h-[6px] rounded-full bg-neutral-400"
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
            )}

            {!hasMessages && <div ref={bottomRef} />}
          </div>

          {/* ── Input bar ── */}
          <div
            className="shrink-0 flex items-end gap-2.5 px-4 py-3 border-t border-black/8 bg-white"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
          >
            <div className="flex-1 bg-neutral-100 rounded-[20px] px-4 py-2.5 flex items-end gap-2">
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
                className="flex-1 bg-transparent text-neutral-900 text-[14px] placeholder:text-neutral-400 outline-none leading-snug block"
              />
            </div>
            <button
              onClick={sendText}
              className={`w-9 h-9 mb-0.5 rounded-full flex items-center justify-center transition-all duration-150 shrink-0 ${
                text.trim() ? 'bg-neutral-900' : 'bg-neutral-200'
              }`}
            >
              <Send size={14} strokeWidth={2.2} className={text.trim() ? 'text-white' : 'text-neutral-400'} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
