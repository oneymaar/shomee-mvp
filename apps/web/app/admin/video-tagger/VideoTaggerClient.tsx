'use client'

import { useEffect, useMemo, useState } from 'react'

// ─── Domain types ────────────────────────────────────────────────────────

type AdminChapter = { label: string; startSec: number }

type VideoTag = {
  videoId: string
  videoUrl: string
  arrondissements: number[]
  communes: string[]
  rooms: number[]
  bedrooms: number[]
  priceRange: [number, number]
  surfaceRange: [number, number]
}

type AdminVideo = {
  id: string
  title: string
  address: string
  videoUrl: string
  videoId: string
  surface: number
  price: number
  rooms: number
  bedrooms: number | null
  chapitres: AdminChapter[] | null
  existingTags: VideoTag | null
}

// State per video — sliders stored as indices into the step arrays for
// stable slider math; we map back to real values when serializing to JSON.
type VideoState = {
  videoId: string
  videoUrl: string
  arrondissements: number[]
  communes: string[]
  rooms: number[]
  bedrooms: number[]
  priceMinIdx: number
  priceMaxIdx: number
  surfMinIdx: number
  surfMaxIdx: number
}

// ─── Domain constants ────────────────────────────────────────────────────

const PRICE_STEPS = [
  0, 100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000,
  1000000, 1250000, 1500000, 1750000, 2000000, 2500000, 3000000, 4000000,
  5000000, 7000000, 10000000,
]

const SURF_STEPS = [
  0, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 250, 300,
  350, 400, 500,
]

const ARRONDISSEMENTS = Array.from({ length: 20 }, (_, i) => i + 1)

const COMMUNES = [
  'Neuilly-sur-Seine',
  'Levallois-Perret',
  'Boulogne-Billancourt',
  'Issy-les-Moulineaux',
  'Vincennes',
  'Saint-Mandé',
  'Saint-Cloud',
  'Sèvres',
  'Meudon',
  'Vanves',
  'Malakoff',
  'Montrouge',
  'Gentilly',
  'Ivry-sur-Seine',
  'Charenton-le-Pont',
  'Saint-Maurice',
]

const ROOMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const ROOM_LABELS = ['Studio', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p+']

const BEDROOMS = [1, 2, 3, 4, 5, 6]
const BEDROOM_LABELS = ['1ch', '2ch', '3ch', '4ch', '5ch', '6ch+']

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatPrice(value: number): string {
  if (value === 0) return '0 €'
  const cap = PRICE_STEPS[PRICE_STEPS.length - 1]
  const suffix = value >= cap ? '+' : ''
  if (value >= 1_000_000) {
    const m = value / 1_000_000
    const text = Number.isInteger(m) ? m.toString() : m.toFixed(1).replace(/\.0$/, '')
    return `${text} M€${suffix}`
  }
  return `${Math.round(value / 1000)} K€${suffix}`
}

function formatSurface(value: number): string {
  const cap = SURF_STEPS[SURF_STEPS.length - 1]
  return value >= cap ? `${value} m²+` : `${value} m²`
}

function valueToIdx(steps: number[], value: number): number {
  let best = 0
  let diff = Infinity
  for (let i = 0; i < steps.length; i++) {
    const d = Math.abs(steps[i] - value)
    if (d < diff) {
      diff = d
      best = i
    }
  }
  return best
}

function defaultStateFor(v: AdminVideo): VideoState {
  if (v.existingTags) {
    return {
      videoId: v.videoId,
      videoUrl: v.videoUrl,
      arrondissements: [...v.existingTags.arrondissements],
      communes: [...v.existingTags.communes],
      rooms: [...v.existingTags.rooms],
      bedrooms: [...v.existingTags.bedrooms],
      priceMinIdx: valueToIdx(PRICE_STEPS, v.existingTags.priceRange[0]),
      priceMaxIdx: valueToIdx(PRICE_STEPS, v.existingTags.priceRange[1]),
      surfMinIdx: valueToIdx(SURF_STEPS, v.existingTags.surfaceRange[0]),
      surfMaxIdx: valueToIdx(SURF_STEPS, v.existingTags.surfaceRange[1]),
    }
  }
  return {
    videoId: v.videoId,
    videoUrl: v.videoUrl,
    arrondissements: [],
    communes: [],
    rooms: [],
    bedrooms: [],
    priceMinIdx: 0,
    priceMaxIdx: PRICE_STEPS.length - 1,
    surfMinIdx: 0,
    surfMaxIdx: SURF_STEPS.length - 1,
  }
}

function stateToTag(s: VideoState): VideoTag {
  return {
    videoId: s.videoId,
    videoUrl: s.videoUrl,
    arrondissements: [...s.arrondissements].sort((a, b) => a - b),
    communes: [...s.communes],
    rooms: [...s.rooms].sort((a, b) => a - b),
    bedrooms: [...s.bedrooms].sort((a, b) => a - b),
    priceRange: [PRICE_STEPS[s.priceMinIdx], PRICE_STEPS[s.priceMaxIdx]],
    surfaceRange: [SURF_STEPS[s.surfMinIdx], SURF_STEPS[s.surfMaxIdx]],
  }
}

function isConfigured(s: VideoState): boolean {
  return s.arrondissements.length > 0 || s.communes.length > 0
}

// ─── Reusable bits ───────────────────────────────────────────────────────

const SELECTED = 'bg-[#C1533A] text-white border-[#C1533A]'
const UNSELECTED = 'bg-neutral-900 text-neutral-300 border-neutral-700 hover:border-neutral-500'

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active ? SELECTED : UNSELECTED
      }`}
    >
      {children}
    </button>
  )
}

function RangeSlider({
  label,
  steps,
  minIdx,
  maxIdx,
  onChange,
  format,
}: {
  label: string
  steps: number[]
  minIdx: number
  maxIdx: number
  onChange: (next: { minIdx: number; maxIdx: number }) => void
  format: (value: number) => string
}) {
  const last = steps.length - 1
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
        <span className="font-mono text-xs text-neutral-200">
          {format(steps[minIdx])} → {format(steps[maxIdx])}
        </span>
      </div>
      <div className="space-y-2">
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={minIdx}
          onChange={(e) => {
            const v = Number(e.currentTarget.value)
            onChange({ minIdx: Math.min(v, maxIdx), maxIdx })
          }}
          className="w-full accent-[#C1533A]"
        />
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={maxIdx}
          onChange={(e) => {
            const v = Number(e.currentTarget.value)
            onChange({ minIdx, maxIdx: Math.max(v, minIdx) })
          }}
          className="w-full accent-[#C1533A]"
        />
      </div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────

export default function VideoTaggerClient({ secret }: { secret: string }) {
  const [videos, setVideos] = useState<AdminVideo[] | null>(null)
  const [states, setStates] = useState<VideoState[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState<'id' | 'json' | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/admin/videos', { headers: { 'x-admin-secret': secret } })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data = (await res.json()) as { videos: AdminVideo[] }
        if (cancelled) return
        setVideos(data.videos)
        setStates(data.videos.map(defaultStateFor))
      } catch (error) {
        if (!cancelled) setLoadError(String(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [secret])

  const tags = useMemo(() => states.map(stateToTag), [states])
  const jsonText = useMemo(() => JSON.stringify(tags, null, 2), [tags])
  const configuredCount = useMemo(
    () => states.filter(isConfigured).length,
    [states],
  )

  function patchActive(patch: Partial<VideoState>) {
    setStates((prev) =>
      prev.map((s, i) => (i === activeIdx ? { ...s, ...patch } : s)),
    )
  }

  function toggleNumber(list: number[], value: number): number[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  function toggleString(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  async function copyText(text: string, kind: 'id' | 'json') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied((cur) => (cur === kind ? null : cur)), 1200)
    } catch {
      // ignore
    }
  }

  async function save() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch(
        '/api/admin/video-tags',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
          body: JSON.stringify(tags),
        },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { success: boolean; count: number }
      setSaveMsg(
        `✓ Sauvegardé (${data.count} entrées) — pensez à commiter video-tags.json`,
      )
    } catch (error) {
      setSaveMsg(`✗ Échec : ${String(error)}`)
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 6000)
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-8">
        <p className="text-red-400">Erreur de chargement : {loadError}</p>
      </main>
    )
  }

  if (!videos || states.length === 0) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-8">
        <p className="text-neutral-400">Chargement…</p>
      </main>
    )
  }

  const total = videos.length
  const safeIdx = Math.min(activeIdx, total - 1)
  const video = videos[safeIdx]
  const state = states[safeIdx]

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-8">
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">
            Vidéo {safeIdx + 1}/{total}
          </h1>
          <div className="flex gap-1.5">
            {states.map((s, i) => (
              <button
                key={s.videoId}
                type="button"
                onClick={() => setActiveIdx(i)}
                title={`Vidéo ${i + 1}${isConfigured(s) ? ' (configurée)' : ''}`}
                className={`h-2.5 w-2.5 rounded-full ${
                  i === safeIdx
                    ? 'bg-amber-300'
                    : isConfigured(s)
                      ? 'bg-emerald-500'
                      : 'bg-neutral-700'
                }`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
            disabled={safeIdx === 0}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500 disabled:opacity-40"
          >
            ← Précédente
          </button>
          <button
            type="button"
            onClick={() => setActiveIdx((i) => Math.min(total - 1, i + 1))}
            disabled={safeIdx === total - 1}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500 disabled:opacity-40"
          >
            Suivante →
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-amber-400 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-amber-300 disabled:opacity-50"
          >
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
        </div>
      </header>

      {saveMsg && (
        <div className="mb-3 rounded-md bg-neutral-900 px-3 py-2 text-sm text-neutral-200 ring-1 ring-neutral-800">
          {saveMsg}
        </div>
      )}

      {/* Two-column layout */}
      <section className="grid gap-6 md:grid-cols-[320px_1fr]">
        {/* Left — video */}
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl bg-black ring-1 ring-neutral-800">
            <video
              key={video.videoUrl}
              src={video.videoUrl}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              className="h-[480px] w-full object-cover"
            />
          </div>
          <button
            type="button"
            onClick={() => copyText(video.videoId, 'id')}
            title="Cliquer pour copier"
            className="block w-full break-all rounded-md bg-neutral-900 px-2 py-1.5 text-left font-mono text-[11px] text-amber-300 ring-1 ring-neutral-800 hover:text-amber-200"
          >
            {copied === 'id' ? '✓ copié' : video.videoId}
          </button>
          <div className="text-xs text-neutral-400">
            <p className="font-medium text-neutral-200">{video.title}</p>
            <p>{video.address}</p>
            <p className="text-neutral-500">
              {video.surface} m² · {video.rooms}p
              {video.bedrooms != null ? ` · ${video.bedrooms} ch` : ''} ·{' '}
              {new Intl.NumberFormat('fr-FR').format(video.price)} €
            </p>
            {video.chapitres && video.chapitres.length > 0 && (
              <ul className="mt-2 list-inside list-disc space-y-0.5">
                {video.chapitres.map((c, i) => (
                  <li key={i}>{c.label}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right — form */}
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-400">
              Arrondissements Paris
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {ARRONDISSEMENTS.map((n) => (
                <Chip
                  key={n}
                  active={state.arrondissements.includes(n)}
                  onClick={() =>
                    patchActive({
                      arrondissements: toggleNumber(state.arrondissements, n),
                    })
                  }
                >
                  {n === 1 ? '1er' : `${n}e`}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-400">
              Communes limitrophes
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {COMMUNES.map((c) => (
                <Chip
                  key={c}
                  active={state.communes.includes(c)}
                  onClick={() =>
                    patchActive({ communes: toggleString(state.communes, c) })
                  }
                >
                  {c}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-400">
                Pièces
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {ROOMS.map((n, i) => (
                  <Chip
                    key={n}
                    active={state.rooms.includes(n)}
                    onClick={() => patchActive({ rooms: toggleNumber(state.rooms, n) })}
                  >
                    {ROOM_LABELS[i]}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-400">
                Chambres
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {BEDROOMS.map((n, i) => (
                  <Chip
                    key={n}
                    active={state.bedrooms.includes(n)}
                    onClick={() =>
                      patchActive({ bedrooms: toggleNumber(state.bedrooms, n) })
                    }
                  >
                    {BEDROOM_LABELS[i]}
                  </Chip>
                ))}
              </div>
            </div>
          </div>

          <RangeSlider
            label="Prix"
            steps={PRICE_STEPS}
            minIdx={state.priceMinIdx}
            maxIdx={state.priceMaxIdx}
            onChange={({ minIdx, maxIdx }) =>
              patchActive({ priceMinIdx: minIdx, priceMaxIdx: maxIdx })
            }
            format={formatPrice}
          />

          <RangeSlider
            label="Surface"
            steps={SURF_STEPS}
            minIdx={state.surfMinIdx}
            maxIdx={state.surfMaxIdx}
            onChange={({ minIdx, maxIdx }) =>
              patchActive({ surfMinIdx: minIdx, surfMaxIdx: maxIdx })
            }
            format={formatSurface}
          />
        </div>
      </section>

      {/* JSON */}
      <section className="mt-10">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-200">
            JSON global — {configuredCount}/{total} vidéos configurées
          </h2>
          <button
            type="button"
            onClick={() => copyText(jsonText, 'json')}
            className="rounded-md bg-amber-400 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-amber-300"
          >
            {copied === 'json' ? '✓ copié' : 'Copier tout'}
          </button>
        </div>
        <textarea
          readOnly
          value={jsonText}
          spellCheck={false}
          className="block h-80 w-full resize-y rounded-lg bg-neutral-900 p-3 font-mono text-xs text-neutral-200 ring-1 ring-neutral-800"
        />
        <p className="mt-2 text-xs text-neutral-500">
          ⚠️ Sur Vercel, l&apos;écriture est éphémère. Après <em>Sauvegarder</em>, copier
          ce JSON et commiter <code className="mx-1 rounded bg-neutral-900 px-1">src/data/video-tags.json</code>.
        </p>
      </section>
    </main>
  )
}
