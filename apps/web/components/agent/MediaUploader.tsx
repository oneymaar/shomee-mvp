'use client'

import { useRef, useState } from 'react'
import { Upload, Video, Image as ImageIcon, FileText, Loader2, X, Link as LinkIcon, Plus } from 'lucide-react'
import clsx from 'clsx'
import { televerser, ACCEPT, type MediaType } from '@/lib/media/upload'
import { VIDEO_HINT } from '@/lib/media/limits'

// Aucune clé d'API ici : l'agent est authentifié par son cookie de session, et
// authenticateBearer l'accepte en repli. Une clé écrite en dur partait dans le
// bundle de tous les navigateurs — et comme c'était celle d'un AUTRE compte,
// chaque appel se heurtait au contrôle d'agence et revenait en 403.

interface MediaUploaderProps {
  bienId: string
  type: MediaType
  onSuccess: (url: string) => void
  multiple?: boolean
  /** 'default' = full-width dashed drop zone (initial state); 'tile' = aspect-square grid cell with just a + */
  variant?: 'default' | 'tile'
}

const LABEL: Record<MediaType, { cta: string; hint: string; Icon: typeof Upload }> = {
  video: {
    cta:  'Déposer une vidéo',
    hint: VIDEO_HINT,
    Icon: Video,
  },
  photo: {
    cta:  'Ajouter des photos',
    hint: 'JPG, PNG, WEBP · max 20 Mo',
    Icon: ImageIcon,
  },
  plan: {
    cta:  'Ajouter un plan',
    hint: 'JPG, PNG, PDF · max 20 Mo',
    Icon: FileText,
  },
  visite_virtuelle: {
    cta:  'Enregistrer le lien',
    hint: 'Matterport / Giraffe360 / Nodalview',
    Icon: LinkIcon,
  },
}

export default function MediaUploader({ bienId, type, onSuccess, multiple, variant = 'default' }: MediaUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeCount, setActiveCount] = useState(0)
  const [progress,    setProgress]    = useState(0)
  const [error,       setError]       = useState<string | null>(null)
  const [urlDraft,    setUrlDraft]    = useState('')

  /**
   * End-to-end upload of a single file. Throws on any failure so that
   * Promise.allSettled in the multi-upload path can surface the count
   * of failures. onSuccess is called per file as soon as it completes.
   */
  /**
   * Un seul fichier, de bout en bout. Toute la mécanique (contrôles, signature,
   * envoi, confirmation) vit dans lib/media/upload.ts, partagée avec
   * l'assistant « Nouveau bien » — deux copies du même geste finissaient
   * toujours par diverger, et l'une des deux était fausse.
   */
  async function performUpload(file: File, onProgress?: (p: number) => void): Promise<void> {
    const { url } = await televerser({
      file,
      type,
      bienId,
      onProgress: onProgress ? (pourcent) => onProgress(pourcent) : undefined,
    })
    onSuccess(url)
  }

  async function handleFiles(files: FileList) {
    const arr = Array.from(files)
    if (arr.length === 0) return
    setError(null)

    if (!multiple || arr.length === 1) {
      // Single — keep granular progress bar
      setActiveCount(1)
      setProgress(0)
      try {
        await performUpload(arr[0], setProgress)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur upload')
      } finally {
        setActiveCount(0)
        setProgress(0)
      }
      return
    }

    // Multiple — parallel; each onSuccess fires independently as each finishes
    setActiveCount(arr.length)
    const results = await Promise.allSettled(arr.map((f) => performUpload(f)))
    const failures = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason.message : 'Erreur'))
    if (failures.length > 0) {
      setError(`${failures.length}/${arr.length} échec${failures.length > 1 ? 's' : ''} — ${failures[0]}`)
    }
    setActiveCount(0)
  }

  async function handleUrlSubmit() {
    const trimmed = urlDraft.trim()
    if (!trimmed) return
    try { new URL(trimmed) } catch {
      setError('URL invalide')
      return
    }

    setActiveCount(1)
    setError(null)
    try {
      const res = await fetch('/api/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bien_id: bienId, type, url: trimmed }),
      })
      if (!res.ok) {
        const corps = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(corps?.error ?? `Enregistrement refusé (HTTP ${res.status}).`)
      }
      onSuccess(trimmed)
      setUrlDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setActiveCount(0)
    }
  }

  // ── URL variant (visite virtuelle) ──────────────────────────────────────
  if (type === 'visite_virtuelle') {
    const meta = LABEL[type]
    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://my.matterport.com/show/?m=…"
            className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:border-[#0a0a0a]/40"
          />
          <button
            type="button"
            onClick={handleUrlSubmit}
            disabled={activeCount > 0 || !urlDraft.trim()}
            className="px-4 py-2 rounded-xl bg-[#0a0a0a] text-white text-[12px] font-semibold disabled:opacity-50 active:bg-[#222]"
          >
            {activeCount > 0 ? '...' : 'Enregistrer'}
          </button>
        </div>
        <p className="text-[10px] text-gray-400">{meta.hint}</p>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    )
  }

  // ── Tile variant (grid cell — used once at least one photo exists) ─────
  if (variant === 'tile') {
    return (
      <>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={activeCount > 0}
          className={clsx(
            'aspect-square rounded-lg border-2 border-dashed border-gray-300 bg-white',
            'flex flex-col items-center justify-center gap-1 px-2',
            'text-[#0a0a0a] active:bg-gray-50 transition-colors disabled:opacity-60',
          )}
          aria-label="Ajouter d'autres photos"
        >
          {activeCount > 0 ? (
            <Loader2 size={18} className="animate-spin text-[#0a0a0a]" />
          ) : (
            <>
              <Plus size={20} strokeWidth={1.8} />
              <span className="text-[10px] text-gray-500 text-center leading-tight">
                Ajouter d&apos;autres photos
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT[type]}
          multiple={multiple}
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files)
            e.target.value = ''
          }}
          className="hidden"
        />
      </>
    )
  }

  // ── File variant — upload in progress ──────────────────────────────────
  const { cta, hint, Icon } = LABEL[type]

  if (activeCount > 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-[#0a0a0a]" />
          <div className="flex-1 min-w-0">
            {activeCount === 1 ? (
              <>
                <p className="text-[13px] font-medium text-[#0a0a0a]">Upload en cours…</p>
                <div className="h-1 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="h-full bg-[#0a0a0a] rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-[13px] font-medium text-[#0a0a0a]">
                Upload de {activeCount} fichiers en cours…
              </p>
            )}
          </div>
          {activeCount === 1 && (
            <span className="text-[11px] font-semibold tabular-nums text-[#0a0a0a]">{progress}%</span>
          )}
        </div>
      </div>
    )
  }

  // ── File variant — idle (drop zone) ────────────────────────────────────
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={clsx(
          'w-full flex flex-col items-center justify-center gap-2 py-6 px-4',
          'rounded-xl border-2 border-dashed border-gray-300 bg-white',
          'text-[#0a0a0a] active:bg-gray-50 transition-colors',
        )}
      >
        <div className="w-10 h-10 rounded-full bg-[#0a0a0a]/5 flex items-center justify-center">
          <Icon size={18} className="text-[#0a0a0a]" />
        </div>
        <span className="text-[13px] font-semibold">{cta}</span>
        <span className="text-[10px] text-gray-500">{hint}</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[type]}
        multiple={multiple}
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files)
          e.target.value = ''
        }}
        className="hidden"
      />

      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-600">
          <X size={11} />
          {error}
        </div>
      )}
    </>
  )
}
