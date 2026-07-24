'use client'

/**
 * CTA de la landing /h/<token> — partie interactive (squelette H1).
 *
 * Cascade §4.2 du doc d'archi, vue du web :
 *  - « Ouvrir SHOMEE » → scheme shomee://h/<token> (marche si l'app est là ;
 *    les Universal Links prendront le relai une fois le domaine posé — H0).
 *  - « Télécharger l'app » → NEXT_PUBLIC_APP_DOWNLOAD_URL (lien TestFlight
 *    aujourd'hui, App Store demain).
 *  - Copie du code court (presse-papiers) pour le cold start.
 */

import { useState } from 'react'

const BTN: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'center', padding: '14px 16px',
  borderRadius: 12, fontSize: 15, fontWeight: 600, textDecoration: 'none',
  border: '1px solid transparent', cursor: 'pointer',
}

export default function HandoffActions({
  token,
  code,
  claimed,
}: {
  token: string
  code: string
  claimed: boolean
}) {
  const [copied, setCopied] = useState(false)
  const downloadUrl = process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL ?? ''

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* clipboard refusé → le code reste lisible à l'écran */
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <a
        href={`shomee://h/${token}`}
        style={{ ...BTN, background: '#e9ebf0', color: '#0e1015' }}
      >
        Ouvrir SHOMEE
      </a>

      {!claimed && (
        <>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              style={{ ...BTN, background: 'transparent', color: '#e9ebf0', borderColor: '#3a4150' }}
            >
              Télécharger l’app
            </a>
          ) : null}

          <button
            type="button"
            onClick={copyCode}
            style={{ ...BTN, background: 'transparent', color: '#98a0ae', borderColor: '#2a2f3a' }}
          >
            {copied ? 'Code copié ✓' : `Copier mon code · ${code}`}
          </button>

          <p style={{ fontSize: 12, color: '#7d8592', textAlign: 'center', margin: '4px 0 0' }}>
            Pas encore l’app ? Téléchargez-la puis collez (ou saisissez) ce code au premier
            lancement — votre recherche vous y attendra.
          </p>
        </>
      )}
    </div>
  )
}
