'use client'

import { MessageSquare, Phone, CalendarPlus, Heart, Send } from 'lucide-react'
import clsx from 'clsx'
import type { Property } from '@/lib/types'

interface ActionRailProps {
  property: Property
  isFavorite: boolean
  onToggleFavorite: () => void
  onContact: () => void
}

interface RailButtonProps {
  icon: React.ReactNode
  label?: string | number
  onClick?: () => void
  active?: boolean
  activeClass?: string
}

function RailButton({ icon, label, onClick }: RailButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1"
    >
      {icon}
      {label !== undefined && (
        <span className="text-white text-[11px] font-semibold drop-shadow">{label}</span>
      )}
    </button>
  )
}

export default function ActionRail({ property, isFavorite, onToggleFavorite, onContact }: ActionRailProps) {
  return (
    <div className="absolute right-3 bottom-28 z-20 flex flex-col items-center gap-4">
      <RailButton
        icon={<MessageSquare size={24} strokeWidth={1.5} className="text-white" />}
        onClick={onContact}
      />
      <RailButton
        icon={<Phone size={22} strokeWidth={1.5} className="text-white" />}
      />
      <RailButton
        icon={<CalendarPlus size={22} strokeWidth={1.5} className="text-white" />}
      />
      <RailButton
        icon={
          <Heart
            size={24}
            strokeWidth={1.5}
            className={clsx('transition-all', isFavorite ? 'fill-red-500 text-red-500' : 'text-white')}
          />
        }
        label={isFavorite ? (property.likeCount ?? 0) + 1 : property.likeCount}
        onClick={onToggleFavorite}
      />
      <RailButton
        icon={<Send size={22} strokeWidth={1.5} className="text-white" />}
        label={property.shareCount}
      />
    </div>
  )
}
