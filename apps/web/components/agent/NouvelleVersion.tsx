'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * « Nouvelle version disponible — Recharger ».
 *
 * Retient la version servie au premier chargement, puis la re-demande
 * régulièrement et à chaque retour sur l'onglet. Si elle a changé, c'est qu'un
 * déploiement est passé pendant que l'écran affichait encore l'ancien code :
 * on le dit, au lieu de laisser croire qu'un correctif n'a rien fait.
 */
export default function NouvelleVersion() {
  const initiale = useRef<string | null>(null)
  const [obsolete, setObsolete] = useState(false)

  const verifier = useCallback(async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (!res.ok) return
      const { version } = (await res.json()) as { version: string }
      if (!version || version === 'dev') return
      if (initiale.current === null) {
        initiale.current = version
        return
      }
      if (version !== initiale.current) setObsolete(true)
    } catch {
      // Hors ligne : on ne dit rien plutôt que d'alarmer pour rien.
    }
  }, [])

  useEffect(() => {
    // Première vérification différée d'un tour de boucle : appelée directement
    // dans l'effet, elle déclencherait un rendu en cascade (et le compilateur
    // React le refuse, à raison).
    const premiere = window.setTimeout(() => { void verifier() }, 0)
    const minute = window.setInterval(() => { void verifier() }, 60_000)
    const auRetour = () => { if (document.visibilityState === 'visible') void verifier() }
    document.addEventListener('visibilitychange', auRetour)
    return () => {
      window.clearTimeout(premiere)
      window.clearInterval(minute)
      document.removeEventListener('visibilitychange', auRetour)
    }
  }, [verifier])

  if (!obsolete) return null

  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="fixed left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 rounded-full bg-[#0a0a0a] text-white text-[13px] font-semibold px-4 py-2.5 shadow-[0_6px_20px_-4px_rgba(0,0,0,0.35)]"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
      Nouvelle version — Recharger
    </button>
  )
}
