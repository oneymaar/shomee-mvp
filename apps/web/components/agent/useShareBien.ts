'use client'

/**
 * P0 — Geste « partager un bien », partagé par l'éditeur et la liste du
 * dashboard. Un seul endroit pour la règle, deux points d'entrée dans l'UI.
 *
 * Le chemin nominal est la FEUILLE DE PARTAGE NATIVE (`navigator.share`) :
 * l'agent choisit WhatsApp, Messages, Mail… et le texte part avec le lien.
 * Le presse-papiers n'est plus que le repli des navigateurs de bureau qui
 * n'implémentent pas l'API.
 *
 * Piège traité ici : iOS exige que `navigator.share()` parte dans la foulée
 * du geste utilisateur. Un `await fetch(...)` avant l'appel suffit à faire
 * échouer le partage. D'où `warm()` — branché sur `onPointerDown`, donc
 * déclenché à la seconde où le doigt touche le bouton : la requête est
 * lancée pendant le trajet doigt → clic, et le clic trouve le lien déjà là.
 *
 * La clé de démo est celle qu'utilise déjà tout le back-office
 * (`EditBienClient`, `PropertyCardAgent`, `MediaUploader`) : ce module
 * n'introduit pas de schéma d'authentification, il s'aligne sur l'existant.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// Aucune clé d'API ici : l'agent est authentifié par son cookie de session, et
// authenticateBearer l'accepte en repli.
const TOAST_DURATION_MS = 2200

export interface ShareLinkPayload {
  url: string
  title: string
  text: string
}

/** L'utilisateur a simplement fermé la feuille de partage : ce n'est pas une erreur. */
function isUserCancel(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'AbortError' || e.name === 'NotAllowedError')
}

export function useShareBien(propertyId: string) {
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Affiché seulement si le presse-papiers a refusé : le lien ne doit jamais
   *  être perdu entre l'appel réseau et l'agent. */
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)

  const payloadRef = useRef<ShareLinkPayload | null>(null)
  const inFlightRef = useRef<Promise<ShareLinkPayload | null> | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS)
  }, [])

  /** Le lien d'un bien ne change jamais : une fois obtenu, on le garde. */
  const fetchPayload = useCallback((): Promise<ShareLinkPayload | null> => {
    if (payloadRef.current) return Promise.resolve(payloadRef.current)
    if (inFlightRef.current) return inFlightRef.current

    const request = (async (): Promise<ShareLinkPayload | null> => {
      try {
        const res = await fetch(`/api/properties/${propertyId}/share-link`, {
          method: 'POST',
        })
        const body = (await res.json().catch(() => null)) as
          | { url?: string; title?: string; text?: string; error?: string }
          | null

        if (!res.ok || !body?.url) {
          setError(body?.error ?? 'Lien indisponible, réessayez.')
          return null
        }
        payloadRef.current = {
          url: body.url,
          title: body.title ?? 'SHOMEE',
          text: body.text ?? '',
        }
        return payloadRef.current
      } catch {
        setError('Lien indisponible, réessayez.')
        return null
      } finally {
        inFlightRef.current = null
      }
    })()

    inFlightRef.current = request
    return request
  }, [propertyId])

  /** Préchauffage : à brancher sur `onPointerDown` du bouton. */
  const warm = useCallback(() => {
    setError(null)
    void fetchPayload()
  }, [fetchPayload])

  const copyToClipboard = useCallback(
    async (url: string) => {
      try {
        await navigator.clipboard.writeText(url)
        showToast('Lien copié')
      } catch {
        // Presse-papiers refusé (contexte non sécurisé, permission) : on
        // affiche l'URL pour que l'agent la copie à la main.
        setFallbackUrl(url)
      }
    },
    [showToast],
  )

  const openSheetOrCopy = useCallback(
    async (payload: ShareLinkPayload) => {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: payload.title, text: payload.text, url: payload.url })
          return
        } catch (e) {
          // Fermeture volontaire : on ne fait rien de plus, surtout pas de
          // copie surprise dans le presse-papiers.
          if (isUserCancel(e)) return
          // Tout autre refus (geste expiré, API indisponible) : repli.
        }
      }
      await copyToClipboard(payload.url)
    },
    [copyToClipboard],
  )

  const share = useCallback(async () => {
    if (busy) return
    setError(null)
    setFallbackUrl(null)

    // Chemin rapide : le préchauffage a déjà rapporté le lien, on part dans la
    // foulée du clic — c'est ce qui rend la feuille native fiable sur iOS.
    const cached = payloadRef.current
    if (cached) {
      await openSheetOrCopy(cached)
      return
    }

    setBusy(true)
    try {
      const payload = await fetchPayload()
      if (!payload) return
      await openSheetOrCopy(payload)
    } finally {
      setBusy(false)
    }
  }, [busy, fetchPayload, openSheetOrCopy])

  return { share, warm, busy, toast, error, fallbackUrl, setError }
}
