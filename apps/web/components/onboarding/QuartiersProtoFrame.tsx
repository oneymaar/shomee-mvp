'use client'

/**
 * Étape « Quartiers » du parcours WEB = EXACTEMENT l'écran de l'application.
 *
 * L'app iOS n'a pas d'écran Quartiers natif : `QuartierProtoWebView` charge la
 * page `/proto/quartiers` dans une WebView et écoute deux messages
 * (`back` / `validate`). Ce composant est le pendant WEB de cette WebView :
 * même page, chargée dans une iframe same-origin, même contrat de messages
 * (avec un discriminant `source` pour ne pas confondre avec d'autres
 * postMessage). Conséquence : une seule implémentation à maintenir, et la
 * parité web/app est structurelle — plus jamais une version en retard.
 *
 * Chargement : quand on arrive directement sur la carte (édition du bloc
 * Quartiers depuis le récap), on couvre l'iframe avec le même écran d'attente
 * que l'ancien LocationMapStep, jusqu'au message `ready` du proto (min. 3 s,
 * filet de sécurité à 9 s).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useSearchStore } from '@/lib/searchStore'

const PROTO_MESSAGE_SOURCE = 'shomee-proto-quartiers'
const BG = '#FDF5F2'
const MIN_LOADING_DURATION = 3000
const MAX_LOADING_DURATION = 9000

interface ProtoMessage {
  source?: string
  action?: string
  selectedArrIds?: unknown
  selectedQuartierIds?: unknown
  selectedIrisIds?: unknown
  selectedCommuneIds?: unknown
  locationLabel?: unknown
  locationQuery?: unknown
}

interface Props {
  /** Recherche déjà saisie (issue du brief) — préremplit le champ du proto. */
  initialQuery?: string
  /** true → on ouvre directement la carte avec la zone déjà résolue. */
  startOnMap?: boolean
  onValidate: () => void
  onBack: () => void
}

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Caret clignotant (même système visuel que AIPreparationStep). */
function LoaderCaret() {
  return (
    <motion.span
      aria-hidden
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 0.9, repeat: Infinity, ease: 'linear', times: [0, 0.5, 0.5, 1] }}
      className="inline-block"
      style={{ color: '#A64B27' }}
    >
      ▋
    </motion.span>
  )
}

const LOADER_LABEL = 'Analyse de votre recherche et préparation de la carte'

function MapLoadingScreen() {
  const [typed, setTyped] = useState('')
  const typingDone = typed === LOADER_LABEL
  useEffect(() => {
    let i = 0
    const id = setInterval(() => {
      setTyped(LOADER_LABEL.slice(0, i))
      if (i >= LOADER_LABEL.length) {
        clearInterval(id)
        return
      }
      i += 1
    }, 30)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex flex-col h-full items-center justify-center px-8 text-center">
      <h2 className="text-[20px] font-bold text-neutral-900 mb-7">
        SHOMEE analyse votre recherche…
      </h2>
      <div className="h-6 flex items-center justify-center w-full max-w-[300px]">
        <span className="text-[13px] text-neutral-500 whitespace-nowrap">
          {typed}
          {typingDone && '...'}
          <LoaderCaret />
        </span>
      </div>
    </div>
  )
}

export default function QuartiersProtoFrame({
  initialQuery,
  startOnMap,
  onValidate,
  onBack,
}: Props) {
  // `_cb` : même nonce anti-cache que la WebView native, figé au montage pour
  // que l'iframe ne se recharge jamais toute seule.
  const [nonce] = useState(() => String(Date.now()))
  const src = useMemo(() => {
    const p = new URLSearchParams({ embed: '1', _cb: nonce })
    const q = initialQuery?.trim()
    if (q) {
      p.set('q', q)
      if (startOnMap) p.set('start', 'map')
    }
    return `/proto/quartiers?${p.toString()}`
  }, [nonce, initialQuery, startOnMap])

  // Écran d'attente : uniquement quand on ouvre directement la carte.
  const waitsForMap = !!startOnMap && !!initialQuery?.trim()
  const [revealed, setRevealed] = useState(!waitsForMap)
  const startedAtRef = useRef<number>(0)
  useEffect(() => {
    if (!waitsForMap) return
    startedAtRef.current = Date.now()
    // Filet de sécurité : on révèle quoi qu'il arrive au bout de 9 s.
    const t = setTimeout(() => setRevealed(true), MAX_LOADING_DURATION)
    return () => clearTimeout(t)
  }, [waitsForMap])

  const reveal = useCallback(() => {
    const elapsed = Date.now() - startedAtRef.current
    const remaining = Math.max(0, MIN_LOADING_DURATION - elapsed)
    window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => setRevealed(true)))
    }, remaining)
  }, [])

  // Refs pour que le listener `message` (monté une seule fois) voie toujours
  // les callbacks à jour.
  const onValidateRef = useRef(onValidate)
  const onBackRef = useRef(onBack)
  useEffect(() => {
    onValidateRef.current = onValidate
    onBackRef.current = onBack
  }, [onValidate, onBack])

  const handleMessage = useCallback(
    (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      const data = e.data as ProtoMessage | null
      if (!data || typeof data !== 'object' || data.source !== PROTO_MESSAGE_SOURCE) return

      if (data.action === 'ready') {
        reveal()
        return
      }
      if (data.action === 'back') {
        onBackRef.current()
        return
      }
      if (data.action !== 'validate') return

      // Même écriture que le natif (`useSearchStore.setState`) : on ne touche
      // qu'aux champs de zone, le reste du brief est inchangé.
      useSearchStore.setState({
        selectedArrIds: strArray(data.selectedArrIds),
        selectedQuartierIds: strArray(data.selectedQuartierIds),
        selectedIrisIds: strArray(data.selectedIrisIds),
        selectedCommuneIds: strArray(data.selectedCommuneIds),
        ...(typeof data.locationLabel === 'string' ? { locationLabel: data.locationLabel } : {}),
        ...(typeof data.locationQuery === 'string' ? { locationQuery: data.locationQuery } : {}),
      })
      onValidateRef.current()
    },
    [reveal],
  )

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  return (
    <div className="relative h-full w-full" style={{ background: BG }}>
      <iframe
        src={src}
        title="Où aimeriez-vous habiter ?"
        className="h-full w-full border-0"
        style={{
          display: 'block',
          background: BG,
          opacity: revealed ? 1 : 0,
          transition: 'opacity 180ms ease',
        }}
      />
      {!revealed && (
        <div className="absolute inset-0" style={{ background: BG }}>
          {waitsForMap && <MapLoadingScreen />}
        </div>
      )}
    </div>
  )
}
