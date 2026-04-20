'use client'

import { useRef } from 'react'
import { motion } from 'framer-motion'
import { MessageCircle, Phone, CalendarPlus, Heart, Send } from 'lucide-react'
import clsx from 'clsx'
import type { Property } from '@/lib/types'

interface ActionRailProps {
  property: Property
  isFavorite: boolean
  onToggleFavorite: (rect: DOMRect) => void
  onMessage: () => void
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

export default function ActionRail({ property, isFavorite, onToggleFavorite, onMessage }: ActionRailProps) {
  const heartRef = useRef<HTMLButtonElement>(null)

  const handleHeartClick = () => {
    const rect = heartRef.current?.getBoundingClientRect()
    if (rect) onToggleFavorite(rect)
  }

  return (
    <div className="absolute right-3 bottom-28 z-20 flex flex-col items-center gap-6">
      <RailButton
        icon={<MessageCircle size={28} strokeWidth={1.5} className="text-white" />}
        onClick={onMessage}
      />
      <RailButton icon={<Phone size={25} strokeWidth={1.5} className="text-white" />} />
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
      />
    </div>
  )
}
