'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DpeRating,
  GeneratedProperty,
  IngestResult,
  NumRange,
} from '@/lib/admin/tiktokStudioTypes'
import {
  VALID_DPE,
  ARRONDISSEMENT_LABELS,
  COMMUNES,
  matchZoneLabel,
  defaultPriceRange,
  defaultSurfaceRange,
  defaultRoomsRange,
} from '@/lib/admin/tiktokStudioTypes'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function errMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const o = data as { message?: unknown; error?: unknown }
    if (typeof o.message === 'string') return o.message
    if (typeof o.error === 'string') return o.error
  }
  return fallback
}

function fmtPrice(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k€` : `${n}€`
}

/** "Paris 8ème" → "8ème" pour des puces d'arrondissement compactes. */
function zoneShort(z: string): string {
  return z.startsWith('Paris ') ? z.slice(6) : z
}

/** Pool de concurrence : exécute `worker` sur chaque item, `n` en parallèle max. */
async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, n: number): Promise<void> {
  let idx = 0
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const cur = items[idx++]
      await worker(cur)
    }
  })
  await Promise.all(runners)
}

// ─────────────────────────────────────────────────────────────────────────────
// État par vidéo
// ─────────────────────────────────────────────────────────────────────────────

type ItemStatus = 'pending' | 'ingesting' | 'ok' | 'failed'

interface VideoItem {
  url: string
  status: ItemStatus
  error?: string
  ingest?: IngestResult
  existingInDb: number
  zones: Set<string>
  priceRange: NumRange
  surfaceRange: NumRange
  roomsRange: NumRange
  count: number
  properties: GeneratedProperty[]
  generating: boolean
  deriveError?: string
  creating: boolean
  createError?: string
  createdCount: number | null
}

function emptyItem(url: string): VideoItem {
  return {
    url,
    status: 'pending',
    existingInDb: 0,
    zones: new Set<string>(),
    priceRange: defaultPriceRange(null),
    surfaceRange: defaultSurfaceRange(null),
    roomsRange: defaultRoomsRange(null),
    count: 6,
    properties: [],
    generating: false,
    creating: false,
    createdCount: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Composant racine
// ─────────────────────────────────────────────────────────────────────────────

export default function TikTokStudioClient({ secret }: { secret: string }) {
  const [urlsText, setUrlsText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [items, setItems] = useState<VideoItem[]>([])

  // Ref pour lire l'état courant dans les callbacks async (évite les closures périmées).
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const headers = useMemo(
    () => ({ 'content-type': 'application/json', 'x-admin-secret': secret }),
    [secret],
  )

  // URLs uniques (dédup intra-liste) pour le libellé du bouton.
  const urlCount = useMemo(() => {
    const seen = new Set<string>()
    for (const raw of urlsText.split('\n')) {
      const u = raw.trim()
      if (u) seen.add(u)
    }
    return seen.size
  }, [urlsText])

  const patchItem = useCallback((i: number, patch: Partial<VideoItem>) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }, [])

  // ── Analyse batch ────────────────────────────────────────────────────────
  const analyzeAll = useCallback(async () => {
    if (analyzing) return
    // Parse + dédup intra-liste.
    const seen = new Set<string>()
    const urls: string[] = []
    for (const raw of urlsText.split('\n')) {
      const u = raw.trim()
      if (!u || seen.has(u)) continue
      seen.add(u)
      urls.push(u)
    }
    if (urls.length === 0) return

    setAnalyzing(true)
    const initial = urls.map(emptyItem)
    setItems(initial)

    await runPool(
      urls.map((_, i) => i),
      async (i) => {
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'ingesting' } : it)))
        try {
          const res = await fetch('/api/admin/ingest-tiktok', {
            method: 'POST',
            headers,
            body: JSON.stringify({ url: urls[i] }),
          })
          const data = await res.json()
          if (!res.ok) {
            setItems((prev) =>
              prev.map((it, idx) =>
                idx === i
                  ? { ...it, status: 'failed', error: errMessage(data, `Erreur ${res.status}`) }
                  : it,
              ),
            )
            return
          }
          const ingest = data as IngestResult
          const matched = matchZoneLabel(ingest.extracted?.arrondissement)
          setItems((prev) =>
            prev.map((it, idx) =>
              idx === i
                ? {
                    ...it,
                    status: 'ok',
                    ingest,
                    existingInDb: ingest.existingInDb ?? 0,
                    zones: new Set(matched ? [matched] : []),
                    priceRange: defaultPriceRange(ingest.extracted?.price),
                    surfaceRange: defaultSurfaceRange(ingest.extracted?.surface),
                    roomsRange: defaultRoomsRange(ingest.extracted?.rooms),
                  }
                : it,
            ),
          )
        } catch (e) {
          setItems((prev) =>
            prev.map((it, idx) =>
              idx === i
                ? { ...it, status: 'failed', error: e instanceof Error ? e.message : String(e) }
                : it,
            ),
          )
        }
      },
      3,
    )
    setAnalyzing(false)
  }, [urlsText, analyzing, headers])

  // ── Génération d'un item ───────────────────────────────────────────────────
  const generateItem = useCallback(
    async (i: number) => {
      const item = itemsRef.current[i]
      if (!item?.ingest || item.generating) return
      patchItem(i, { generating: true, deriveError: undefined })
      try {
        const res = await fetch('/api/admin/derive-properties', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            caption: item.ingest.caption,
            extracted: item.ingest.extracted,
            count: item.count,
            zones: Array.from(item.zones),
            priceRange: item.priceRange,
            surfaceRange: item.surfaceRange,
            roomsRange: item.roomsRange,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          patchItem(i, { deriveError: errMessage(data, `Erreur ${res.status}`) })
          return
        }
        const props = (data as { properties: GeneratedProperty[] }).properties
        patchItem(i, {
          properties: props,
          count: props.length,
          createdCount: null,
          createError: undefined,
        })
      } catch (e) {
        patchItem(i, { deriveError: e instanceof Error ? e.message : String(e) })
      } finally {
        patchItem(i, { generating: false })
      }
    },
    [patchItem, headers],
  )

  // ── Création d'un item ─────────────────────────────────────────────────────
  const createItem = useCallback(
    async (i: number) => {
      const item = itemsRef.current[i]
      if (!item?.ingest || item.properties.length === 0 || item.creating || item.createdCount != null)
        return
      patchItem(i, { creating: true, createError: undefined })
      try {
        const res = await fetch('/api/admin/create-properties', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            properties: item.properties,
            videoUrl: item.ingest.videoUrl,
            imageUrlFallback: item.ingest.thumbnailUrl,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          patchItem(i, { createError: errMessage(data, `Erreur ${res.status}`) })
          return
        }
        patchItem(i, { createdCount: (data as { count: number }).count })
      } catch (e) {
        patchItem(i, { createError: e instanceof Error ? e.message : String(e) })
      } finally {
        patchItem(i, { creating: false })
      }
    },
    [patchItem, headers],
  )

  const generateAll = useCallback(async () => {
    const idxs = itemsRef.current
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.status === 'ok' && it.properties.length === 0 && !it.generating)
      .map(({ i }) => i)
    await runPool(idxs, (i) => generateItem(i), 2)
  }, [generateItem])

  const createAll = useCallback(async () => {
    const idxs = itemsRef.current
      .map((it, i) => ({ it, i }))
      .filter(
        ({ it }) =>
          it.status === 'ok' && it.properties.length > 0 && it.createdCount == null && !it.creating,
      )
      .map(({ i }) => i)
    await runPool(idxs, (i) => createItem(i), 2)
  }, [createItem])

  // ── Compteurs dérivés ──────────────────────────────────────────────────────
  const okCount = items.filter((i) => i.status === 'ok').length
  const failedCount = items.filter((i) => i.status === 'failed').length
  const pendingCount = items.filter((i) => i.status === 'pending' || i.status === 'ingesting').length
  const proposedTotal = items.reduce((n, i) => n + i.properties.length, 0)
  const createdTotal = items.reduce((n, i) => n + (i.createdCount ?? 0), 0)
  const canGenerateAll = items.some((i) => i.status === 'ok' && i.properties.length === 0)
  const canCreateAll = items.some(
    (i) => i.status === 'ok' && i.properties.length > 0 && i.createdCount == null,
  )
  const busy = items.some((i) => i.generating || i.creating)

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">TikTok Studio — biens de démo</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Colle une ou plusieurs URLs TikTok (une par ligne) → analyse → propose N biens
            dérivés par vidéo → valide/édite → crée en base (isDemoData). Les échecs de download
            n&apos;affectent que leur ligne ; les URLs en double sont ignorées.
          </p>
        </header>

        {/* Saisie multi-URL */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <textarea
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={'Une URL TikTok par ligne (colle jusqu’à ~50)…'}
            rows={items.length > 0 ? 2 : 4}
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-xs outline-none focus:border-neutral-500"
          />
          <button
            onClick={analyzeAll}
            disabled={analyzing || urlCount === 0}
            className="h-10 shrink-0 rounded-lg bg-white px-4 text-sm font-medium text-neutral-900 disabled:opacity-40"
          >
            {analyzing ? 'Analyse…' : `Analyser${urlCount > 1 ? ` (${urlCount})` : ''}`}
          </button>
        </div>

        {/* Barre batch (multi-vidéos) */}
        {items.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm">
            <span className="text-neutral-300">
              {okCount} ok
              {failedCount > 0 && <span className="text-red-400"> · {failedCount} échec{failedCount > 1 ? 's' : ''}</span>}
              {pendingCount > 0 && <span className="text-neutral-500"> · {pendingCount} en cours…</span>}
            </span>
            <span className="text-neutral-500">
              {proposedTotal} proposés · {createdTotal} créés
            </span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={generateAll}
                disabled={!canGenerateAll || busy}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Tout générer
              </button>
              <button
                onClick={createAll}
                disabled={!canCreateAll || busy}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Tout créer
              </button>
            </div>
          </div>
        )}

        {/* Panneaux vidéo */}
        <div className="mt-6 space-y-6">
          {items.map((it, i) => (
            <VideoPanel
              key={it.url}
              item={it}
              patch={(p) => patchItem(i, p)}
              onGenerate={() => generateItem(i)}
              onCreate={() => createItem(i)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Panneau d'une vidéo
// ─────────────────────────────────────────────────────────────────────────────

function VideoPanel({
  item,
  patch,
  onGenerate,
  onCreate,
}: {
  item: VideoItem
  patch: (p: Partial<VideoItem>) => void
  onGenerate: () => void
  onCreate: () => void
}) {
  if (item.status === 'failed') {
    return (
      <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-4">
        <div className="truncate text-sm text-neutral-300">{item.url}</div>
        <div className="mt-1 text-xs text-red-300">✗ {item.error}</div>
      </div>
    )
  }
  if (item.status !== 'ok' || !item.ingest) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="truncate text-sm text-neutral-400">{item.url}</div>
        <div className="mt-1 text-xs text-neutral-500">
          {item.status === 'ingesting' ? 'Analyse en cours…' : 'En attente…'}
        </div>
      </div>
    )
  }

  const ingest = item.ingest

  const toggleZone = (z: string) => {
    const next = new Set(item.zones)
    if (next.has(z)) next.delete(z)
    else next.add(z)
    patch({ zones: next })
  }
  const updateProperty = (idx: number, p: Partial<GeneratedProperty>) =>
    patch({ properties: item.properties.map((pp, ii) => (ii === idx ? { ...pp, ...p } : pp)) })
  const removeProperty = (idx: number) =>
    patch({ properties: item.properties.filter((_, ii) => ii !== idx) })

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        {/* Vidéo + source */}
        <div>
          <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
            <video
              src={ingest.videoUrl}
              poster={ingest.thumbnailUrl}
              controls
              playsInline
              className="aspect-[9/16] w-full bg-black"
            />
          </div>
          <div className="mt-2 text-xs text-neutral-400">
            {ingest.source.handle ? `@${ingest.source.handle}` : 'source inconnue'} ·{' '}
            {ingest.extracted.arrondissement}
          </div>
          {item.existingInDb > 0 && (
            <div className="mt-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">
              ⚠ Déjà {item.existingInDb} bien{item.existingInDb > 1 ? 's' : ''} en base pour cette
              vidéo (dédup).
            </div>
          )}
          <details className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-xs">
            <summary className="cursor-pointer text-neutral-300">Caption &amp; champs extraits</summary>
            <p className="mt-2 whitespace-pre-wrap text-neutral-400">{ingest.caption || '(vide)'}</p>
            <pre className="mt-2 overflow-x-auto text-[11px] text-neutral-500">
              {JSON.stringify(ingest.extracted, null, 2)}
            </pre>
          </details>
        </div>

        {/* Zones + génération + cards */}
        <div>
          {/* Zones autorisées */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-300">
                Zones autorisées{' '}
                <span className="text-neutral-500">({item.zones.size})</span>
              </span>
              <span className="text-xs text-neutral-500">génération = uniquement ces zones</span>
            </div>
            <div className="mt-2 text-[11px] uppercase tracking-wide text-neutral-500">
              Arrondissements
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ARRONDISSEMENT_LABELS.map((z) => (
                <ZoneChip
                  key={z}
                  label={zoneShort(z)}
                  checked={item.zones.has(z)}
                  onClick={() => toggleZone(z)}
                />
              ))}
            </div>
            <div className="mt-3 text-[11px] uppercase tracking-wide text-neutral-500">
              Communes limitrophes
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {COMMUNES.map((z) => (
                <ZoneChip
                  key={z}
                  label={z}
                  checked={item.zones.has(z)}
                  onClick={() => toggleZone(z)}
                />
              ))}
            </div>
            {item.zones.size === 0 && (
              <p className="mt-2 text-[11px] text-amber-400/80">
                Aucune zone cochée : variété libre.
              </p>
            )}
          </div>

          {/* Fourchettes — pré-réglées sur ce que l'analyse a détecté */}
          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-300">Fourchettes</span>
              <span className="text-xs text-neutral-500">
                pré-réglées sur la vidéo · bornent la génération
              </span>
            </div>
            <div className="mt-2 space-y-2">
              <RangeRow
                label="Prix"
                unit="€"
                step={50000}
                range={item.priceRange}
                onChange={(r) => patch({ priceRange: r })}
              />
              <RangeRow
                label="Surface"
                unit="m²"
                step={5}
                range={item.surfaceRange}
                onChange={(r) => patch({ surfaceRange: r })}
              />
              <RangeRow
                label="Pièces"
                unit="p."
                step={1}
                range={item.roomsRange}
                onChange={(r) => patch({ roomsRange: r })}
              />
            </div>
          </div>

          {/* Génération */}
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            <span className="text-sm text-neutral-300">Biens :</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => patch({ count: Math.max(1, item.count - 1) })}
                className="h-8 w-8 rounded-lg border border-neutral-700 text-lg leading-none"
              >
                −
              </button>
              <span className="w-8 text-center text-sm tabular-nums">{item.count}</span>
              <button
                onClick={() => patch({ count: Math.min(14, item.count + 1) })}
                className="h-8 w-8 rounded-lg border border-neutral-700 text-lg leading-none"
              >
                +
              </button>
            </div>
            <button
              onClick={onGenerate}
              disabled={item.generating}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
            >
              {item.generating ? 'Génération…' : item.properties.length ? 'Régénérer' : 'Générer'}
            </button>
          </div>
          {item.deriveError && (
            <p className="mt-2 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {item.deriveError}
            </p>
          )}

          {/* Cards */}
          <div className="mt-3 space-y-3">
            {item.properties.map((p, i) => (
              <PropertyCard
                key={i}
                index={i}
                property={p}
                onChange={(patchP) => updateProperty(i, patchP)}
                onRemove={() => removeProperty(i)}
              />
            ))}
          </div>

          {/* Création */}
          {item.properties.length > 0 && (
            <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              {item.createdCount != null ? (
                <p className="text-sm text-emerald-300">
                  ✓ {item.createdCount} bien{item.createdCount > 1 ? 's' : ''} créé
                  {item.createdCount > 1 ? 's' : ''} en base (isDemoData).
                </p>
              ) : (
                <>
                  <button
                    onClick={onCreate}
                    disabled={item.creating}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {item.creating
                      ? 'Création…'
                      : `Valider et créer ${item.properties.length} bien${
                          item.properties.length > 1 ? 's' : ''
                        }`}
                  </button>
                  <p className="mt-2 text-xs text-neutral-500">
                    isDemoData: true · statut PUBLISHED · adresse incluse. Purgeable via isDemoData.
                  </p>
                  {item.createError && (
                    <p className="mt-2 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                      {item.createError}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Card éditable
// ─────────────────────────────────────────────────────────────────────────────

function PropertyCard({
  index,
  property,
  onChange,
  onRemove,
}: {
  index: number
  property: GeneratedProperty
  onChange: (patch: Partial<GeneratedProperty>) => void
  onRemove: () => void
}) {
  const p = property
  const numPatch = (key: keyof GeneratedProperty) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    onChange({ [key]: Number.isFinite(v) ? v : 0 } as Partial<GeneratedProperty>)
  }
  const strPatch =
    (key: keyof GeneratedProperty) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ [key]: e.target.value } as Partial<GeneratedProperty>)

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="rounded bg-neutral-800 px-2 py-0.5 tabular-nums">#{index + 1}</span>
          <span>
            {p.surface} m² · {p.rooms}P · {fmtPrice(p.price)}
          </span>
        </div>
        <button
          onClick={onRemove}
          className="text-xs text-neutral-500 hover:text-red-400"
          title="Retirer ce bien"
        >
          retirer
        </button>
      </div>

      <input
        value={p.title}
        onChange={strPatch('title')}
        className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm font-medium outline-none focus:border-neutral-500"
      />

      <label className="mb-2 block">
        <span className="mb-1 block text-[11px] text-neutral-500">Adresse exacte (back-office)</span>
        <input
          value={p.address}
          onChange={strPatch('address')}
          placeholder="12 rue Saint-Dominique, 75007 Paris"
          className={inputCls}
        />
      </label>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Arrondissement / commune">
          <input value={p.arrondissement} onChange={strPatch('arrondissement')} className={inputCls} />
        </Field>
        <Field label="Quartier">
          <input value={p.district} onChange={strPatch('district')} className={inputCls} />
        </Field>
        <Field label="Prix (€)">
          <input type="number" value={p.price} onChange={numPatch('price')} className={inputCls} />
        </Field>
        <Field label="Surface (m²)">
          <input type="number" value={p.surface} onChange={numPatch('surface')} className={inputCls} />
        </Field>
        <Field label="Pièces">
          <input type="number" value={p.rooms} onChange={numPatch('rooms')} className={inputCls} />
        </Field>
        <Field label="Chambres">
          <input type="number" value={p.bedrooms} onChange={numPatch('bedrooms')} className={inputCls} />
        </Field>
        <Field label="Étage">
          <input type="number" value={p.floor} onChange={numPatch('floor')} className={inputCls} />
        </Field>
        <Field label="DPE">
          <select
            value={p.dpe}
            onChange={(e) => onChange({ dpe: e.target.value as DpeRating })}
            className={inputCls}
          >
            {VALID_DPE.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="GES">
          <select
            value={p.ges}
            onChange={(e) => onChange({ ges: e.target.value as DpeRating })}
            className={inputCls}
          >
            {VALID_DPE.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        {p.hasTerrace && <Chip>terrasse{p.terraceSurfaceM2 ? ` ${p.terraceSurfaceM2}m²` : ''}</Chip>}
        {p.hasBalcony && <Chip>balcon</Chip>}
        {p.hasGarden && <Chip>jardin</Chip>}
        {p.hasParking && <Chip>parking</Chip>}
        {p.hasElevator && <Chip>ascenseur</Chip>}
        {p.hasConcierge && <Chip>gardien</Chip>}
        {p.hasCellar && <Chip>cave</Chip>}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-neutral-500">Description &amp; détails</summary>
        <textarea
          value={p.description}
          onChange={strPatch('description')}
          rows={3}
          className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
        />
        <div className="mt-2 text-[11px] text-neutral-500">
          Quartier (vibe) : {p.neighborhoodVibe || '—'} · année {p.yearBuilt} · charges{' '}
          {p.monthlyCharges}€/mois · orientation {p.orientationStructured.join('/') || '—'}
        </div>
      </details>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-neutral-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-neutral-500">{label}</span>
      {children}
    </label>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300">
      {children}
    </span>
  )
}

function ZoneChip({
  label,
  checked,
  onClick,
}: {
  label: string
  checked: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={
        'rounded-full border px-2.5 py-1 text-xs transition-colors ' +
        (checked
          ? 'border-white bg-white font-medium text-neutral-900'
          : 'border-neutral-700 bg-neutral-950 text-neutral-400 hover:border-neutral-500')
      }
    >
      {label}
    </button>
  )
}

function RangeRow({
  label,
  unit,
  step,
  range,
  onChange,
}: {
  label: string
  unit: string
  step: number
  range: NumRange
  onChange: (r: NumRange) => void
}) {
  const numInput =
    'w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs tabular-nums outline-none focus:border-neutral-500'
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-neutral-400">{label}</span>
      <input
        type="number"
        value={range.min}
        step={step}
        onChange={(e) => onChange({ min: Number(e.target.value), max: range.max })}
        className={numInput}
      />
      <span className="text-neutral-600">–</span>
      <input
        type="number"
        value={range.max}
        step={step}
        onChange={(e) => onChange({ min: range.min, max: Number(e.target.value) })}
        className={numInput}
      />
      <span className="text-[11px] text-neutral-500">{unit}</span>
    </div>
  )
}
