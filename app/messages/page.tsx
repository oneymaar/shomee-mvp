'use client'

import { MessageCircle } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'

export default function MessagesPage() {
  return (
    <MobileFrame>
      <div className="h-full flex flex-col pb-16">
        <div className="px-5 py-4 border-b border-white/10">
          <h1 className="text-white font-bold text-xl">Messages</h1>
          <p className="text-white/40 text-sm mt-0.5">Vos échanges avec les agents</p>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
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
