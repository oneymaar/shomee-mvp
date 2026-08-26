'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Administration des comptes agents — page d'Olivier, protégée par
 * ADMIN_SECRET (saisi une fois, gardé en sessionStorage, envoyé en en-tête
 * x-admin-secret : même schéma que le TikTok Studio). Crée les comptes et
 * fournit les LIENS D'ACTIVATION à transmettre aux agents.
 */

interface AgentRow {
  id: string
  name: string
  email: string
  agency: string
  hasPassword: boolean
  pendingSetup: boolean
  setupPath: string | null
}

export default function AgentAdminPage() {
  const [secret, setSecret] = useState(() => {
    if (typeof window === 'undefined') return ''
    try {
      return sessionStorage.getItem('shomee-admin-secret') ?? ''
    } catch {
      return ''
    }
  })
  const [unlocked, setUnlocked] = useState(false)
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [lastLink, setLastLink] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async (s: string) => {
    setError(null)
    const res = await fetch('/api/agent/admin/agents', { headers: { 'x-admin-secret': s } })
    if (!res.ok) {
      setUnlocked(false)
      setError(res.status === 401 ? 'Clé incorrecte' : 'Erreur serveur')
      return
    }
    const j = (await res.json()) as { agents: AgentRow[] }
    setAgents(j.agents)
    setUnlocked(true)
    try {
      sessionStorage.setItem('shomee-admin-secret', s)
    } catch {}
  }, [])

  useEffect(() => {
    // Faux positif set-state-in-effect : les setState de load() surviennent
    // tous APRÈS un await — rien de synchrone dans le rendu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (secret && !unlocked) void load(secret)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret])

  const fullUrl = (path: string) => `${window.location.origin}${path}`

  const copy = async (path: string, id: string) => {
    try {
      await navigator.clipboard.writeText(fullUrl(path))
      setCopied(id)
      setTimeout(() => setCopied(null), 1600)
    } catch {}
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const res = await fetch('/api/agent/admin/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-secret': secret },
      body: JSON.stringify({ name, email, agencyName }),
    })
    const j = (await res.json().catch(() => null)) as { error?: string; setupPath?: string } | null
    if (!res.ok) {
      setError(j?.error ?? 'Création impossible')
      return
    }
    setLastLink(j?.setupPath ?? null)
    setName('')
    setEmail('')
    void load(secret)
  }

  const reset = async (id: string) => {
    const res = await fetch(`/api/agent/admin/agents/${id}/reset`, {
      method: 'POST',
      headers: { 'x-admin-secret': secret },
    })
    if (res.ok) void load(secret)
  }

  if (!unlocked) {
    return (
      <main className="min-h-dvh flex items-center justify-center px-6" style={{ backgroundColor: '#FAF3EE' }}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void load(secret)
          }}
          className="w-full max-w-sm"
        >
          <h1 className="text-[24px] text-center mb-6" style={{ fontFamily: 'var(--font-serif), Georgia, serif', color: '#201A16' }}>
            Administration SHOMEE
          </h1>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Clé d'administration"
            className="w-full rounded-2xl bg-white px-4 py-3 text-[15px] outline-none"
            style={{ border: '1.5px solid #E8D9CB', color: '#201A16' }}
          />
          {error && <p className="text-[13px] mt-3" style={{ color: '#B0442C' }}>{error}</p>}
          <button
            type="submit"
            className="w-full mt-5 py-3.5 rounded-full text-[15.5px] font-semibold"
            style={{ backgroundColor: '#A6512B', color: '#F6EDE6' }}
          >
            Entrer
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="min-h-dvh px-5 py-8 max-w-3xl mx-auto" style={{ backgroundColor: '#FAF3EE' }}>
      <h1 className="text-[26px] mb-6" style={{ fontFamily: 'var(--font-serif), Georgia, serif', color: '#201A16' }}>
        Comptes agents
      </h1>

      <form onSubmit={create} className="rounded-3xl bg-white p-5 mb-4" style={{ border: '1px solid #E8D9CB' }}>
        <div className="text-[11px] font-bold uppercase mb-3" style={{ color: '#A6512B', letterSpacing: '1.8px' }}>
          Ouvrir un compte
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de l'agent" required
            className="rounded-xl px-3.5 py-2.5 text-[14px] outline-none" style={{ border: '1.5px solid #E8D9CB' }} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required
            className="rounded-xl px-3.5 py-2.5 text-[14px] outline-none" style={{ border: '1.5px solid #E8D9CB' }} />
          <input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Agence" required
            className="rounded-xl px-3.5 py-2.5 text-[14px] outline-none" style={{ border: '1.5px solid #E8D9CB' }} />
        </div>
        {error && <p className="text-[13px] mt-3" style={{ color: '#B0442C' }}>{error}</p>}
        {lastLink && (
          <div className="mt-3 text-[13px] rounded-xl px-3.5 py-2.5" style={{ backgroundColor: '#EFE2D5', color: '#201A16' }}>
            Compte créé. Lien d&apos;activation à transmettre :{' '}
            <button type="button" className="underline font-semibold" onClick={() => copy(lastLink, 'last')}>
              {copied === 'last' ? 'copié ✓' : 'copier le lien'}
            </button>
          </div>
        )}
        <button type="submit" className="mt-4 px-5 py-2.5 rounded-full text-[14px] font-semibold"
          style={{ backgroundColor: '#A6512B', color: '#F6EDE6' }}>
          Créer le compte
        </button>
      </form>

      <div className="rounded-3xl bg-white overflow-hidden" style={{ border: '1px solid #E8D9CB' }}>
        {agents.length === 0 && (
          <p className="p-5 text-[14px]" style={{ color: '#8A7A6E' }}>Aucun agent pour l&apos;instant.</p>
        )}
        {agents.map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-5 py-3.5" style={{ borderTop: '1px solid #F2E9DF' }}>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold truncate" style={{ color: '#201A16' }}>
                {a.name} <span className="font-normal" style={{ color: '#B7A99D' }}>· {a.agency}</span>
              </div>
              <div className="text-[12.5px] truncate" style={{ color: '#8A7A6E' }}>{a.email}</div>
            </div>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full flex-none"
              style={a.hasPassword
                ? { backgroundColor: 'rgba(53,132,95,.12)', color: '#35845F' }
                : { backgroundColor: '#EFE2D5', color: '#8A7A6E' }}>
              {a.hasPassword ? 'actif' : a.pendingSetup ? 'lien envoyé' : 'à activer'}
            </span>
            {a.setupPath ? (
              <button onClick={() => copy(a.setupPath!, a.id)} className="text-[12.5px] font-semibold underline flex-none"
                style={{ color: '#A6512B' }}>
                {copied === a.id ? 'copié ✓' : 'copier le lien'}
              </button>
            ) : (
              <button onClick={() => reset(a.id)} className="text-[12.5px] font-semibold underline flex-none"
                style={{ color: '#A6512B' }}>
                nouveau lien
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[12px] mt-4" style={{ color: '#B7A99D' }}>
        « Nouveau lien » sert aussi de réinitialisation de mot de passe : l&apos;ancien mot de passe
        reste valable tant que le lien n&apos;est pas utilisé.
      </p>
    </main>
  )
}
