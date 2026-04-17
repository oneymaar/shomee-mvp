'use client'

import { useState } from 'react'
import { Sparkles, Bell, Send, Check } from 'lucide-react'

const SUGGESTIONS = [
  { id: 'paris11', label: 'Élargir à Paris 11e' },
  { id: 'budget',  label: 'Budget jusqu\'à 850 000 €' },
  { id: 'noasc',   label: 'Biens sans ascenseur' },
]

export default function EndOfFeedCard() {
  const [selected, setSelected] = useState<string[]>([])
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  const handleSend = () => {
    if (!text.trim() && selected.length === 0) return
    setSent(true)
    setTimeout(() => {
      setSent(false)
      setText('')
      setSelected([])
    }, 2000)
  }

  return (
    <div className="relative w-full h-full bg-neutral-950 flex flex-col overflow-hidden">
      {/* Soft radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-72 bg-white/4 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 h-full overflow-y-auto scrollbar-hide px-5 flex flex-col justify-center py-10">

        {/* Hero */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-white/8 border border-white/12 flex items-center justify-center mb-4">
            <Sparkles size={28} className="text-white" />
          </div>
          <h2 className="text-white font-bold text-2xl leading-snug mb-2">
            Vous avez fait le tour&nbsp;!
          </h2>
          <p className="text-white/50 text-sm leading-relaxed max-w-[280px]">
            Il n'y a pas d'autres biens correspondant à vos critères pour l'instant.
          </p>
        </div>

        {/* Alert badge */}
        <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 mb-8">
          <div className="w-9 h-9 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
            <Bell size={16} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-white text-sm font-semibold">Alertes activées</p>
            <p className="text-white/40 text-xs mt-0.5 leading-snug">
              Vous serez notifié dès qu'un nouveau bien correspond à vos critères.
            </p>
          </div>
        </div>

        {/* Suggestions */}
        <div className="mb-7">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">
            Élargir ma recherche
          </p>
          <div className="flex flex-col gap-2">
            {SUGGESTIONS.map(({ id, label }) => {
              const active = selected.includes(id)
              return (
                <button
                  key={id}
                  onClick={() => toggle(id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all ${
                    active
                      ? 'bg-white text-black border-white'
                      : 'bg-white/5 text-white/70 border-white/10'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                      active ? 'bg-black border-black' : 'border-white/30'
                    }`}
                  >
                    {active && <Check size={11} strokeWidth={3} />}
                  </div>
                  <span className="text-sm font-medium">{label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/8 mb-7" />

        {/* Free text */}
        <div>
          <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">
            Une précision pour BAIA&nbsp;?
          </p>
          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ex : je cherche idéalement un appartement calme, avec une belle hauteur sous plafond…"
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm placeholder-white/25 resize-none focus:outline-none focus:border-white/25 pr-14 leading-relaxed"
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() && selected.length === 0}
              className={`absolute bottom-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                text.trim() || selected.length > 0
                  ? 'bg-white text-black'
                  : 'bg-white/8 text-white/20 cursor-not-allowed'
              }`}
            >
              {sent ? <Check size={14} strokeWidth={2.5} /> : <Send size={13} />}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
