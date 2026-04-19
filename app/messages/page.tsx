'use client'

import { MessageCircle } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'

export default function MessagesPage() {
  return (
    <MobileFrame>
      <div className="absolute inset-0 overflow-y-auto scrollbar-hide" style={{ bottom: '60px' }}>

        {/* Header */}
        <div
          className="sticky top-0 z-10 bg-black border-b border-white/8 px-5 pb-4"
          style={{ paddingTop: 'max(20px, env(safe-area-inset-top, 20px))' }}
        >
          <h1 className="text-white font-bold text-xl tracking-tight">Messages</h1>
          <p className="text-white/40 text-xs mt-0.5">Vos échanges avec les agents</p>
        </div>

        {/* Empty state */}
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
      <BottomNav />
    </MobileFrame>
  )
}
