'use client'

import { useCallback, useState } from 'react'
import type {
  DpeRating,
  GeneratedProperty,
  IngestResult,
} from '@/lib/admin/tiktokStudioTypes'
import {
  VALID_DPE,
  ARRONDISSEMENT_LABELS,
  COMMUNES,
  matchZoneLabel,
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

// ─────────────────────────────────────────────────────────────────────────────
// Composant
// ─────────────────────────────────────────────────────────────────────────────

export default function TikTokStudioClient({ secret }: { secret: string }) {
  const [url, setUrl] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [ingestError, setIngestError] = useState<string | null>(null)
  const [ingest, setIngest] = useState<IngestResult | null>(null)

  const [count, setCount] = useState(6)
  const [generating, setGenerating] = useState(false)
  const [deriveError, setDeriveError] = useState<string | null>(null)
  const [properties, setProperties] = useState<GeneratedProperty[]>([])

  // Zones autorisées pour la génération (arrondissements/communes cochés).
  // Pré-coché sur la zone réelle de la vidéo après analyse.
  const [zones, setZones] = useState<Set<string>>(new Set())

  const toggleZone = useCallback((z: string) => {
    setZones((prev) => {
      const next = new Set(prev)
      if (next.has(z)) next.delete(z)
      else next.add(z)
      return next
    })
  }, [])

  // Jalon 3 — write en base.
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdCount, setCreatedCount] = useState<number | null>(null)

  const headers = {
    'content-type': 'application/json',
    'x-admin-secret': secret,
  }

  const analyze = useCallback(async () => {
    if (!url.trim() || analyzing) return
    setAnalyzing(true)
    setIngestError(null)
    setIngest(null)
    setProperties([])
    setZones(new Set())
    setCreatedCount(null)
    setCreateError(null)
    try {
      const res = await fetch('/api/admin/ingest-tiktok', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setIngestError(errMessage(data, `Erreur ${res.status}`))
        return
      }
      const result = data as IngestResult
      setIngest(result)
      // Pré-coche la zone réelle déduite de la caption (arrondissement affiché
      // à l'écran dans la vidéo). Olivier valide ou en ajoute d'autres.
      const matched = matchZoneLabel(result.extracted?.arrondissement)
      setZones(new Set(matched ? [matched] : []))
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, analyzing, secret])

  const generate = useCallback(async () => {
    if (!ingest || generating) return
    setGenerating(true)
    setDeriveError(null)
    setCreatedCount(null)
    setCreateError(null)
    try {
      const res = await fetch('/api/admin/derive-properties', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          caption: ingest.caption,
          extracted: ingest.extracted,
          count,
          zones: Array.from(zones),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDeriveError(errMessage(data, `Erreur ${res.status}`))
        return
      }
      const props = (data as { properties: GeneratedProperty[] }).properties
      setProperties(props)
      setCount(props.length)
    } catch (e) {
      setDeriveError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingest, generating, count, zones, secret])

  const createProperties = useCallback(async () => {
    if (!ingest || properties.length === 0 || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/admin/create-properties', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties,
          videoUrl: ingest.videoUrl,
          imageUrlFallback: ingest.thumbnailUrl,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(errMessage(data, `Erreur ${res.status}`))
        return
      }
      setCreatedCount((data as { count: number }).count)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingest, properties, creating, secret])

  const updateProperty = useCallback(
    (idx: number, patch: Partial<GeneratedProperty>) => {
      setProperties((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
    },
    [],
  )

  const removeProperty = useCallback((idx: number) => {
    setProperties((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">TikTok Studio — biens de démo</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Colle une URL TikTok → analyse → propose N biens dérivés. Aucun bien n&apos;est
            écrit en base à ce stade (Jalons 1 &amp; 2).
          </p>
        </header>

        {/* Barre URL */}
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') analyze()
            }}
            placeholder="https://www.tiktok.com/@agence/video/…"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <button
            onClick={analyze}
            disabled={analyzing || !url.trim()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
          >
            {analyzing ? 'Analyse…' : 'Analyser'}
          </button>
        </div>
        {ingestError && (
          <p className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {ingestError}
          </p>
        )}

        {ingest && (
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
            {/* Colonne gauche — vidéo source + infos extraites */}
            <div className="lg:sticky lg:top-6 lg:self-start">
              <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
                <video
                  src={ingest.videoUrl}
                  poster={ingest.thumbnailUrl}
                  controls
                  playsInline
                  className="aspect-[9/16] w-full bg-black"
                />
              </div>
              <div className="mt-3 space-y-2 text-xs">
                <div className="text-neutral-400">
                  Source : {ingest.source.handle ? `@${ingest.source.handle}` : 'inconnu'} · id{' '}
                  {ingest.source.videoId}
                </div>
                <details className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                  <summary className="cursor-pointer text-neutral-300">Caption brute</summary>
                  <p className="mt-2 whitespace-pre-wrap text-neutral-400">
                    {ingest.caption || '(vide)'}
                  </p>
                </details>
                <details className="rounded-lg border border-neutral-800 bg-neutral-900 p-3" open>
                  <summary className="cursor-pointer text-neutral-300">Champs extraits (JSON)</summary>
                  <pre className="mt-2 overflow-x-auto text-[11px] leading-relaxed text-neutral-400">
                    {JSON.stringify(ingest.extracted, null, 2)}
                  </pre>
                </details>
              </div>
            </div>

            {/* Colonne droite — zones + génération + cards */}
            <div>
              {/* Zones autorisées — pré-coché sur l'arrondissement de la vidéo */}
              <div className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-neutral-300">
                    Zones autorisées{' '}
                    <span className="text-neutral-500">
                      ({zones.size} cochée{zones.size > 1 ? 's' : ''})
                    </span>
                  </span>
                  <span className="text-xs text-neutral-500">
                    la génération n&apos;utilisera QUE ces zones
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-neutral-500">
                  Pré-coché : l&apos;arrondissement déduit de la vidéo. Coche/décoche selon ce
                  qui est réellement affiché à l&apos;écran.
                </p>

                <div className="mt-3 text-[11px] uppercase tracking-wide text-neutral-500">
                  Arrondissements
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {ARRONDISSEMENT_LABELS.map((z) => (
                    <ZoneChip
                      key={z}
                      label={zoneShort(z)}
                      checked={zones.has(z)}
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
                      checked={zones.has(z)}
                      onClick={() => toggleZone(z)}
                    />
                  ))}
                </div>

                {zones.size === 0 && (
                  <p className="mt-2 text-[11px] text-amber-400/80">
                    Aucune zone cochée : la génération variera librement les zones.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                <span className="text-sm text-neutral-300">Biens à proposer :</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCount((c) => Math.max(1, c - 1))}
                    className="h-8 w-8 rounded-lg border border-neutral-700 text-lg leading-none"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm tabular-nums">{count}</span>
                  <button
                    onClick={() => setCount((c) => Math.min(14, c + 1))}
                    className="h-8 w-8 rounded-lg border border-neutral-700 text-lg leading-none"
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={generate}
                  disabled={generating}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
                >
                  {generating
                    ? 'Génération…'
                    : properties.length
                      ? 'Régénérer'
                      : 'Générer les biens'}
                </button>
                {properties.length > 0 && (
                  <span className="text-xs text-neutral-500">{properties.length} proposés</span>
                )}
              </div>
              {deriveError && (
                <p className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                  {deriveError}
                </p>
              )}

              <div className="mt-4 space-y-3">
                {properties.map((p, i) => (
                  <PropertyCard
                    key={i}
                    index={i}
                    property={p}
                    onChange={(patch) => updateProperty(i, patch)}
                    onRemove={() => removeProperty(i)}
                  />
                ))}
              </div>

              {properties.length > 0 && (
                <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                  {createdCount != null ? (
                    <p className="text-sm text-emerald-300">
                      ✓ {createdCount} bien{createdCount > 1 ? 's' : ''} créé
                      {createdCount > 1 ? 's' : ''} en base (isDemoData). Visible
                      {createdCount > 1 ? 's' : ''} dans le feed.
                    </p>
                  ) : (
                    <>
                      <button
                        onClick={createProperties}
                        disabled={creating}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                      >
                        {creating
                          ? 'Création…'
                          : `Valider et créer ${properties.length} bien${
                              properties.length > 1 ? 's' : ''
                            } en base`}
                      </button>
                      <p className="mt-2 text-xs text-neutral-500">
                        Écrit en base avec isDemoData: true, statut PUBLISHED, adresse incluse.
                        Action définitive (biens purgeables via isDemoData).
                      </p>
                      {createError && (
                        <p className="mt-2 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                          {createError}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
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
  const strPatch = (key: keyof GeneratedProperty) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => onChange({ [key]: e.target.value } as Partial<GeneratedProperty>)

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
        <span className="mb-1 block text-[11px] text-neutral-500">
          Adresse exacte (back-office)
        </span>
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
        <div className="mt-1 text-[11px] text-neutral-500">
          scores — lum {p.luminosity} · calme {p.quietness} · charme {p.charm} · espace{' '}
          {p.spaciousness}
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

/** "Paris 8ème" → "8ème" pour des puces d'arrondissement compactes. */
function zoneShort(z: string): string {
  return z.startsWith('Paris ') ? z.slice(6) : z
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
