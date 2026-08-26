'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  formatAvailabilities,
  formatVisitDateFr,
  type AvailabilitiesPayload,
  type VisitConfirmedPayload,
  type VisitRequestPayload,
} from '@shomee/core/visits'

/**
 * Fil de discussion côté agent. Trois choses en plus d'une messagerie nue :
 *  - le BRIEF de la demande de visite, en tête (c'est la valeur SHOMEE : la
 *    demande arrive déjà qualifiée — budget, zones, exigences, score) ;
 *  - les disponibilités de l'acquéreur rendues en clair ;
 *  - « Caler la visite » : l'agent choisit l'heure PRÉCISE — l'événement part
 *    ensuite dans les deux agendas (.ics).
 */

interface Msg {
  id: string
  fromBuyer: boolean
  kind: 'TEXT' | 'VISIT_REQUEST' | 'AVAILABILITIES' | 'VISIT_CONFIRMED' | 'SYSTEM'
  text: string
  payload: unknown
  at: number
}
interface Thread {
  id: string
  property: { id: string; title?: string; arrondissement?: string; district?: string; price?: number; surface?: number; rooms?: number } | null
  buyer: { name: string; email: string | null }
  messages: Msg[]
}

const euro = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'

function BriefCard({ p }: { p: VisitRequestPayload }) {
  const lines: Array<[string, string]> = []
  if (p.budgetMax) lines.push(['Budget', `${p.budgetMin ? euro(p.budgetMin) + ' – ' : "jusqu'à "}${euro(p.budgetMax)}`])
  if (p.locationLabel) lines.push(['Zones', p.locationLabel])
  if (p.minSurface) lines.push(['Surface', `${p.minSurface} m² min.`])
  if (p.minBedrooms) lines.push(['Chambres', `${p.minBedrooms} min.`])
  if (p.matchScore != null) lines.push(['Correspondance', `${Math.round(p.matchScore * 100)} % avec ce bien`])
  return (
    <div className="rounded-2xl px-4 py-3.5 my-2" style={{ backgroundColor: 'rgba(239,226,213,.55)', border: '1px solid #E8D9CB' }}>
      <div className="text-[10.5px] font-bold uppercase mb-2" style={{ color: '#A6512B', letterSpacing: '1.8px' }}>
        Demande de visite — le brief
      </div>
      {lines.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[13px] py-0.5">
          <span className="w-28 flex-none" style={{ color: '#8A7A6E' }}>{k}</span>
          <span className="font-medium" style={{ color: '#201A16' }}>{v}</span>
        </div>
      ))}
      {p.criteria && (p.criteria.must.length > 0 || p.criteria.never.length > 0) && (
        <div className="text-[13px] pt-1.5 mt-1.5" style={{ borderTop: '1px solid #E8D9CB', color: '#201A16' }}>
          {p.criteria.must.length > 0 && <div>✓ Exige : {p.criteria.must.join(', ')}</div>}
          {p.criteria.want.length > 0 && <div style={{ color: '#8A7A6E' }}>+ Souhaite : {p.criteria.want.join(', ')}</div>}
          {p.criteria.never.length > 0 && <div style={{ color: '#B0442C' }}>✗ Refuse : {p.criteria.never.join(', ')}</div>}
        </div>
      )}
    </div>
  )
}

export default function AgentThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [thread, setThread] = useState<Thread | null>(null)
  const [text, setText] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [when, setWhen] = useState('')
  const [duration, setDuration] = useState(30)
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const countRef = useRef(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/conversations/${id}`)
      if (res.status === 401) {
        window.location.href = '/connexion-agent'
        return
      }
      if (!res.ok) return
      const j = (await res.json()) as Thread
      setThread(j)
      if (j.messages.length !== countRef.current) {
        countRef.current = j.messages.length
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60)
        void fetch(`/api/agent/conversations/${id}/read`, { method: 'POST' })
      }
    } catch {}
  }, [id])

  useEffect(() => {
    // Faux positif : setThread/… surviennent après await fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [load])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/agent/conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: value }),
      })
      if (res.ok) {
        setText('')
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  const confirmVisit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!when || busy) return
    setBusy(true)
    try {
      // datetime-local → ISO UTC : la conversion de fuseau est faite ICI, par
      // le navigateur de l'agent (heure de Paris chez lui) — jamais au serveur.
      const iso = new Date(when).toISOString()
      const res = await fetch(`/api/agent/conversations/${id}/confirm-visit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scheduledAt: iso, durationMin: duration }),
      })
      if (res.ok) {
        setConfirmOpen(false)
        setWhen('')
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  const cancelVisit = async (visitId: string) => {
    await fetch(`/api/agent/visits/${visitId}/cancel`, { method: 'POST' })
    await load()
  }

  return (
    <main className="min-h-dvh flex flex-col max-w-3xl mx-auto" style={{ backgroundColor: '#FAF3EE' }}>
      <header className="px-5 pt-6 pb-3 sticky top-0 z-10" style={{ backgroundColor: '#FAF3EE', borderBottom: '1px solid #E8D9CB' }}>
        <Link href="/agent/messages" className="text-[13px] font-semibold underline" style={{ color: '#A6512B' }}>
          ← Messages
        </Link>
        <div className="flex items-baseline justify-between mt-1.5">
          <h1 className="text-[20px] truncate" style={{ fontFamily: 'var(--font-serif), Georgia, serif', color: '#201A16' }}>
            {thread?.buyer.name ?? '…'}
          </h1>
          <button
            onClick={() => setConfirmOpen(true)}
            className="flex-none px-4 py-2 rounded-full text-[13.5px] font-semibold"
            style={{ backgroundColor: '#A6512B', color: '#F6EDE6' }}
          >
            Caler la visite
          </button>
        </div>
        <div className="text-[12.5px] truncate" style={{ color: '#8A7A6E' }}>
          {thread?.property
            ? [thread.property.title, thread.property.arrondissement, thread.property.price ? euro(thread.property.price) : null]
                .filter(Boolean)
                .join(' · ')
            : ''}
          {thread?.buyer.email ? ` — ${thread.buyer.email}` : ''}
        </div>
      </header>

      <div className="flex-1 px-5 py-4 overflow-y-auto">
        {thread?.messages.map((m) => {
          if (m.kind === 'VISIT_REQUEST') {
            return (
              <div key={m.id}>
                <Bubble fromBuyer={m.fromBuyer} text={m.text} at={m.at} />
                <BriefCard p={(m.payload ?? {}) as VisitRequestPayload} />
              </div>
            )
          }
          if (m.kind === 'AVAILABILITIES') {
            const p = (m.payload ?? { days: [] }) as AvailabilitiesPayload
            return (
              <div key={m.id} className="rounded-2xl px-4 py-3.5 my-2" style={{ backgroundColor: '#fff', border: '1px solid #E8D9CB' }}>
                <div className="text-[10.5px] font-bold uppercase mb-1.5" style={{ color: '#A6512B', letterSpacing: '1.8px' }}>
                  Disponibilités de l&apos;acquéreur
                </div>
                <div className="text-[13.5px] whitespace-pre-line" style={{ color: '#201A16' }}>
                  {formatAvailabilities(p)}
                </div>
              </div>
            )
          }
          if (m.kind === 'VISIT_CONFIRMED') {
            const p = (m.payload ?? {}) as Partial<VisitConfirmedPayload>
            return (
              <div key={m.id} className="rounded-2xl px-4 py-3.5 my-2" style={{ backgroundColor: 'rgba(53,132,95,.08)', border: '1px solid rgba(53,132,95,.25)' }}>
                <div className="text-[13.5px] font-semibold" style={{ color: '#35845F' }}>
                  {p.scheduledAt ? `Visite confirmée — ${formatVisitDateFr(p.scheduledAt)}` : m.text}
                </div>
                <div className="flex gap-4 mt-1.5">
                  {p.icsToken && (
                    <a href={`/api/visits/ics/${p.icsToken}`} className="text-[12.5px] font-semibold underline" style={{ color: '#35845F' }}>
                      Ajouter à mon agenda
                    </a>
                  )}
                  {p.visitId && p.status !== 'CANCELLED' && (
                    <button onClick={() => cancelVisit(p.visitId!)} className="text-[12.5px] underline" style={{ color: '#8A7A6E' }}>
                      Annuler la visite
                    </button>
                  )}
                </div>
              </div>
            )
          }
          if (m.kind === 'SYSTEM') {
            return (
              <div key={m.id} className="text-center text-[12px] my-2" style={{ color: '#B7A99D' }}>
                {m.text}
              </div>
            )
          }
          return <Bubble key={m.id} fromBuyer={m.fromBuyer} text={m.text} at={m.at} />
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="px-5 py-3 flex gap-2.5 sticky bottom-0" style={{ backgroundColor: '#FAF3EE', borderTop: '1px solid #E8D9CB' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Votre réponse…"
          className="flex-1 rounded-full bg-white px-4.5 px-5 py-3 text-[14.5px] outline-none"
          style={{ border: '1.5px solid #E8D9CB', color: '#201A16' }}
        />
        <button type="submit" disabled={busy || !text.trim()} className="px-5 rounded-full text-[14px] font-semibold disabled:opacity-50"
          style={{ backgroundColor: '#A6512B', color: '#F6EDE6' }}>
          Envoyer
        </button>
      </form>

      {confirmOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center px-6" style={{ backgroundColor: 'rgba(23,18,16,.45)' }}
          onClick={() => setConfirmOpen(false)}>
          <form onSubmit={confirmVisit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl bg-white p-6">
            <h2 className="text-[19px] mb-1" style={{ fontFamily: 'var(--font-serif), Georgia, serif', color: '#201A16' }}>
              Caler la visite
            </h2>
            <p className="text-[12.5px] mb-4" style={{ color: '#8A7A6E' }}>
              L&apos;heure précise, en tenant compte des disponibilités indiquées. L&apos;acquéreur reçoit
              la confirmation et le fichier d&apos;agenda.
            </p>
            <label className="block text-[11px] font-bold uppercase mb-1.5" style={{ color: '#A6512B', letterSpacing: '1.8px' }}>
              Date et heure
            </label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required
              className="w-full rounded-xl px-3.5 py-2.5 text-[14.5px] outline-none mb-4" style={{ border: '1.5px solid #E8D9CB', color: '#201A16' }} />
            <label className="block text-[11px] font-bold uppercase mb-1.5" style={{ color: '#A6512B', letterSpacing: '1.8px' }}>
              Durée
            </label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full rounded-xl px-3.5 py-2.5 text-[14.5px] outline-none bg-white" style={{ border: '1.5px solid #E8D9CB', color: '#201A16' }}>
              <option value={20}>20 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>1 heure</option>
            </select>
            <button type="submit" disabled={busy || !when} className="w-full mt-5 py-3 rounded-full text-[15px] font-semibold disabled:opacity-60"
              style={{ backgroundColor: '#A6512B', color: '#F6EDE6' }}>
              Confirmer la visite
            </button>
          </form>
        </div>
      )}
    </main>
  )
}

function Bubble({ fromBuyer, text, at }: { fromBuyer: boolean; text: string; at: number }) {
  const d = new Date(at)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return (
    <div className={`flex my-1.5 ${fromBuyer ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[80%] rounded-2xl px-4 py-2.5"
        style={fromBuyer ? { backgroundColor: '#fff', border: '1px solid #E8D9CB' } : { backgroundColor: '#A6512B' }}>
        <div className="text-[14px] whitespace-pre-line" style={{ color: fromBuyer ? '#201A16' : '#F6EDE6' }}>{text}</div>
        <div className="text-[10.5px] mt-1 text-right" style={{ color: fromBuyer ? '#B7A99D' : 'rgba(246,237,230,.6)' }}>{time}</div>
      </div>
    </div>
  )
}
