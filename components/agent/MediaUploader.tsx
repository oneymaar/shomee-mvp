'use client'

import { useRef, useState } from 'react'
import { Upload, Video, Image as ImageIcon, FileText, Loader2, X, Link as LinkIcon, Plus } from 'lucide-react'
import clsx from 'clsx'

// MVP: hardcoded demo Bearer token. Tied to the seeded Kretz agent.
// Replace with session-based auth once a real login flow exists.
const DEMO_API_KEY = 'shomee_test_kr3tz_0001'

type MediaType = 'video' | 'photo' | 'plan' | 'visite_virtuelle'

interface MediaUploaderProps {
  bienId: string
  type: MediaType
  onSuccess: (url: string) => void
  multiple?: boolean
  /** 'default' = full-width dashed drop zone (initial state); 'tile' = aspect-square grid cell with just a + */
  variant?: 'default' | 'tile'
}

const SIZE_LIMIT_BYTES: Record<MediaType, number> = {
  video:           500 * 1024 * 1024,
  photo:            20 * 1024 * 1024,
  plan:             20 * 1024 * 1024,
  visite_virtuelle: 0,
}
const ACCEPT: Record<MediaType, string> = {
  video:            'video/mp4,video/quicktime,video/webm',
  photo:            'image/jpeg,image/png,image/webp',
  plan:             'image/jpeg,image/png,application/pdf',
  visite_virtuelle: '',
}
const RESOURCE_TYPE: Record<MediaType, 'video' | 'image' | 'raw'> = {
  video:            'video',
  photo:            'image',
  plan:             'image',
  visite_virtuelle: 'image',
}
const FOLDER: Record<MediaType, string> = {
  video:            'shomee/videos',
  photo:            'shomee/photos',
  plan:             'shomee/plans',
  visite_virtuelle: 'shomee/misc',
}
const LABEL: Record<MediaType, { cta: string; hint: string; Icon: typeof Upload }> = {
  video: {
    cta:  'Déposer une vidéo',
    hint: 'MP4, MOV, WEBM · max 500 Mo',
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

interface CloudinaryResponse {
  secure_url: string
  public_id:  string
}

interface SignResponse {
  signature:     string
  timestamp:     number
  cloud_name:    string
  api_key:       string
  folder:        string
  eager?:        string
  eager_async?:  string
  upload_preset?: string
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
  async function performUpload(file: File, onProgress?: (p: number) => void): Promise<void> {
    const limit = SIZE_LIMIT_BYTES[type]
    if (file.size > limit) {
      throw new Error(`${file.name} dépasse ${Math.round(limit / 1024 / 1024)} Mo`)
    }

    // 1. Signature serveur
    const signRes = await fetch('/api/upload/sign', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEMO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        folder: FOLDER[type],
        ...(type === 'video' ? { eager: 'so_auto' } : {}),
      }),
    })
    if (!signRes.ok) throw new Error(`Signature ${signRes.status}`)
    const sig = (await signRes.json()) as SignResponse

    // 2. Upload signé direct vers Cloudinary
    const uploadUrl = `https://api.cloudinary.com/v1_1/${sig.cloud_name}/${RESOURCE_TYPE[type]}/upload`
    const form = new FormData()
    form.append('file',      file)
    form.append('api_key',   sig.api_key)
    form.append('timestamp', String(sig.timestamp))
    form.append('signature', sig.signature)
    form.append('folder',    sig.folder)
    if (sig.eager)       form.append('eager',       sig.eager)
    if (sig.eager_async) form.append('eager_async', sig.eager_async)
    if (sig.upload_preset) form.append('upload_preset', sig.upload_preset)

    const cloudinaryRes = await new Promise<CloudinaryResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', uploadUrl)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        console.log('[upload] cloudinary onload', { status: xhr.status, statusText: xhr.statusText, bodySnippet: xhr.responseText?.slice(0, 300) })
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)) }
          catch { reject(new Error('Réponse Cloudinary illisible')) }
        } else {
          reject(new Error(`Cloudinary ${xhr.status} ${xhr.statusText}: ${xhr.responseText.slice(0, 200)}`))
        }
      }
      xhr.onerror = () => {
        console.error('[upload] cloudinary onerror', { status: xhr.status, statusText: xhr.statusText, readyState: xhr.readyState, bodySnippet: xhr.responseText?.slice(0, 300) })
        reject(new Error(`Erreur réseau (status=${xhr.status} state=${xhr.readyState})`))
      }
      xhr.ontimeout = () => {
        console.error('[upload] cloudinary ontimeout')
        reject(new Error('Upload timeout'))
      }
      xhr.onabort = () => {
        console.error('[upload] cloudinary onabort')
        reject(new Error('Upload annulé'))
      }
      xhr.send(form)
    })

    // 3. Confirmation côté Next (persiste l'URL + recompute completion)
    const confirmRes = await fetch('/api/upload/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEMO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bien_id:   bienId,
        type,
        url:       cloudinaryRes.secure_url,
        public_id: cloudinaryRes.public_id,
      }),
    })
    if (!confirmRes.ok) {
      const errBody = await confirmRes.json().catch(() => ({}))
      throw new Error(`Confirm ${confirmRes.status}: ${JSON.stringify(errBody)}`)
    }

    onSuccess(cloudinaryRes.secure_url)
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
        headers: {
          Authorization: `Bearer ${DEMO_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bien_id: bienId, type, url: trimmed }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(`Confirm ${res.status}: ${JSON.stringify(errBody)}`)
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
