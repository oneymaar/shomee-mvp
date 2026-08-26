'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * Réglages agent — LE CONNECTEUR, pas une clé d'API.
 *
 * L'agent ne gère plus un secret : il copie une adresse et suit trois étapes.
 * Les deux onglets ne changent qu'un paramètre de l'URL (`client=`), qui sert à
 * marquer la provenance des annonces dictées — mais ils changent surtout le
 * pas-à-pas, parce que Claude et ChatGPT ne rangent pas les connecteurs au même
 * endroit.
 */

type Connecteur = {
  urlClaude: string
  urlChatgpt: string
  createdAt: number
  lastUsed: number | null
}

const TERRA = '#A6512B'
const ENCRE = '#201A16'
const DOUX = '#8A7A6E'
const LIGNE = '#E8D9CB'

const EXEMPLES: Array<{ quand: string; phrase: string }> = [
  { quand: 'Le matin', phrase: 'Qu’est-ce qui m’attend aujourd’hui ?' },
  { quand: 'Répondre', phrase: 'Réponds à Mme Bernard que je la rappelle ce soir.' },
  { quand: 'Caler', phrase: 'Propose-lui jeudi 10 h 30 pour le 11ᵉ.' },
  { quand: 'Saisir', phrase: 'Nouveau mandat : 3 pièces, 74 m², rue de Cîteaux.' },
  { quand: 'Analyser', phrase: 'Pourquoi le duplex de Bastille ne décolle pas ?' },
  { quand: 'Piloter', phrase: 'Mes chiffres du mois, bien par bien.' },
]

const ETAPES: Record<'claude' | 'chatgpt', Array<{ fort: string; suite: string; note?: string }>> = {
  claude: [
    { fort: 'Réglages → Connecteurs', suite: ' dans Claude.', note: 'l’intitulé peut varier selon la version' },
    { fort: 'Ajouter un connecteur personnalisé', suite: ' : collez l’adresse ci-dessus, puis validez.' },
    { fort: '« Qu’est-ce qui m’attend aujourd’hui ? »', suite: ' — demandez-le dans une conversation.' },
  ],
  chatgpt: [
    { fort: 'Paramètres → Connecteurs', suite: ' dans ChatGPT, puis activez le mode développeur.', note: 'une seule fois' },
    { fort: 'Créer un connecteur', suite: ' : collez l’adresse ci-dessus, puis validez.' },
    { fort: '« Qu’est-ce qui m’attend aujourd’hui ? »', suite: ' — activez SHOMEE dans la conversation et demandez-le.' },
  ],
}

function ilYA(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000)
  if (min < 2) return "à l'instant"
  if (min < 60) return `il y a ${min} minutes`
  const h = Math.round(min / 60)
  if (h < 24) return `il y a ${h} heure${h > 1 ? 's' : ''}`
  const j = Math.round(h / 24)
  return j < 30 ? `il y a ${j} jour${j > 1 ? 's' : ''}` : new Date(ts).toLocaleDateString('fr-FR')
}

export default function AgentReglagesPage() {
  const [connecteur, setConnecteur] = useState<Connecteur | null>(null)
  const [charge, setCharge] = useState(false)
  const [onglet, setOnglet] = useState<'claude' | 'chatgpt'>('claude')
  const [copie, setCopie] = useState(false)
  const [occupe, setOccupe] = useState(false)

  const charger = useCallback(async () => {
    const res = await fetch('/api/agent/me/connecteur')
    if (res.status === 401) {
      window.location.href = '/connexion-agent'
      return
    }
    if (!res.ok) return
    const j = (await res.json()) as { connecteur: Connecteur | null }
    setConnecteur(j.connecteur)
    setCharge(true)
  }, [])

  useEffect(() => {
    // Faux positif : setState survient après await fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger()
  }, [charger])

  const creer = async () => {
    setOccupe(true)
    const res = await fetch('/api/agent/me/connecteur', { method: 'POST' })
    if (res.ok) {
      const j = (await res.json()) as { connecteur: Connecteur }
      setConnecteur(j.connecteur)
    }
    setOccupe(false)
  }

  const revoquer = async () => {
    if (!window.confirm('Révoquer ce connecteur ? Claude et ChatGPT perdront immédiatement l’accès à votre compte.')) return
    setOccupe(true)
    await fetch('/api/agent/me/connecteur', { method: 'DELETE' })
    setConnecteur(null)
    setOccupe(false)
  }

  const url = connecteur ? (onglet === 'claude' ? connecteur.urlClaude : connecteur.urlChatgpt) : ''

  const copier = () => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopie(true)
      setTimeout(() => setCopie(false), 1800)
    })
  }

  const logout = async () => {
    await fetch('/api/agent/auth/logout', { method: 'POST' })
    window.location.href = '/connexion-agent'
  }

  return (
    <main className="min-h-dvh px-5 py-8 max-w-3xl mx-auto" style={{ backgroundColor: '#FAF3EE' }}>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-[27px]" style={{ fontFamily: 'var(--font-serif), Georgia, serif', color: ENCRE }}>
          Réglages
        </h1>
        <Link href="/agent/dashboard" className="text-[13px] font-semibold underline" style={{ color: TERRA }}>
          ← Tableau de bord
        </Link>
      </div>

      <section className="rounded-3xl bg-white p-6" style={{ border: `1px solid ${LIGNE}` }}>
        <div className="text-[11px] font-bold uppercase mb-2" style={{ color: TERRA, letterSpacing: '1.8px' }}>
          Votre connecteur
        </div>
        <p className="text-[14px] leading-relaxed mb-5" style={{ color: DOUX }}>
          Branchez <b style={{ color: ENCRE }}>Claude</b> ou <b style={{ color: ENCRE }}>ChatGPT</b> sur votre compte
          SHOMEE : vous dictez vos mandats, vous répondez à vos acquéreurs et vous calez vos visites depuis une simple
          conversation. <b style={{ color: ENCRE }}>Rien à installer</b> — une adresse à copier, une fois.
        </p>

        {!charge ? (
          <p className="text-[13.5px] py-2" style={{ color: '#B7A99D' }}>Chargement…</p>
        ) : !connecteur ? (
          <button
            onClick={creer}
            disabled={occupe}
            className="rounded-full px-5 py-3 text-[14px] font-semibold"
            style={{ backgroundColor: occupe ? '#DB947E' : TERRA, color: '#F6EDE6' }}
          >
            {occupe ? 'Création…' : 'Créer mon connecteur'}
          </button>
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              {(['claude', 'chatgpt'] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => setOnglet(o)}
                  className="rounded-full px-4 py-2 text-[13.5px] font-semibold"
                  style={
                    onglet === o
                      ? { backgroundColor: ENCRE, color: '#F6EDE6', border: `1.5px solid ${ENCRE}` }
                      : { backgroundColor: '#fff', color: DOUX, border: `1.5px solid ${LIGNE}` }
                  }
                >
                  {o === 'claude' ? 'Claude' : 'ChatGPT'}
                </button>
              ))}
            </div>

            <div className="rounded-2xl px-4 py-4 flex items-center gap-3.5" style={{ backgroundColor: '#171210' }}>
              <code className="flex-1 text-[12.5px] leading-relaxed break-all" style={{ color: '#F6EDE6', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {url}
              </code>
              <button
                onClick={copier}
                className="flex-none rounded-full px-4 py-2.5 text-[13px] font-semibold"
                style={{ backgroundColor: copie ? '#35845F' : '#C96B45', color: '#fff' }}
              >
                {copie ? 'Copiée ✓' : 'Copier'}
              </button>
            </div>
            <p className="text-[12px] leading-relaxed mt-3" style={{ color: DOUX }}>
              Cette adresse contient votre clé personnelle : ne la transmettez à personne. Elle donne accès à vos biens
              et à vos conversations — jamais à ceux de vos confrères.
            </p>

            <div className="mt-5 pt-5" style={{ borderTop: '1px solid #F2E9DF' }}>
              {ETAPES[onglet].map((e, i) => (
                <div key={i} className="flex gap-3.5 mb-3.5 last:mb-0">
                  <div
                    className="flex-none w-[25px] h-[25px] rounded-full flex items-center justify-center text-[12.5px] font-bold"
                    style={{ backgroundColor: '#EFE2D5', color: TERRA }}
                  >
                    {i + 1}
                  </div>
                  <div className="text-[14px] leading-snug pt-0.5" style={{ color: ENCRE }}>
                    <b>{e.fort}</b>
                    {e.suite}
                    {e.note && <span className="text-[13px]" style={{ color: DOUX }}> ({e.note})</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-7 mt-5 pt-4" style={{ borderTop: '1px solid #F2E9DF' }}>
              <div className="text-[12.5px]" style={{ color: '#B7A99D' }}>
                Créé le
                <b className="block text-[13.5px] font-semibold mt-0.5" style={{ color: ENCRE }}>
                  {new Date(connecteur.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </b>
              </div>
              <div className="text-[12.5px]" style={{ color: '#B7A99D' }}>
                Dernière utilisation
                <b className="block text-[13.5px] font-semibold mt-0.5" style={{ color: connecteur.lastUsed ? ENCRE : '#B7A99D' }}>
                  {connecteur.lastUsed ? (
                    <>
                      <span className="inline-block w-[7px] h-[7px] rounded-full mr-1.5" style={{ backgroundColor: '#35845F' }} />
                      {ilYA(connecteur.lastUsed)}
                    </>
                  ) : (
                    'jamais — le connecteur n’est pas encore branché'
                  )}
                </b>
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={revoquer} disabled={occupe} className="text-[13px] font-semibold underline" style={{ color: '#B0442C' }}>
                Révoquer ce connecteur
              </button>
            </div>
          </>
        )}
      </section>

      <section className="rounded-3xl bg-white p-6 mt-4" style={{ border: `1px solid ${LIGNE}` }}>
        <div className="text-[11px] font-bold uppercase mb-3" style={{ color: TERRA, letterSpacing: '1.8px' }}>
          Ce que vous pouvez lui demander
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {EXEMPLES.map((e) => (
            <div key={e.quand} className="rounded-2xl px-3.5 py-3 text-[13.5px] leading-snug" style={{ border: `1px solid ${LIGNE}`, backgroundColor: '#FDFAF7', color: ENCRE }}>
              <span className="block text-[11.5px] font-semibold uppercase mb-1" style={{ color: '#B7A99D', letterSpacing: '.6px' }}>
                {e.quand}
              </span>
              {e.phrase}
            </div>
          ))}
        </div>
      </section>

      <button onClick={logout} className="mt-6 text-[13.5px] font-semibold underline" style={{ color: DOUX }}>
        Se déconnecter
      </button>
    </main>
  )
}
