'use client'

import { useMemo, useState } from 'react'

export type VideoEntry = {
  propertyId: string
  videoId: string
  videoUrl: string
  title: string
  location: string
  surface: number
  price: number
  rooms: number
  chapters: string[]
}

type TagEntry = {
  videoId: string
  arrondissements: string[]
  priceRange: [number, number]
  surfaceRange: [number, number]
  ambiance: string[]
}

function buildPrefilledJson(videos: VideoEntry[]): string {
  const entries: TagEntry[] = videos.map((v) => ({
    videoId: v.videoId,
    arrondissements: [],
    priceRange: [0, 0],
    surfaceRange: [0, 0],
    ambiance: [],
  }))
  return JSON.stringify(entries, null, 2)
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n) + ' €'
}

export default function VideoTaggerClient({ videos }: { videos: VideoEntry[] }) {
  const prefilledJson = useMemo(() => buildPrefilledJson(videos), [videos])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [jsonCopied, setJsonCopied] = useState(false)

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(key)
      setTimeout(() => setCopiedId((cur) => (cur === key ? null : cur)), 1200)
    } catch {
      // Clipboard refused — fall back to selecting the textarea.
    }
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(prefilledJson)
      setJsonCopied(true)
      setTimeout(() => setJsonCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Video tagger</h1>
        <p className="text-sm text-neutral-400">{videos.length} vidéos avec analyse</p>
      </header>

      <section className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
        {videos.map((v) => (
          <article
            key={v.propertyId}
            className="flex flex-col rounded-xl bg-neutral-900 ring-1 ring-neutral-800 overflow-hidden"
          >
            <div className="relative bg-black" style={{ height: 400 }}>
              <video
                src={v.videoUrl}
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="p-3 space-y-2">
              <button
                type="button"
                onClick={() => copyText(v.videoId, v.propertyId)}
                title="Cliquer pour copier"
                className="block w-full text-left font-mono text-[11px] text-amber-300 hover:text-amber-200 break-all"
              >
                {copiedId === v.propertyId ? '✓ copié' : v.videoId}
              </button>
              <h2 className="text-sm font-medium leading-snug">{v.title}</h2>
              <p className="text-xs text-neutral-400">{v.location}</p>
              <p className="text-xs text-neutral-500">
                {v.surface} m² · {v.rooms}p · {formatPrice(v.price)}
              </p>
              {v.chapters.length > 0 && (
                <ul className="pt-1 text-[11px] text-neutral-400 list-disc list-inside space-y-0.5">
                  {v.chapters.map((label, i) => (
                    <li key={i}>{label}</li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="mt-12">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">JSON pré-rempli</h2>
          <button
            type="button"
            onClick={copyJson}
            className="rounded-md bg-amber-400 text-neutral-950 px-3 py-1.5 text-sm font-medium hover:bg-amber-300"
          >
            {jsonCopied ? '✓ copié' : 'Copier'}
          </button>
        </div>
        <textarea
          readOnly
          value={prefilledJson}
          spellCheck={false}
          className="block w-full h-96 rounded-lg bg-neutral-900 ring-1 ring-neutral-800 p-3 font-mono text-xs text-neutral-200 resize-y"
        />
        <p className="mt-2 text-xs text-neutral-500">
          Copier ce JSON, remplir les champs en regardant chaque vidéo, puis sauvegarder dans
          <code className="mx-1 rounded bg-neutral-900 px-1 py-0.5">src/data/video-tags.json</code>.
        </p>
      </section>
    </main>
  )
}
