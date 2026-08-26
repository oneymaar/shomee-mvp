'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * Réglages agent — clés d'API des connecteurs (Claude, ChatGPT). C'est ici
 * qu'un agent fraîchement activé crée sa PREMIÈRE clé : avant les comptes, il
 * fallait déjà une clé pour en créer une. La valeur complète ne s'affiche
 * qu'une fois, à la création.
 */

interface KeyRow {
  id: string
  label: string
  preview: string
  createdAt: number
  lastUsed: number | null
}

export default function AgentReglagesPage() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null)
  const [label, setLabel] = useState('')
  const [freshKey, setFreshKey] = useState<{ label: string; key: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    const res = await fetch('/api/agent/me/keys')
    if (res.status === 401) {
      window.location.href = '/connexion-agent'
      return
    }
    if (!res.ok) return
    const j = (await res.json()) as { keys: KeyRow[] }
    setKeys(j.keys)
  }

  useEffect(() => {
    // Faux positif : setKeys survient après await fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch('/api/agent/me/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: label || 'Connecteur' }),
    })
    if (!res.ok) return
    const j = (await res.json()) as { label: string; key: string }
    setFreshKey(j)
    setLabel('')
    void load()
  }

  const logout = async () => {
    await fetch('/api/agent/auth/logout', { method: 'POST' })
    window.location.href = '/connexion-agent'
  }

  return (
    <main className="min-h-dvh px-5 py-8 max-w-3xl mx-auto" style={{ backgroundColor: '#FAF3EE' }}>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-[26px]" style={{ fontFamily: 'var(--font-serif), Georgia, serif', color: '#201A16' }}>
          Réglages
        </h1>
        <Link href="/agent/dashboard" className="text-[13px] font-semibold underline" style={{ color: '#A6512B' }}>
          ← Tableau de bord
        </Link>
      </div>

      <section className="rounded-3xl bg-white p-5" style={{ border: '1px solid #E8D9CB' }}>
        <div className="text-[11px] font-bold uppercase mb-1.5" style={{ color: '#A6512B', letterSpacing: '1.8px' }}>
          Clés des connecteurs
        </div>
        <p className="text-[13px] mb-4" style={{ color: '#8A7A6E' }}>
          Une clé relie Claude ou ChatGPT à votre compte pour créer vos annonces par la
          conversation. Créez-en une par outil — vous pourrez la révoquer indépendamment.
        </p>

        {freshKey && (
          <div className="rounded-xl px-4 py-3 mb-4" style={{ backgroundColor: '#EFE2D5' }}>
            <div className="text-[12.5px] font-semibold mb-1" style={{ color: '#201A16' }}>
              Clé « {freshKey.label} » créée — copiez-la MAINTENANT, elle ne sera plus jamais affichée :
            </div>
            <div className="flex items-center gap-2.5">
              <code className="text-[12px] break-all flex-1" style={{ color: '#A6512B' }}>{freshKey.key}</code>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(freshKey.key).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1600)
                  })
                }}
                className="flex-none text-[12.5px] font-semibold underline"
                style={{ color: '#A6512B' }}
              >
                {copied ? 'copiée ✓' : 'copier'}
              </button>
            </div>
          </div>
        )}

        {keys?.map((k) => (
          <div key={k.id} className="flex items-center gap-3 py-2.5" style={{ borderTop: '1px solid #F2E9DF' }}>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold" style={{ color: '#201A16' }}>{k.label}</div>
              <div className="text-[12px]" style={{ color: '#B7A99D' }}>
                {k.preview}
                {k.lastUsed ? ` · utilisée ${new Date(k.lastUsed).toLocaleDateString('fr-FR')}` : ' · jamais utilisée'}
              </div>
            </div>
          </div>
        ))}
        {keys?.length === 0 && !freshKey && (
          <p className="text-[13px] py-2" style={{ color: '#B7A99D' }}>Aucune clé pour l&apos;instant.</p>
        )}

        <form onSubmit={create} className="flex gap-2.5 mt-4">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Nom de la clé (ex. Claude)"
            className="flex-1 rounded-xl px-3.5 py-2.5 text-[14px] outline-none"
            style={{ border: '1.5px solid #E8D9CB', color: '#201A16' }}
          />
          <button type="submit" className="px-4 rounded-full text-[13.5px] font-semibold"
            style={{ backgroundColor: '#A6512B', color: '#F6EDE6' }}>
            Créer une clé
          </button>
        </form>
      </section>

      <button onClick={logout} className="mt-6 text-[13.5px] font-semibold underline" style={{ color: '#8A7A6E' }}>
        Se déconnecter
      </button>
    </main>
  )
}
