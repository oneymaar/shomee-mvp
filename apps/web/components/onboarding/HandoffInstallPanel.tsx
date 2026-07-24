'use client'

/**
 * Panneau d'installation du handoff (S9 H2) — l'écran qui suit la validation
 * du récap sur /onboarding?h=<token> (landing /h/*). Design system du funnel :
 * crème #FDF5F2, terracotta #A64B27, cartes blanches arrondies.
 *
 * Cascade de rattachement vue du web (§4.2 du doc d'archi) :
 *   « Ouvrir SHOMEE »   → scheme shomee://h/<token> (app installée ; les
 *                         Universal Links prendront le relai avec le domaine).
 *   « Télécharger »     → NEXT_PUBLIC_APP_DOWNLOAD_URL (TestFlight → App Store).
 *   Code court          → copié au montage (best-effort silencieux) + bouton.
 *
 * Variante `claimed` : le brief est déjà dans l'app — pas de code, pas
 * d'édition, juste « Ouvrir SHOMEE ».
 */

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { Check, Copy, Smartphone } from 'lucide-react'

const ACCENT = '#A64B27'

function frDate(iso: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(d)
}

export default function HandoffInstallPanel({
  token,
  shortCode,
  expiresAt,
  claimed,
  onBackToRecap,
}: {
  token: string
  shortCode: string
  expiresAt: string
  claimed: boolean
  onBackToRecap?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const downloadUrl = process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL ?? ''
  const validite = frDate(expiresAt)

  // Copie best-effort au montage — le canal presse-papiers de la cascade.
  // Refus silencieux : le code reste lisible et copiable au bouton.
  useEffect(() => {
    if (claimed || !shortCode) return
    navigator.clipboard?.writeText(shortCode).catch(() => {})
  }, [claimed, shortCode])

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(shortCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* le code reste affiché */
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: '#FDF5F2' }}>
      <div
        className="flex-1 min-h-0 overflow-y-auto px-6 flex flex-col items-center justify-center gap-5 text-center"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 24px)' }}
      >
        <Image
          src="/logo terracotta.png"
          alt="SHOMEE"
          width={64}
          height={72}
          priority
          className="object-contain"
        />

        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(166,75,39,0.10)' }}
        >
          <Check size={24} strokeWidth={2.6} style={{ color: ACCENT }} />
        </motion.div>

        <div>
          <h2 className="text-[22px] font-bold text-neutral-900 leading-tight tracking-tight">
            {claimed ? 'Déjà dans l’app ✓' : 'Votre recherche est prête.'}
          </h2>
          <p className="text-[13.5px] text-neutral-600 mt-2 max-w-[300px] mx-auto">
            {claimed
              ? 'Ce brief a déjà été récupéré dans l’application. Ouvrez SHOMEE pour retrouver votre sélection.'
              : 'Découvrez les biens qui correspondent dans l’app SHOMEE — votre recherche vous y attend.'}
          </p>
        </div>

        {!claimed && shortCode ? (
          <div className="w-full max-w-[320px] bg-white border border-black/8 rounded-2xl px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-2">
              Votre code SHOMEE
            </p>
            <p
              className="text-[26px] font-bold tracking-[0.12em] text-neutral-900"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {shortCode}
            </p>
            <button
              type="button"
              onClick={copyCode}
              className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-opacity active:opacity-70"
              style={{ color: ACCENT }}
            >
              {copied ? <Check size={13} strokeWidth={2.6} /> : <Copy size={13} />}
              {copied ? 'Copié' : 'Copier le code'}
            </button>
            <p className="text-[11.5px] text-neutral-500 leading-snug mt-2">
              À saisir au premier lancement si vous installez l’app — votre recherche vous y
              attendra.
            </p>
          </div>
        ) : null}
      </div>

      <div
        className="flex-none px-6 pt-4 flex flex-col gap-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
      >
        <a
          href={`shomee://h/${token}`}
          className="w-full py-3.5 rounded-2xl font-semibold text-[15.5px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          <Smartphone size={17} />
          Ouvrir SHOMEE
        </a>

        {!claimed && downloadUrl ? (
          <a
            href={downloadUrl}
            className="w-full py-3.5 rounded-2xl font-semibold text-[15px] flex items-center justify-center border bg-white active:bg-black/5 transition-colors"
            style={{ color: ACCENT, borderColor: 'rgba(166,75,39,0.35)' }}
          >
            Télécharger l’app
          </a>
        ) : null}

        {!claimed && onBackToRecap ? (
          <button
            type="button"
            onClick={onBackToRecap}
            className="w-full py-3 text-[13.5px] font-medium transition-opacity active:opacity-70"
            style={{ color: ACCENT }}
          >
            Ajuster encore ma recherche
          </button>
        ) : null}

        {!claimed && validite ? (
          <p className="text-[11.5px] text-neutral-500 text-center">
            Recherche valable jusqu’au {validite}
          </p>
        ) : null}
      </div>
    </div>
  )
}
