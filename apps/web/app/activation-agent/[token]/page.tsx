'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Activation d'un compte agent — l'agent arrive ici par le lien transmis par
 * SHOMEE, choisit son mot de passe, et repart connecté. Même page pour la
 * réinitialisation (l'admin régénère simplement un lien).
 */
export default function ActivationAgentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('8 caractères minimum')
      return
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/agent/auth/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        setError(j?.error ?? 'Activation impossible')
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
          Bienvenue sur SHOMEE
        </h1>
        <p className="text-[13.5px] text-center mb-8" style={{ color: '#8A7A6E' }}>
          Choisissez le mot de passe de votre espace agence.
        </p>
        <label className="block text-[11px] font-bold uppercase mb-1.5" style={{ color: '#A6512B', letterSpacing: '1.8px' }}>
          Mot de passe
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          className="w-full rounded-2xl bg-white px-4 py-3 text-[15px] outline-none mb-4"
          style={{ border: '1.5px solid #E8D9CB', color: '#201A16' }}
        />
        <label className="block text-[11px] font-bold uppercase mb-1.5" style={{ color: '#A6512B', letterSpacing: '1.8px' }}>
          Confirmez-le
        </label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
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
          {busy ? 'Activation…' : 'Activer mon compte'}
        </button>
      </form>
    </main>
  )
}
