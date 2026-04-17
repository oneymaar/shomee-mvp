'use client'

import { Sparkles, Send } from 'lucide-react'
import MobileFrame from '@/components/MobileFrame'
import BottomNav from '@/components/BottomNav'

export default function AssistantPage() {
  return (
    <MobileFrame>
      <div className="h-full flex flex-col pb-16">
        {/* Header */}
        <div className="bg-black/90 backdrop-blur-md border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-xl leading-none">BAIA</h1>
              <p className="text-violet-400 text-xs mt-0.5">Bureau d'Aide Immobilière par l'IA</p>
            </div>
          </div>
        </div>

        {/* Chat area placeholder */}
        <div className="flex-1 overflow-y-auto scrollbar-hide px-4 py-6 flex flex-col gap-4">
          {/* Bot greeting */}
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles size={13} className="text-white" />
            </div>
            <div className="bg-white/8 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
              <p className="text-white text-sm leading-relaxed">
                Bonjour ! Je suis BAIA, votre assistant immobilier intelligent. 👋
              </p>
              <p className="text-white/60 text-sm mt-2 leading-relaxed">
                Dites-moi ce que vous recherchez et je vous proposerai des biens qui correspondent
                vraiment à vos critères.
              </p>
            </div>
          </div>

          {/* Suggestion chips */}
          <div className="flex flex-wrap gap-2 pl-9">
            {[
              '🏠 Appartement 3 pièces',
              '💰 Budget < 500k€',
              '📍 Paris intra-muros',
              '☀️ Bien lumineux',
            ].map((chip) => (
              <button
                key={chip}
                className="text-xs font-medium bg-white/8 border border-white/15 text-white/80 px-3 py-1.5 rounded-full hover:border-white/30 hover:text-white transition-all"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Coming soon */}
          <div className="mt-auto pt-8 text-center">
            <p className="text-white/20 text-xs">Chat complet — bientôt disponible</p>
          </div>
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-white/10 bg-black">
          <div className="flex items-center gap-2 bg-white/8 border border-white/15 rounded-2xl px-4 py-3">
            <input
              className="flex-1 bg-transparent text-white text-sm placeholder:text-white/30 outline-none"
              placeholder="Décrivez votre bien idéal..."
              disabled
            />
            <button className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center opacity-50">
              <Send size={14} className="text-white" />
            </button>
          </div>
        </div>
      </div>

      <BottomNav />
    </MobileFrame>
  )
}
