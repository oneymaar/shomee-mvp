'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * Boîte de réception de l'agent — rafraîchie toutes les 15 s (pas de push au
 * MVP : le back-office est une page ouverte au bureau, le polling suffit).
 * Une demande de visite porte sa pastille : c'est un prospect, pas un fil.
 */

interface Row {
  id: string
  property: { id: string; title?: string; arrondissement?: string; district?: string; price?: number }
  buyer: { name: string; email: string | null }
  lastMessage: { text: string; at: number; fromBuyer: boolean } | null
  unread: number
  hasVisitRequest: boolean
}

function timeAgo(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `il y a ${h} h`
  return `il y a ${Math.round(h / 24)} j`
}

export default function AgentMessagesPage() {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const res = await fetch('/api/agent/conversations')
        if (res.status === 401) {
          window.location.href = '/connexion-agent'
          return
        }
        if (!res.ok) return
        const j = (await res.json()) as { conversations: Row[] }
        if (!stop) setRows(j.conversations)
      } catch {}
    }
    void load()
    const t = setInterval(load, 15000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  return (
    <main className="min-h-dvh px-5 py-8 max-w-3xl mx-auto" style={{ backgroundColor: '#FAF3EE' }}>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-[26px]" style={{ fontFamily: 'var(--font-serif), Georgia, serif', color: '#201A16' }}>
          Messages
        </h1>
        <Link href="/agent/dashboard" className="text-[13px] font-semibold underline" style={{ color: '#A6512B' }}>
          ← Tableau de bord
        </Link>
      </div>

      {rows === null && <p className="text-[14px]" style={{ color: '#8A7A6E' }}>Chargement…</p>}
      {rows?.length === 0 && (
        <p className="text-[14px]" style={{ color: '#8A7A6E' }}>
          Aucune conversation pour l&apos;instant — elles apparaîtront ici dès qu&apos;un acquéreur vous écrira.
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        {rows?.map((r) => (
          <Link
            key={r.id}
            href={`/agent/messages/${r.id}`}
            className="rounded-2xl bg-white px-4.5 py-3.5 px-5 block"
            style={{ border: '1px solid #E8D9CB' }}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-[14.5px] font-semibold truncate" style={{ color: '#201A16' }}>
                {r.buyer.name}
              </span>
              {r.hasVisitRequest && (
                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full flex-none"
                  style={{ backgroundColor: 'rgba(166,81,43,.1)', color: '#A6512B', letterSpacing: '.4px' }}>
                  VISITE
                </span>
              )}
              {r.unread > 0 && (
                <span className="ml-auto flex-none text-[11px] font-bold min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#A6512B', color: '#F6EDE6' }}>
                  {r.unread}
                </span>
              )}
            </div>
            <div className="text-[12.5px] truncate mt-0.5" style={{ color: '#8A7A6E' }}>
              {[r.property.title, r.property.arrondissement].filter(Boolean).join(' · ')}
            </div>
            {r.lastMessage && (
              <div className="text-[13px] truncate mt-1.5" style={{ color: r.unread > 0 ? '#201A16' : '#B7A99D' }}>
                {r.lastMessage.fromBuyer ? '' : 'Vous : '}
                {r.lastMessage.text}
                <span style={{ color: '#B7A99D' }}> · {timeAgo(r.lastMessage.at)}</span>
              </div>
            )}
          </Link>
        ))}
      </div>
    </main>
  )
}
