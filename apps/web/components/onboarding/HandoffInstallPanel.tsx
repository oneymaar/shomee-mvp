'use client'

/**
 * Panneau d'installation du handoff (S9 H2). Deux usages, un seul composant :
 *
 *  variant="panel" (défaut) — écran plein, crème #FDF5F2. C'est l'écran qui
 *    suit la validation du récap sur /onboarding?h=<token> (landing /h/*).
 *
 *  variant="gate" — carte compacte posée par-dessus le feed teaser web. Au
 *    premier scroll vers la 2e vidéo, cette carte recouvre l'écran : pour
 *    continuer, il faut l'app. Le fond flouté est fourni par l'appelant
 *    (app/feed/page.tsx), pas par ce composant.
 *
 * Cascade de rattachement vue du web (§4.2 du doc d'archi) :
 *   « Ouvrir SHOMEE »   → bouton INTELLIGENT : tente le scheme
 *                         shomee://h/<token>, et si rien ne s'est ouvert au
 *                         bout d'un court délai (donc app absente), bascule
 *                         seul vers NEXT_PUBLIC_APP_DOWNLOAD_URL
 *                         (TestFlight → App Store).
 *   Lien secondaire     → installation explicite, pour qui sait déjà.
 *   Code court          → copié au montage (best-effort silencieux) + bouton.
 *
 * Pourquoi ce bricolage : le web n'a AUCUN moyen de savoir si une app est
 * installée (Apple l'interdit). On ne peut que tenter l'ouverture et observer
 * si la page passe en arrière-plan. Ce bouton disparaîtra le jour des
 * Universal Links (H0 : domaine de prod + AASA), où le lien /h/<token> ouvrira
 * l'app directement sans jamais afficher cette page.
 *
 * Variante `claimed` : le brief est déjà dans l'app — pas de code, pas
 * d'édition, juste « Ouvrir SHOMEE ».
 */

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { Check, Copy, Smartphone } from 'lucide-react'

const ACCENT = '#A64B27'

/** Délai d'observation avant de conclure « l'app n'est pas installée ». */
const APP_OPEN_TIMEOUT = 1300

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
  variant = 'panel',
  matchCount,
}: {
  token: string
  shortCode: string
  expiresAt: string
  claimed: boolean
  onBackToRecap?: () => void
  variant?: 'panel' | 'gate'
  matchCount?: number
}) {
  const [copied, setCopied] = useState(false)
  const [installHint, setInstallHint] = useState(false)
  const downloadUrl = process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL ?? ''
  const validite = frDate(expiresAt)
  const isGate = variant === 'gate'

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

  /**
   * Tente d'ouvrir l'app, puis retombe sur l'installation.
   *
   * Le seul signal exploitable est la mise en arrière-plan de la page : si
   * iOS bascule vers SHOMEE, l'onglet devient caché (visibilitychange /
   * pagehide / blur) et on annule la bascule. Sinon, au bout d'APP_OPEN_TIMEOUT,
   * on considère que rien ne s'est ouvert.
   */
  const tryOpenApp = useCallback(() => {
    let cancelled = false
    const cancel = () => {
      cancelled = true
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') cancel()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', cancel)
    window.addEventListener('blur', cancel)

    window.setTimeout(() => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', cancel)
      window.removeEventListener('blur', cancel)
      if (cancelled || document.visibilityState === 'hidden') return
      if (downloadUrl) {
        window.location.href = downloadUrl
        return
      }
      // Pas d'URL d'installation configurée : on le dit au lieu de ne rien faire.
      setInstallHint(true)
    }, APP_OPEN_TIMEOUT)

    // Doit rester dans le geste utilisateur : pas de setTimeout avant.
    window.location.href = `shomee://h/${token}`
  }, [token, downloadUrl])

  const titre = isGate
    ? 'La suite est dans l’app.'
    : claimed
      ? 'Déjà dans l’app ✓'
      : 'Votre recherche est prête.'

  const sousTitre = isGate
    ? matchCount && matchCount > 1
      ? `${matchCount} biens correspondent à votre recherche. Continuez la visite dans l’app SHOMEE.`
      : 'Continuez la visite dans l’app SHOMEE — votre recherche vous y attend.'
    : claimed
      ? 'Ce brief a déjà été récupéré dans l’application. Ouvrez SHOMEE pour retrouver votre sélection.'
      : 'Découvrez les biens qui correspondent dans l’app SHOMEE — votre recherche vous y attend.'

  /* ── Bloc haut : logo, titre, code ─────────────────────────────────────── */
  const entete = (
    <>
      <Image
        src="/logo terracotta.png"
        alt="SHOMEE"
        width={isGate ? 48 : 64}
        height={isGate ? 54 : 72}
        priority
        className="object-contain"
      />

      {!isGate ? (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(166,75,39,0.10)' }}
        >
          <Check size={24} strokeWidth={2.6} style={{ color: ACCENT }} />
        </motion.div>
      ) : null}

      <div>
        <h2
          className={`font-bold text-neutral-900 leading-tight tracking-tight ${
            isGate ? 'text-[20px]' : 'text-[22px]'
          }`}
        >
          {titre}
        </h2>
        <p className="text-[13.5px] text-neutral-600 mt-2 max-w-[300px] mx-auto">{sousTitre}</p>
      </div>

      {!claimed && shortCode ? (
        <div
          className={`w-full max-w-[320px] bg-white border border-black/8 rounded-2xl ${
            isGate ? 'px-5 py-3' : 'px-5 py-4'
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mb-2">
            Votre code SHOMEE
          </p>
          <p
            className={`font-bold tracking-[0.12em] text-neutral-900 ${
              isGate ? 'text-[22px]' : 'text-[26px]'
            }`}
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
          {!isGate ? (
            <p className="text-[11.5px] text-neutral-500 leading-snug mt-2">
              À saisir au premier lancement si vous installez l’app — votre recherche vous y
              attendra.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  )

  /* ── Bloc bas : actions ────────────────────────────────────────────────── */
  const actions = (
    <>
      <button
        type="button"
        onClick={tryOpenApp}
        className="w-full py-3.5 rounded-2xl font-semibold text-[15.5px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
        style={{ backgroundColor: ACCENT }}
      >
        <Smartphone size={17} />
        {isGate ? 'Continuer dans l’app' : 'Ouvrir SHOMEE'}
      </button>

      {installHint ? (
        <p className="text-[12px] text-neutral-600 text-center leading-snug px-2">
          Application introuvable sur cet appareil. Votre code est déjà copié : installez SHOMEE
          puis collez-le au premier lancement.
        </p>
      ) : null}

      {!claimed && downloadUrl ? (
        <a
          href={downloadUrl}
          className="w-full py-3 text-[13px] font-medium text-center transition-opacity active:opacity-70"
          style={{ color: ACCENT }}
        >
          Pas encore installée ? Installer l’app
        </a>
      ) : null}

      {!claimed && onBackToRecap ? (
        <button
          type="button"
          onClick={onBackToRecap}
          className="w-full py-3 text-[13.5px] font-medium transition-opacity active:opacity-70"
          style={{ color: ACCENT }}
        >
          {isGate ? 'Ajuster ma recherche' : 'Ajuster encore ma recherche'}
        </button>
      ) : null}

      {!claimed && validite ? (
        <p className="text-[11.5px] text-neutral-500 text-center">
          Recherche valable jusqu’au {validite}
        </p>
      ) : null}
    </>
  )

  /* ── Variante « gate » : carte compacte au-dessus du feed ───────────────── */
  if (isGate) {
    return (
      <div
        className="w-full max-w-[340px] max-h-[86dvh] overflow-y-auto rounded-3xl px-6 py-6 flex flex-col items-center gap-4 text-center shadow-2xl"
        style={{ background: '#FDF5F2' }}
      >
        {entete}
        <div className="w-full flex flex-col gap-1.5 mt-1">{actions}</div>
      </div>
    )
  }

  /* ── Variante « panel » : écran plein ──────────────────────────────────── */
  return (
    <div className="flex flex-col h-full" style={{ background: '#FDF5F2' }}>
      <div
        className="flex-1 min-h-0 overflow-y-auto px-6 flex flex-col items-center justify-center gap-5 text-center"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 24px)' }}
      >
        {entete}
      </div>

      <div
        className="flex-none px-6 pt-4 flex flex-col gap-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
      >
        {actions}
      </div>
    </div>
  )
}
