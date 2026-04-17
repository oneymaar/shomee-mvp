'use client'

import { MessageCircle, Phone, CalendarPlus, Heart, Share2 } from 'lucide-react'
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

function RailButton({ icon, label, onClick, active, activeClass }: RailButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1"
    >
      <div
        className={clsx(
          'w-11 h-11 rounded-full flex items-center justify-center transition-all',
          active ? activeClass : 'bg-black/40 backdrop-blur-sm border border-white/20',
        )}
      >
        {icon}
      </div>
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
        icon={<MessageCircle size={22} strokeWidth={1.8} className="text-white" />}
        onClick={onContact}
      />
      <RailButton
        icon={<Phone size={21} strokeWidth={1.8} className="text-white" />}
      />
      <RailButton
        icon={<CalendarPlus size={21} strokeWidth={1.8} className="text-white" />}
      />
      <RailButton
        icon={
          <Heart
            size={22}
            strokeWidth={1.8}
            className={clsx('transition-all', isFavorite ? 'fill-white text-white' : 'text-white')}
          />
        }
        label={isFavorite ? (property.likeCount ?? 0) + 1 : property.likeCount}
        onClick={onToggleFavorite}
        active={isFavorite}
        activeClass="bg-red-500 border border-red-400"
      />
      <RailButton
        icon={<Share2 size={20} strokeWidth={1.8} className="text-white" />}
        label={property.shareCount}
      />
    </div>
  )
}
