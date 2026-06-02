'use client'

import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, Phone, CalendarPlus, Heart, Send, X } from 'lucide-react'
import clsx from 'clsx'
import type { Property } from '@/lib/types'
import { shareProperty } from '@/lib/share'

interface ActionRailProps {
  property: Property
  isFavorite: boolean
  onToggleFavorite: (rect: DOMRect) => void
  onMessage: () => void
  previewMode?: boolean
}

interface RailButtonProps {
  icon: React.ReactNode
  label?: string | number
  onClick?: () => void
}

function RailButton({ icon, label, onClick }: RailButtonProps) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1">
      {icon}
      {label !== undefined && (
        <span className="text-white text-[11px] font-semibold drop-shadow">{label}</span>
      )}
    </button>
  )
}

export default function ActionRail({ property, isFavorite, onToggleFavorite, onMessage, previewMode = false }: ActionRailProps) {
  const heartRef = useRef<HTMLButtonElement>(null)
  const [callOpen, setCallOpen] = useState(false)

  const handleHeartClick = () => {
    const rect = heartRef.current?.getBoundingClientRect()
    if (rect) onToggleFavorite(rect)
  }

  return (
    <>
    <div
      className={clsx(
        'absolute right-3 z-20 flex flex-col items-center gap-6',
        previewMode && 'pointer-events-none grayscale brightness-75',
      )}
      style={{ bottom: 'calc(var(--nav-h) + 112px)' }}
    >
      <RailButton
        icon={<MessageCircle size={28} strokeWidth={1.5} className="text-white" />}
        onClick={onMessage}
      />
      <RailButton icon={<Phone size={25} strokeWidth={1.5} className="text-white" />} onClick={() => setCallOpen(true)} />
      <RailButton icon={<CalendarPlus size={25} strokeWidth={1.5} className="text-white" />} />

      <button ref={heartRef} onClick={handleHeartClick} className="flex flex-col items-center gap-1">
        <motion.div
          animate={isFavorite ? { scale: [1, 1.4, 0.9, 1.1, 1] } : { scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
        >
          <Heart
            size={28}
            strokeWidth={1.5}
            className={clsx('transition-colors duration-200', isFavorite ? 'fill-red-500 text-red-500' : 'text-white')}
          />
        </motion.div>
        <span className="text-white text-[11px] font-semibold drop-shadow">
          {isFavorite ? (property.likeCount ?? 0) + 1 : property.likeCount}
        </span>
      </button>

      <RailButton
        icon={<Send size={25} strokeWidth={1.5} className="text-white" />}
        label={property.shareCount}
        onClick={() => shareProperty(property)}
      />
    </div>

    {/* Call modal */}
    <AnimatePresence>
      {callOpen && (
        <>
          <motion.div
            key="call-backdrop"
            className="fixed inset-0 z-[80] bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCallOpen(false)}
          />
          <motion.div
            key="call-sheet"
            className="fixed left-1/2 -translate-x-1/2 z-[90] w-full max-w-[430px] bg-neutral-900 rounded-t-2xl px-5 pt-5 pb-8"
            style={{ bottom: 0 }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-white/50 text-xs uppercase tracking-widest mb-0.5">Appeler</p>
                <p className="text-white font-bold text-lg leading-tight">{property.agentName}</p>
              </div>
              <button onClick={() => setCallOpen(false)} className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center mt-0.5">
                <X size={15} className="text-white" />
              </button>
            </div>
            <a
              href="tel:+33670744935"
              onClick={() => setCallOpen(false)}
              className="flex items-center justify-center gap-2.5 w-full py-3.5 rounded-2xl bg-emerald-500 active:bg-emerald-600 transition-colors"
            >
              <Phone size={18} className="text-white" />
              <span className="text-white font-semibold text-base">+33 6 70 74 49 35</span>
            </a>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    </>
  )
}
