'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Connexion agent — email + mot de passe. Les comptes sont créés par SHOMEE
 * (pas d'inscription publique) : un agent sans compte contacte l'équipe.
 */
export default function ConnexionAgentPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/agent/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        setError(j?.error ?? 'Connexion impossible')
        return
      }
      router.replace('/agent/dashboard')
    } catch {
      setError('Erreur réseau — réessayez')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-6" style={{ backgroundColor: '#FAF3EE' }}>
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="text-[26px] text-center mb-1" style={{ fontFamily: 'var(--font-serif), Georgia, serif', color: '#201A16' }}>
          Espace agence
        </h1>
        <p className="text-[13.5px] text-center mb-8" style={{ color: '#8A7A6E' }}>
          Connectez-vous avec l&apos;email de votre compte SHOMEE.
        </p>
        <label className="block text-[11px] font-bold uppercase mb-1.5" style={{ color: '#A6512B', letterSpacing: '1.8px' }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="w-full rounded-2xl bg-white px-4 py-3 text-[15px] outline-none mb-4"
          style={{ border: '1.5px solid #E8D9CB', color: '#201A16' }}
        />
        <label className="block text-[11px] font-bold uppercase mb-1.5" style={{ color: '#A6512B', letterSpacing: '1.8px' }}>
          Mot de passe
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="w-full rounded-2xl bg-white px-4 py-3 text-[15px] outline-none"
          style={{ border: '1.5px solid #E8D9CB', color: '#201A16' }}
        />
        {error && (
          <p className="text-[13px] mt-3" style={{ color: '#B0442C' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full mt-6 py-3.5 rounded-full text-[15.5px] font-semibold disabled:opacity-60"
          style={{ backgroundColor: '#A6512B', color: '#F6EDE6', boxShadow: '0 10px 22px rgba(166,81,43,.28)' }}
        >
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
        <p className="text-[12px] text-center mt-6" style={{ color: '#B7A99D' }}>
          Mot de passe oublié ? Contactez SHOMEE : un nouveau lien d&apos;activation vous sera envoyé.
        </p>
      </form>
    </main>
  )
}
